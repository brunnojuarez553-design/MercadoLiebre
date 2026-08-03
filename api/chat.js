// /api/chat.js
// Endpoint serverless para el asistente virtual de Mercado Liebre.
// Deploy en Vercel. Requiere la variable de entorno GROQ_API_KEY
// (y opcionalmente OPENAI_API_KEY como fallback) configuradas en el proyecto de Vercel.

const SYSTEM_PROMPT = `Sos el asistente virtual de Mercado Liebre, una empresa que compra, consolida e importa productos desde Estados Unidos (Miami) hacia Argentina.

Hablás en español rioplatense, de forma cercana, natural y humana — NUNCA como un formulario ni enumerando preguntas tipo cuestionario. Charlás como lo haría una persona del equipo: con calidez, claridad, oraciones cortas y sin sonar robótico. No uses viñetas ni títulos en tus respuestas, escribí como en una conversación real de WhatsApp.

INFORMACIÓN DE LA EMPRESA:
- Compramos productos en tiendas y proveedores de EE.UU. (Amazon, eBay, tiendas físicas, proveedores especializados, etc.) o recibimos lo que el cliente ya compró.
- Recibimos, verificamos y consolidamos todo en nuestro warehouse de Doral, Miami.
- Envío vía aérea Priority (salidas semanales) para repuestos, compras online y envíos urgentes; o vía marítima LCL/FCL (en alianza con Sunbiz Latinoamérica LLC, transporte realizado por Maersk) para mudanzas, maquinaria, mercadería comercial y cargas de gran volumen.
- Gestionamos aduana, impuestos y entrega a todo el país, con oficina administrativa en Palermo Chico, CABA.
- Somos especialistas en repuestos y accesorios Harley-Davidson.
- Categorías que manejamos: vehículos y motos, repuestos y accesorios, tecnología y electrónica, compras generales, carga comercial y marítima, y operaciones a medida (si algo no encaja en una categoría habitual, igual lo evaluamos).
- Estimación de costos orientativa (aclará siempre que es referencial y que la cotización final la confirma el equipo): gestión de compra ~6.5% del valor del producto con un mínimo de USD 28 si nosotros compramos, o USD 18 si el cliente ya lo compró; flete Priority estimado desde USD 54 según el peso (aprox. USD 24 por kg); impuestos y aduana estimados en ~24% del valor del producto.
- Respaldo: Importador/Exportador registrado en ARCA, Agente de transporte marítimo con habilitación ARCA, Prestador de servicio postal registrado en ENACOM, y Sunbiz Latinoamérica LLC (empresa radicada en Miami).
- El seguimiento de pedidos es siempre personalizado por WhatsApp, no existe tracking automático en vivo con estado en tiempo real.
- Contacto: WhatsApp Argentina +54 9 362 487 4230, WhatsApp Miami +1 786 852 2701.

TU OBJETIVO EN CADA CONVERSACIÓN:
1. Resolver dudas sobre el servicio, tiempos, costos aproximados, proceso, categorías, garantías y respaldo, usando la información de arriba. Si no sabés algo con certeza, decilo con honestidad en vez de inventar, y ofrecé derivar al equipo humano.
2. Si la persona quiere hacer un pedido, cotizar algo o avanzar con una compra, andá juntando de forma natural y conversacional (una o dos preguntas por mensaje, integradas al hilo de la charla, nunca como una lista) estos datos cuando sean relevantes: qué quiere traer (producto, modelo, o link), si ya lo compró o quiere que lo compren, nombre, ciudad o destino, precio aproximado en USD, peso aproximado, cantidad, y si es urgente.
3. No hace falta juntar el 100% de los datos. Si la persona no sabe el peso o el precio exacto, seguí igual con la información disponible.
4. En cuanto tengas al menos qué producto le interesa junto con algún otro dato (nombre, destino, o que pida explícitamente cerrar/hablar con alguien), llamá a la función enviar_a_whatsapp con todos los datos que hayas juntado hasta ese momento. No esperes a tener todos los campos completos.
5. Nunca inventes datos que la persona no te dio explícitamente.
6. Sos un asistente virtual, no una persona — si te preguntan, sé transparente sobre eso — pero siempre hablás de forma natural, cálida y humana, nunca con tono de bot genérico ni de formulario.`;

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'enviar_a_whatsapp',
      description:
        'Se llama cuando ya se juntó información suficiente sobre el pedido/consulta del cliente (al menos el producto de interés junto con algún otro dato como nombre, destino, o pedido explícito de cerrar la consulta) para derivarlo al equipo humano por WhatsApp con todos los datos recopilados.',
      parameters: {
        type: 'object',
        properties: {
          producto: { type: 'string', description: 'Producto, modelo o link que quiere importar' },
          categoria: { type: 'string', description: 'Categoría del producto (repuesto, vehículo, tecnología, compra general, carga comercial, etc.)' },
          modalidad: { type: 'string', description: 'Aérea Priority o marítima, si se mencionó' },
          destino: { type: 'string', description: 'Ciudad o provincia de destino' },
          precio: { type: 'string', description: 'Precio aproximado en USD' },
          peso: { type: 'string', description: 'Peso aproximado en kg' },
          cantidad: { type: 'string', description: 'Cantidad de unidades' },
          urgencia: { type: 'string', description: 'Si es urgente o no' },
          nombre: { type: 'string', description: 'Nombre de la persona' },
          notas: { type: 'string', description: 'Cualquier otro dato relevante mencionado' }
        },
        required: ['producto']
      }
    }
  }
];

const TIMEOUT_MS = 15000;

async function callModel({ apiUrl, apiKey, model, messages }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages,
        tools: TOOLS,
        tool_choice: 'auto',
        temperature: 0.6,
        max_tokens: 500
      }),
      signal: controller.signal
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} ${errText}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const GROQ_API_KEY = process.env.GROQ_API_KEY;
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

  try {
    const { messages } = req.body || {};
    if (!Array.isArray(messages)) {
      res.status(400).json({ error: 'messages debe ser un array' });
      return;
    }

    // Limitamos el historial para no pasarnos de tokens en conversaciones largas.
    const trimmed = messages.slice(-24).filter(m => m && m.role && m.content);
    const fullMessages = [{ role: 'system', content: SYSTEM_PROMPT }, ...trimmed];

    let data = null;
    let lastError = null;

    if (GROQ_API_KEY) {
      try {
        data = await callModel({
          apiUrl: 'https://api.groq.com/openai/v1/chat/completions',
          apiKey: GROQ_API_KEY,
          model: 'llama-3.3-70b-versatile',
          messages: fullMessages
        });
      } catch (e) {
        lastError = e;
      }
    }

    if (!data && OPENAI_API_KEY) {
      try {
        data = await callModel({
          apiUrl: 'https://api.openai.com/v1/chat/completions',
          apiKey: OPENAI_API_KEY,
          model: 'gpt-4o-mini',
          messages: fullMessages
        });
      } catch (e) {
        lastError = e;
      }
    }

    if (!data) {
      console.error('Error asistente Mercado Liebre:', lastError);
      res.status(200).json({
        type: 'text',
        reply:
          'Ahora mismo no puedo responder por acá. Escribinos directo por WhatsApp y te ayudamos enseguida.'
      });
      return;
    }

    const choice = data.choices && data.choices[0] && data.choices[0].message;
    if (!choice) {
      res.status(200).json({ type: 'text', reply: 'Perdón, no te pude entender bien. ¿Me lo repetís?' });
      return;
    }

    const toolCall = choice.tool_calls && choice.tool_calls[0];
    if (toolCall && toolCall.function && toolCall.function.name === 'enviar_a_whatsapp') {
      let args = {};
      try {
        args = JSON.parse(toolCall.function.arguments || '{}');
      } catch {
        args = {};
      }
      res.status(200).json({
        type: 'whatsapp',
        data: args,
        reply: choice.content || '¡Buenísimo! Ya junté los datos, seguimos por WhatsApp para cerrar todo.'
      });
      return;
    }

    res.status(200).json({
      type: 'text',
      reply: choice.content || 'Perdón, no te pude entender bien. ¿Me lo repetís?'
    });
  } catch (err) {
    console.error('Error en /api/chat:', err);
    res.status(200).json({
      type: 'text',
      reply: 'Ahora mismo no puedo responder por acá. Escribinos directo por WhatsApp y te ayudamos enseguida.'
    });
  }
}
