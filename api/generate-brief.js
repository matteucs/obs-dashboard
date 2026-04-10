export default async function handler(req, res) {
  const authHeader = req.headers.authorization;
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  const CRON_SECRET = process.env.CRON_SECRET;

  if (authHeader && authHeader !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const briefType = req.query.type || 'daily';
  const now = new Date();

  const periodLabel = {
    daily:   now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
    weekly:  `Week of ${now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`,
    monthly: now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
    yearly:  now.getFullYear().toString(),
  }[briefType] || now.toISOString().split('T')[0];

  const briefId = `${briefType}-${now.toISOString().split('T')[0]}`;

  // Load submissions
  let submissions = [];
  try {
    const subRes = await fetch(`${SUPABASE_URL}/rest/v1/submissions?order=created_at.desc`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
    });
    submissions = await subRes.json();
  } catch(e) {}

  const cutoff = {
    daily:   new Date(now - 1   * 24 * 60 * 60 * 1000),
    weekly:  new Date(now - 7   * 24 * 60 * 60 * 1000),
    monthly: new Date(now - 30  * 24 * 60 * 60 * 1000),
    yearly:  new Date(now - 365 * 24 * 60 * 60 * 1000),
  }[briefType];

  const filtered = briefType === 'daily' ? submissions : submissions.filter(s => new Date(s.created_at) >= cutoff);
  const analyzed = filtered.filter(s => s.analysis);
  const highPriority = analyzed.filter(s => s.analysis?.priority === 'High');
  const medPriority  = analyzed.filter(s => s.analysis?.priority === 'Medium');
  const lowPriority  = analyzed.filter(s => s.analysis?.priority === 'Low');

  const fmtSub = s =>
    `  - [${s.date}] ${s.name} | ${s.analysis?.category} | "${s.narrative.slice(0,180)}${s.narrative.length>180?'...':''}" | Summary: ${s.analysis?.summary}`;

  const subContext = analyzed.length ? `
HIGH PRIORITY FIELD REPORTS (${highPriority.length}) - firsthand observations that directly corroborate or challenge the news picture:
${highPriority.length ? highPriority.map(fmtSub).join('\n') : '  None'}

MEDIUM PRIORITY (${medPriority.length}):
${medPriority.length ? medPriority.map(fmtSub).join('\n') : '  None'}

LOW PRIORITY (${lowPriority.length}):
${lowPriority.length ? lowPriority.map(fmtSub).join('\n') : '  None'}
` : 'No field submissions for this period.';

  // Historical context
  let historicalContext = '';
  if (briefType !== 'daily') {
    try {
      const histRes = await fetch(
        `${SUPABASE_URL}/rest/v1/briefs?type=eq.daily&order=generated_at.desc&limit=14`,
        { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
      );
      const hist = await histRes.json();
      if (hist.length) {
        historicalContext = hist.map(b =>
          `[${b.period_label}] Risk: ${b.content?.overall_risk} | ${b.content?.overall_assessment||''}`
        ).join('\n');
      }
    } catch(e) {}
  }

  const prompt = `You are a senior China intelligence analyst producing a ${briefType.toUpperCase()} brief dated ${now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}.

You have two source categories with DIFFERENT analytical weights:

SOURCE A - OPEN SOURCE NEWS [PRIMARY WEIGHT - 70-80% of analysis]
Use your web search tool to find today's most significant China news across Economy, Regional Goals, Military, and Technology. This is your primary analytical foundation. Draw on Reuters, AP, Bloomberg, WSJ, FT, SCMP, Nikkei Asia, Defense News. Find 5-8 stories per theme. News drives the analysis.

SOURCE B - FIELD SUBMISSIONS [CORROBORATING WEIGHT - 20-30% of analysis]
These are firsthand observation reports. They do not drive the analysis alone. Where they corroborate, contradict, or add texture to the news picture, call that out explicitly. High priority submissions carry more weight.

${subContext}

${historicalContext ? `HISTORICAL BRIEF CONTEXT:\n${historicalContext}` : ''}

INSTRUCTIONS:
1. Search the web first for today's China news across all four themes. Collect ALL significant stories regardless of whether field submissions exist for that topic.
2. Every news story that matters should appear in the brief — do NOT skip or downweight a news topic simply because there are no field submissions related to it.
3. Build the full analysis from open source news. The absence of field submissions on a topic is not a reason to omit it.
4. ONLY AFTER building the news-driven analysis, check whether any field submissions corroborate, contradict, or add texture to specific news topics. If they do, note it. If they don't, say nothing — do not force a connection.
5. The overall_assessment should be a complete picture of what the news shows. Field submissions may add a sentence of nuance but must not displace news-driven conclusions.
6. ${briefType !== 'daily' ? 'Emphasize trajectory and change over time.' : 'Focus on what is most significant today.'}
7. ECONOMIC INDICATORS SECTION: Search specifically for the latest values of: China GDP growth, NBS and Caixin PMI (manufacturing and services), export/import data, USD/CNY exchange rate, CPI, PPI, urban and youth unemployment, FDI flows, property market data (Evergrande, Country Garden, new home prices), local government debt, and any alternative indicators like electricity consumption or freight volumes. Use the most recent data available — prioritize official NBS releases, PBOC statements, and reputable financial sources like Bloomberg, Reuters, and Caixin. This section should read like a Bloomberg economic dashboard, not a news summary.

Respond ONLY with valid JSON:
{
  "generated": "${now.toISOString()}",
  "date": "${now.toISOString().split('T')[0]}",
  "overall_assessment": "3-4 sentences leading with news-driven picture, then noting where field submissions add texture.",
  "overall_risk": "High|Medium|Low",
  "themes": {
    "economy": {
      "tldr": "One sentence bottom line from open source reporting.",
      "analysis": "4-5 sentences. Lead with news. Weave in field submissions where relevant.",
      "trends": [{ "label": "...", "text": "...", "direction": "Rising|Falling|Stable|Uncertain" }],
      "signals": [{ "label": "...", "value": "...", "desc": "..." }],
      "risk": "High|Medium|Low",
      "field_corroboration": "One sentence on how field submissions align or diverge with THIS SPECIFIC THEME's news. Only include if a direct connection exists. Omit entirely if no relevant submissions touch this theme."
    },
    "regional": { "tldr": "...", "analysis": "...", "trends": [...], "signals": [...], "risk": "...", "field_corroboration": "..." },
    "military":  { "tldr": "...", "analysis": "...", "trends": [...], "signals": [...], "risk": "...", "field_corroboration": "..." },
    "technology":{ "tldr": "...", "analysis": "...", "trends": [...], "signals": [...], "risk": "...", "field_corroboration": "..." }
  },
  "economic_indicators": {
    "search_date": "${now.toISOString().split('T')[0]}",
    "overview": "2-3 sentence summary of China's current macroeconomic condition based on the latest data.",
    "indicators": [
      {
        "name": "GDP Growth Rate",
        "value": "Latest official or estimated figure with period",
        "previous": "Prior period value",
        "trend": "Rising|Falling|Stable|Uncertain",
        "interpretation": "What this means for China's economy and global impact."
      }
    ],
    "pmi": {
      "manufacturing": "Latest NBS or Caixin manufacturing PMI value and date",
      "services": "Latest NBS or Caixin services PMI value and date",
      "interpretation": "What PMI data signals about economic momentum."
    },
    "trade": {
      "exports": "Latest export growth YoY%",
      "imports": "Latest import growth YoY%",
      "surplus": "Latest trade surplus figure",
      "key_partners": "Most significant trade partner developments",
      "interpretation": "What trade data signals about domestic demand and export competitiveness."
    },
    "currency": {
      "usd_cny": "Current USD/CNY rate",
      "trend": "Appreciation|Depreciation|Stable",
      "pboc_action": "Any recent PBOC interventions or policy signals",
      "interpretation": "Currency implications for trade and capital flows."
    },
    "real_estate": {
      "status": "Current state of property market",
      "key_developers": "Status of major developers e.g. Evergrande, Country Garden",
      "policy_response": "Government measures to stabilize sector",
      "interpretation": "Property sector impact on broader economy."
    },
    "inflation": {
      "cpi": "Latest CPI figure",
      "ppi": "Latest PPI figure",
      "interpretation": "Inflation/deflation dynamics and policy implications."
    },
    "employment": {
      "urban_unemployment": "Latest urban unemployment rate",
      "youth_unemployment": "Latest youth unemployment rate if available",
      "interpretation": "Labor market conditions and social stability implications."
    },
    "foreign_investment": {
      "fdi": "Latest FDI inflow data",
      "trend": "Rising|Falling|Stable",
      "interpretation": "What FDI trends signal about business confidence in China."
    },
    "debt": {
      "local_government": "Local government debt situation",
      "corporate": "Corporate debt levels and stress indicators",
      "household": "Household debt and consumption outlook",
      "interpretation": "Debt dynamics and systemic risk assessment."
    },
    "forward_indicators": [
      {
        "name": "Indicator name e.g. Li Keqiang Index, Electricity Consumption",
        "value": "Current reading",
        "interpretation": "What this alternative indicator suggests about true economic activity."
      }
    ],
    "overall_assessment": "High|Medium-High|Medium|Medium-Low|Low",
    "overall_assessment_text": "2-3 sentence bottom line on China's economic health and trajectory, including key risks and opportunities."
  },
  "source_count": {
    "submissions": ${analyzed.length},
    "high_priority_submissions": ${highPriority.length}
  }
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
        max_tokens: 5000,
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

    await fetch(`${SUPABASE_URL}/rest/v1/briefs`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates',
      },
      body: JSON.stringify({ id: briefId, type: briefType, period_label: periodLabel, generated_at: now.toISOString(), content: briefContent })
    });

    return res.status(200).json({ success: true, briefId, type: briefType, period_label: periodLabel });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
