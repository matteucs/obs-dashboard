module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

  const briefType = req.query.type || 'daily';
  const now = new Date();
  const briefId = `${briefType}-${now.toISOString().split('T')[0]}`;
  const periodLabel = {
    daily:   now.toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' }),
    weekly:  `Week of ${now.toLocaleDateString('en-US', { month:'long', day:'numeric', year:'numeric' })}`,
    monthly: now.toLocaleDateString('en-US', { month:'long', year:'numeric' }),
    yearly:  now.getFullYear().toString(),
  }[briefType] || now.toISOString().split('T')[0];

  const today = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const subContext = analyzed && analyzed.length
    ? 'HIGH PRIORITY: ' + (highPriority||[]).map(s => '[' + s.date + '] ' + (s.analysis&&s.analysis.category||'') + ': ' + (s.narrative||'').slice(0,120)).join(' | ')
    : 'No field submissions.';

  const prompt = `You are a senior China intelligence analyst producing a ${briefType.toUpperCase()} brief dated ${today}.

Search for the latest news and analysis across all four themes. Draw on Reuters, AP, Bloomberg, FT, SCMP, Nikkei Asia, Defense News, and think tanks (CSIS, Pacific Forum, Hudson Institute, Wilson Center, CRS). Find 4-6 significant stories per theme.

FIELD SUBMISSIONS (corroborating signal - 20% weight): ${subContext}
${historicalContext ? 'PRIOR BRIEFS CONTEXT: ' + historicalContext : ''}

TECHNOLOGY: Cover semiconductors, space & aerospace, 5G/6G, quantum computing, biotech, green energy (solar/EVs/batteries), nuclear, robotics, cybersecurity. NOT just AI.

ECONOMIC INDICATORS: Search for latest China macro data — GDP growth, NBS/Caixin PMI (manufacturing and services), export/import figures, USD/CNY rate, CPI, PPI, urban and youth unemployment, property market (Evergrande, Country Garden, home prices), PBOC actions, and alternative indicators like electricity consumption or freight volumes.

${briefType !== 'daily' ? 'Emphasize trends and changes over time.' : 'Focus on today and this week.'}

Return ONLY raw JSON, no markdown fences, starting with { and ending with }:
{
  "overall_assessment": "3-4 sentence executive summary of the most significant developments.",
  "overall_risk": "High|Medium|Low",
  "themes": {
    "economy": {
      "tldr": "One sentence bottom line.",
      "analysis": "3-4 sentences covering trade, GDP signals, financial markets, economic policy.",
      "trends": [
        {"label": "Trend name", "text": "What this trend means and why it matters.", "direction": "Rising|Falling|Stable|Uncertain"}
      ],
      "signals": [
        {"label": "Indicator name", "value": "Specific value or status", "desc": "Brief context"}
      ],
      "risk": "High|Medium|Low",
      "field_corroboration": "One sentence if field reports corroborate or contradict. Omit if none."
    },
    "regional": {
      "tldr": "One sentence bottom line.",
      "analysis": "3-4 sentences on Taiwan, South China Sea, BRI, diplomacy, regional influence.",
      "trends": [{"label": "...", "text": "...", "direction": "..."}],
      "signals": [{"label": "...", "value": "...", "desc": "..."}],
      "risk": "High|Medium|Low",
      "field_corroboration": ""
    },
    "military": {
      "tldr": "One sentence bottom line.",
      "analysis": "3-4 sentences on PLA modernization, exercises, weapons programs, posture.",
      "trends": [{"label": "...", "text": "...", "direction": "..."}],
      "signals": [{"label": "...", "value": "...", "desc": "..."}],
      "risk": "High|Medium|Low",
      "field_corroboration": ""
    },
    "technology": {
      "tldr": "One sentence bottom line.",
      "analysis": "3-4 sentences across multiple tech domains - not just AI.",
      "trends": [{"label": "...", "text": "...", "direction": "..."}],
      "signals": [{"label": "...", "value": "...", "desc": "..."}],
      "risk": "High|Medium|Low",
      "field_corroboration": ""
    }
  },
  "think_tank_sources": [
    {"org": "CSIS or other", "title": "Publication title", "date": "Date", "url": "URL", "key_finding": "One sentence finding"}
  ],
  "economic_indicators": {
    "search_date": "${now.toISOString().split('T')[0]}",
    "overview": "2-3 sentences on China macro condition.",
    "indicators": [{"name": "GDP Growth Rate","value": "latest %","previous": "prior period","trend": "Rising|Falling|Stable|Uncertain","interpretation": "1 sentence"}],
    "pmi": {"manufacturing": "NBS figure","services": "NBS figure","interpretation": "1 sentence"},
    "trade": {"exports": "YoY %","imports": "YoY %","surplus": "$X billion","key_partners": "key developments","interpretation": "1 sentence"},
    "currency": {"usd_cny": "X.XX","trend": "Appreciation|Depreciation|Stable","pboc_action": "recent actions","interpretation": "1 sentence"},
    "real_estate": {"status": "market status","key_developers": "developer health","policy_response": "govt response","interpretation": "1 sentence"},
    "inflation": {"cpi": "X%","ppi": "X%","interpretation": "1 sentence"},
    "employment": {"urban_unemployment": "X%","youth_unemployment": "X%","interpretation": "1 sentence"},
    "forward_indicators": [{"name": "Electricity/Freight","value": "reading","interpretation": "1 sentence"}],
    "overall_assessment": "High|Medium-High|Medium|Medium-Low|Low",
    "overall_assessment_text": "2-3 sentence economic health bottom line."
  },
  "source_count": {"submissions": ${analyzed ? analyzed.length : 0}, "high_priority_submissions": ${highPriority ? highPriority.length : 0}}
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
        model: 'claude-sonnet-4-6',
        max_tokens: 6000,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const aiData = await aiRes.json();

    // Web search returns multiple blocks - collect all text blocks
    const allText = (aiData.content || [])
      .filter(b => b.type === 'text' && b.text)
      .map(b => b.text)
      .join('\n')
      .trim()
      .replace(/```json|```/g, '')
      .trim();

    const first = allText.indexOf('{');
    const last = allText.lastIndexOf('}');
    if (first === -1 || last === -1) throw new Error('No JSON: ' + allText.slice(0,200));

    let jsonStr = allText.slice(first, last + 1);

    // Fix common Claude JSON issues
    // 1. Remove trailing commas before } or ]
    jsonStr = jsonStr.replace(/,\s*([}\]])/g, '$1');
    // 2. Fix unescaped quotes inside strings (basic fix)
    // 3. Truncate at last valid closing brace if parse fails
    let briefContent;
    try {
      briefContent = JSON.parse(jsonStr);
    } catch(e1) {
      // Try progressively shorter strings until valid
      let validJson = null;
      for (let i = jsonStr.length - 1; i > 0; i--) {
        if (jsonStr[i] === '}') {
          try {
            const candidate = jsonStr.slice(0, i + 1);
            validJson = JSON.parse(candidate);
            break;
          } catch(e2) { continue; }
        }
      }
      if (!validJson) throw new Error('Invalid JSON: ' + e1.message);
      briefContent = validJson;
    }

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
};
