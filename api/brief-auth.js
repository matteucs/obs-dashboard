import bcrypt from 'bcryptjs';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
  const ADMIN_SECRET = process.env.ADMIN_SECRET;

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch(e) {} }
  const { action, username, password, newPassword, adminSecret, userId, displayName } = body || {};

  const isAdmin = adminSecret === ADMIN_SECRET;

  // ── login ──────────────────────────────────────────────────
  if (action === 'login') {
    if (!username || !password) return res.status(400).json({ ok: false, error: 'Missing credentials' });
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/brief_users?username=eq.${encodeURIComponent(username.toLowerCase())}&limit=1`, {
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
      });
      const rows = await r.json();
      if (!rows?.length) return res.status(401).json({ ok: false, error: 'Invalid username or password' });
      const user = rows[0];
      const match = await bcrypt.compare(password, user.password_hash);
      if (!match) return res.status(401).json({ ok: false, error: 'Invalid username or password' });
      return res.status(200).json({ ok: true, userId: user.id, username: user.username });
    } catch(e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  // ── register (admin only) ──────────────────────────────────
  if (action === 'register') {
    if (!isAdmin) return res.status(403).json({ ok: false, error: 'Unauthorized' });
    if (!username || !password) return res.status(400).json({ ok: false, error: 'Missing credentials' });
    if (password.length < 8) return res.status(400).json({ ok: false, error: 'Password too short' });
    try {
      const hash = await bcrypt.hash(password, 10);
      const id = 'user_' + Date.now();
      const r = await fetch(`${SUPABASE_URL}/rest/v1/brief_users`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates'
        },
        body: JSON.stringify({ id, username: username.toLowerCase(), password_hash: hash, display_name: displayName || '' })
      });
      if (!r.ok) { const err = await r.text(); return res.status(400).json({ ok: false, error: err }); }
      return res.status(200).json({ ok: true, userId: id, username: username.toLowerCase() });
    } catch(e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  // ── listUsers (admin only) ─────────────────────────────────
  if (action === 'listUsers') {
    if (!isAdmin) return res.status(403).json({ ok: false, error: 'Unauthorized' });
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/brief_users?select=id,username,display_name,created_at&order=created_at.asc`, {
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
      });
      const users = await r.json();
      return res.status(200).json({ ok: true, users });
    } catch(e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  // ── deleteUser (admin only) ────────────────────────────────
  if (action === 'deleteUser') {
    if (!isAdmin) return res.status(403).json({ ok: false, error: 'Unauthorized' });
    if (!userId) return res.status(400).json({ ok: false, error: 'Missing userId' });
    try {
      // Delete profile too
      await fetch(`${SUPABASE_URL}/rest/v1/analyst_profiles?user_id=eq.${userId}`, {
        method: 'DELETE',
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
      });
      const r = await fetch(`${SUPABASE_URL}/rest/v1/brief_users?id=eq.${userId}`, {
        method: 'DELETE',
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
      });
      return res.status(200).json({ ok: true });
    } catch(e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  // ── adminResetPassword (admin only) ───────────────────────
  if (action === 'adminResetPassword') {
    if (!isAdmin) return res.status(403).json({ ok: false, error: 'Unauthorized' });
    if (!username || !newPassword) return res.status(400).json({ ok: false, error: 'Missing fields' });
    if (newPassword.length < 8) return res.status(400).json({ ok: false, error: 'Password too short' });
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/brief_users?username=eq.${encodeURIComponent(username.toLowerCase())}&limit=1`, {
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
      });
      const rows = await r.json();
      if (!rows?.length) return res.status(404).json({ ok: false, error: 'User not found' });
      const hash = await bcrypt.hash(newPassword, 10);
      await fetch(`${SUPABASE_URL}/rest/v1/brief_users?id=eq.${rows[0].id}`, {
        method: 'PATCH',
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ password_hash: hash })
      });
      return res.status(200).json({ ok: true });
    } catch(e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  // ── changePassword (user self-service) ────────────────────
  if (action === 'changePassword') {
    if (!username || !password || !newPassword) return res.status(400).json({ ok: false, error: 'Missing fields' });
    if (newPassword.length < 8) return res.status(400).json({ ok: false, error: 'New password too short' });
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/brief_users?username=eq.${encodeURIComponent(username.toLowerCase())}&limit=1`, {
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
      });
      const rows = await r.json();
      if (!rows?.length) return res.status(401).json({ ok: false, error: 'User not found' });
      const match = await bcrypt.compare(password, rows[0].password_hash);
      if (!match) return res.status(401).json({ ok: false, error: 'Current password incorrect' });
      const hash = await bcrypt.hash(newPassword, 10);
      await fetch(`${SUPABASE_URL}/rest/v1/brief_users?id=eq.${rows[0].id}`, {
        method: 'PATCH',
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ password_hash: hash })
      });
      return res.status(200).json({ ok: true });
    } catch(e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  return res.status(400).json({ ok: false, error: 'Unknown action' });
}
