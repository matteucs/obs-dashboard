export default async function handler(req, res) {
  // Allow cron calls from Vercel and manual calls
  const authHeader = req.headers.authorization;
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  const CRON_SECRET = process.env.CRON_SECRET;

  // Verify cron secret for scheduled calls
  if (authHeader && authHeader !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const briefType = req.query.type || 'daily';
  const now = new Date();

  // Build period label
  const periodLabel = {
    daily:   now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
    weekly:  `Week of ${now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`,
    monthly: now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
    yearly:  now.getFullYear().toString(),
  }[briefType] || now.toISOString().split('T')[0];

  const briefId = `${briefType}-${now.toISOString().split('T')[0]}`;

  // Load submissions from Supabase
  let submissions = [];
  try {
    const subRes = await fetch(`${SUPABASE_URL}/rest/v1/submissions?order=created_at.desc`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
    });
    submissions = await subRes.json();
  } catch(e) {}

  // Filter submissions by period
  const cutoff = {
    daily:   new Date(now - 1 * 24 * 60 * 60 * 1000),
    weekly:  new Date(now - 7 * 24 * 60 * 60 * 1000),
    monthly: new Date(now - 30 * 24 * 60 * 60 * 1000),
    yearly:  new Date(now - 365 * 24 * 60 * 60 * 1000),
  }[briefType];

  const filtered = briefType === 'daily'
    ? submissions
    : submissions.filter(s => new Date(s.created_at) >= cutoff);

  const analyzed = filtered.filter(s => s.analysis);
  const subContext = analyzed.length
    ? analyzed.map(s => `[${s.date}] ${s.name}: ${s.narrative} | Category: ${s.analysis?.category} | Priority: ${s.analysis?.priority} | Summary: ${s.analysis?.summary}`).join('\n')
    : 'No analyzed submissions for this period.';

  // Load existing briefs for trend context (for weekly/monthly/yearly)
  let historicalContext = '';
  if (briefType !== 'daily') {
    try {
      const histRes = await fetch(`${SUPABASE_URL}/rest/v1/briefs?type=eq.daily&order=generated_at.desc&limit=30`, {
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
      });
      const hist = await histRes.json();
      if (hist.length) {
        historicalContext = hist.slice(0, 10).map(b =>
          `[${b.period_label}] Overall: ${b.content?.overall_assessment || ''} Risk: ${b.content?.overall_risk || ''}`
        ).join('\n');
      }
    } catch(e) {}
  }

  const periodDescriptions = {
    daily:   'the last 24 hours',
    weekly:  'the past 7 days',
    monthly: 'the past 30 days',
    yearly:  'the past year',
  };

  const prompt = `You are a senior China intelligence analyst. Today is ${now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}.

Generate a ${briefType.toUpperCase()} intelligence brief covering ${periodDescriptions[briefType]}.

OBSERVATION SUBMISSIONS (${periodDescriptions[briefType]}):
${subContext}

${historicalContext ? `HISTORICAL BRIEF CONTEXT (for trend analysis):\n${historicalContext}` : ''}

Synthesize this into a structured intelligence brief across four strategic themes. ${briefType !== 'daily' ? 'Emphasize trends over time, changes from previous periods, and evolving patterns.' : ''}

Respond ONLY with valid JSON (no markdown):
{
  "overall_assessment": "2-3 sentence executive summary.",
  "overall_risk": "High|Medium|Low",
  "themes": {
    "economy": {
      "tldr": "One sentence bottom line.",
      "analysis": "3-4 sentence analytical paragraph.",
      "trends": [{ "label": "...", "text": "...", "direction": "Rising|Falling|Stable|Uncertain" }],
      "signals": [{ "label": "...", "value": "...", "desc": "..." }],
      "risk": "High|Medium|Low"
    },
    "regional": { "tldr": "...", "analysis": "...", "trends": [...], "signals": [...], "risk": "..." },
    "military":  { "tldr": "...", "analysis": "...", "trends": [...], "signals": [...], "risk": "..." },
    "technology":{ "tldr": "...", "analysis": "...", "trends": [...], "signals": [...], "risk": "..." }
  },
  "source_count": { "submissions": ${analyzed.length}, "news_stories": 0 }
}`;

  try {
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'web-search-2025-03-05',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4000,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const aiData = await aiRes.json();
    let jsonText = null;
    for (const block of (aiData.content || [])) {
      if (block.type === 'text' && block.text) {
        const cleaned = block.text.trim().replace(/```json|```/g, '').trim();
        try { JSON.parse(cleaned); jsonText = cleaned; break; } catch(e) {}
        const match = cleaned.match(/\{[\s\S]*\}/);
        if (match) { try { JSON.parse(match[0]); jsonText = match[0]; break; } catch(e) {} }
      }
    }

    if (!jsonText) throw new Error('No valid JSON from AI');
    const briefContent = JSON.parse(jsonText);

    // Save to Supabase
    await fetch(`${SUPABASE_URL}/rest/v1/briefs`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates',
      },
      body: JSON.stringify({
        id: briefId,
        type: briefType,
        period_label: periodLabel,
        generated_at: now.toISOString(),
        content: briefContent
      })
    });

    return res.status(200).json({ success: true, briefId, type: briefType, period_label: periodLabel });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
