module.exports = function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { password } = req.body || {};
  const correct = process.env.ANALYST_PASSWORD;

  if (!correct) return res.status(500).json({ ok: false, error: 'Password not configured' });
  if (password === correct) return res.status(200).json({ ok: true });
  return res.status(401).json({ ok: false });
};
