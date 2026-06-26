module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

  // ── GET ────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const action = req.query.action;
    const type = req.query.type;

    if (action === 'listBriefs') {
      const response = await fetch(
        `${SUPABASE_URL}/rest/v1/briefs?type=eq.${type}&order=generated_at.desc&limit=50`,
        { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
      );
      return res.status(200).json(await response.json());
    }

    const response = await fetch(`${SUPABASE_URL}/rest/v1/submissions?order=created_at.desc`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
    });
    return res.status(200).json(await response.json());
  }

  // ── Parse body ─────────────────────────────────────────────
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch(e) {} }
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ error: 'Invalid request body' });
  }

  const { action, payload } = body;

  // ── save ───────────────────────────────────────────────────
  if (action === 'save') {
    try {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/submissions`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates',
        },
        body: JSON.stringify(payload),
      });
      const text = await response.text();
      let data = {};
      try { data = text ? JSON.parse(text) : {}; } catch(e) {}
      return res.status(response.status).json(data);
    } catch (err) {
      return res.status(500).json({ error: 'Save failed', details: err.message });
    }
  }

  // ── delete ─────────────────────────────────────────────────
  if (action === 'delete') {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/submissions?id=eq.${payload.id}`, {
      method: 'DELETE',
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
    });
    return res.status(response.status).end();
  }

  // ── analyze ────────────────────────────────────────────────
  if (action === 'analyze') {
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
          'anthropic-beta': 'web-search-2025-03-05',
        },
        body: JSON.stringify(payload),
      });
      return res.status(response.status).json(await response.json());
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(400).json({ error: 'Unknown action' });
};
