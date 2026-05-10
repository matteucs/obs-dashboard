export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch(e) {} }

  // ── GET profile ────────────────────────────────────────────
  if (req.method === 'GET') {
    const userId = req.query.userId;
    if (!userId) return res.status(400).json({ error: 'Missing userId' });
    const r = await fetch(`${SUPABASE_URL}/rest/v1/analyst_profiles?user_id=eq.${userId}&limit=1`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
    });
    const rows = await r.json();
    return res.status(200).json(rows?.[0]?.data || null);
  }

  // ── SAVE profile ───────────────────────────────────────────
  if (req.method === 'POST') {
    const { userId, profileData } = body || {};
    if (!userId) return res.status(400).json({ error: 'Missing userId' });
    const r = await fetch(`${SUPABASE_URL}/rest/v1/analyst_profiles`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates'
      },
      body: JSON.stringify({ user_id: userId, updated_at: new Date().toISOString(), data: profileData })
    });
    const text = await r.text();
    return res.status(r.status).json(text ? JSON.parse(text) : { ok: true });
  }

  return res.status(405).end();
}
