// Proxy server untuk Gemini. API key dibaca dari environment variable, tidak pernah dikirim ke browser.
const MODELS = (process.env.GEMINI_MODELS || 'gemini-3.1-flash-lite,gemini-3.1-flash-lite-preview')
  .split(',').map(s => s.trim()).filter(Boolean);
const ORIGINS = (process.env.ALLOWED_ORIGIN || '')
  .split(',').map(s => s.trim()).filter(Boolean);

const fail = (res, code, message) => res.status(code).json({ error: { message } });

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  // Cek status: apakah kunci server sudah diatur (tanpa membuka isi kunci)
  if (req.method === 'GET') {
    return res.status(200).json({ ready: !!process.env.GEMINI_API_KEY });
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return fail(res, 405, 'Metode tidak diizinkan');
  }

  const key = process.env.GEMINI_API_KEY;
  if (!key) return fail(res, 503, 'Kunci server belum diatur');

  if (ORIGINS.length && !ORIGINS.includes(req.headers.origin || '')) {
    return fail(res, 403, 'Asal permintaan tidak diizinkan');
  }

  const { model, body } = req.body || {};
  if (!MODELS.includes(model)) return fail(res, 400, 'Model tidak diizinkan');
  if (!body || !Array.isArray(body.contents) || !body.contents.length) {
    return fail(res, 400, 'Isi permintaan tidak valid');
  }

  // Hanya teruskan field yang diperlukan
  const g = body.generationConfig || {};
  const payload = {
    contents: body.contents,
    generationConfig: {
      temperature: Math.min(1, Math.max(0, Number(g.temperature) || 0.4)),
      maxOutputTokens: Math.min(8192, Math.max(256, Number(g.maxOutputTokens) || 4096)),
      ...(g.responseMimeType === 'application/json' ? { responseMimeType: 'application/json' } : {})
    }
  };

  try {
    const upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(55000)
      }
    );
    const text = await upstream.text();
    res.status(upstream.status).setHeader('Content-Type', 'application/json').send(text);
  } catch (e) {
    if (e && (e.name === 'TimeoutError' || e.name === 'AbortError')) return fail(res, 504, 'Gemini terlalu lama merespons');
    return fail(res, 502, 'Gagal menghubungi Gemini');
  }
};
