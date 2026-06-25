module.exports = async function handler(req, res) {
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

  // Load analyst profile — use userId from query param if present
  let analystProfile = null;
  try {
    const userId = req.query.userId || 'default';
    const profUrl = userId === 'default'
      ? `${SUPABASE_URL}/rest/v1/analyst_profiles?id=eq.default&limit=1`
      : `${SUPABASE_URL}/rest/v1/analyst_profiles?user_id=eq.${userId}&limit=1`;
    const profRes = await fetch(profUrl, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
    });
    const profRows = await profRes.json();
    if (profRows?.[0]?.data) analystProfile = profRows[0].data;
  } catch(e) {}

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

  // Build analyst profile context
  const profileContext = analystProfile ? `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ANALYST PROFILE — TAILOR THIS BRIEF TO THIS USER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Role / Title: ${analystProfile.role || 'Not specified'}
Unit / Organization: ${analystProfile.unit || 'Not specified'}
Command / MAJCOM: ${analystProfile.command || 'Not specified'}
Primary Mission Area: ${analystProfile.mission_area || 'Not specified'}
Geographic Area of Responsibility: ${analystProfile.aor || 'Not specified'}
Key Intelligence Questions: ${analystProfile.key_questions || 'Not specified'}
Priority Topics: ${(analystProfile.priority_topics || []).join(', ') || 'Not specified'}
Operational Context: ${analystProfile.operational_context || 'Not specified'}
How to tailor: ${analystProfile.tailoring_notes || 'Not specified'}

TAILORING INSTRUCTIONS: Shape the emphasis, depth, and recommendations of this brief to directly serve this analyst's role and mission. Highlight developments most relevant to their AOR and priority topics. Frame analysis through the lens of their operational context. Use appropriate military/DoD terminology. Where relevant, note implications for their specific command or mission area.
` : '';

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
${profileContext}
You have two source categories with DIFFERENT analytical weights:

SOURCE A - OPEN SOURCE NEWS & THINK TANK ANALYSIS [PRIMARY WEIGHT - 70-80% of analysis]
Use your web search tool to gather from TWO layers of sources:

LAYER 1 — DAILY NEWS (search for today's and this week's reporting):
Reuters, AP, Bloomberg, WSJ, Financial Times, South China Morning Post, Nikkei Asia, Defense News, Caixin Global. Find 4-6 current news stories per theme.

LAYER 2 — THINK TANK & POLICY RESEARCH (search for publications from the past month):
Systematically search each of the following for recent China-related analysis, reports, and commentary:
- Pacific Forum (pacforum.org) — Indo-Pacific security, alliances, nuclear issues
- Center for Strategic and International Studies (csis.org) — defense, technology, economy, Taiwan
- Hudson Institute (hudsoninstitute.org) — China strategy, military, technology competition
- Wilson Center (wilsoncenter.org) — policy analysis, diplomacy, China-US relations
- Congressional Research Service (crs.congress.gov) — policy briefings for Congress on China

Search each source explicitly. For example: search "csis.org China [theme] 2025" or "Hudson Institute China military 2025". Extract key findings, assessments, and policy recommendations from any publications found in the past 30 days.

Integrate think tank findings into the analysis alongside news — they provide deeper context, trend analysis, and expert assessment that daily news cannot. Where think tanks and daily news converge on a theme, that convergence is a strong analytical signal. Where they diverge, note it.

SOURCE B - FIELD SUBMISSIONS [CORROBORATING WEIGHT - 20-30% of analysis]
These are firsthand observation reports. They do not drive the analysis alone. Where they corroborate, contradict, or add texture to the news picture, call that out explicitly. High priority submissions carry more weight.

${subContext}

${historicalContext ? `HISTORICAL BRIEF CONTEXT:\n${historicalContext}` : ''}

INSTRUCTIONS:
1. SEARCH DAILY NEWS first — find today's and this week's most significant China stories across Economy, Regional Goals, Military, and Technology from major news outlets.
2. SEARCH THINK TANKS — explicitly search each of these five sources for China publications from the past 30 days:
   a. site:csis.org China (search for recent reports and commentary)
   b. site:pacforum.org China (search for recent publications)
   c. site:hudsoninstitute.org China (search for recent analysis)
   d. site:wilsoncenter.org China (search for recent publications)
   e. site:crs.congress.gov China (search for recent CRS reports)
   Fetch and read any relevant publications you find. Extract their key findings and integrate them.
3. Collect ALL significant stories and analysis regardless of whether field submissions exist for that topic.
4. Build the full analysis from BOTH news AND think tank sources. Think tank analysis adds depth, historical context, and expert assessment. Weight recent think tank reports heavily — they represent considered expert opinion, not just breaking news.
5. Where think tanks and daily news CONVERGE on a theme, flag it as a strong signal. Where they DIVERGE, note the disagreement and explain why.
6. ONLY AFTER building this analysis, check whether field submissions corroborate, contradict, or add texture. Note it where relevant. Do not force connections.
7. The overall_assessment should reflect the composite picture from news + think tank analysis + field submissions.
8. ${briefType !== 'daily' ? 'Emphasize trajectory and change over time. Look for think tank trend analyses that span longer periods.' : 'Focus on what is most significant today, enriched by any relevant think tank context from the past month.'}
9. TECHNOLOGY SECTION: Cover a BROAD range of technology domains — semiconductors, space & aerospace, 5G/6G telecommunications, quantum computing, biotechnology & genomics, green/clean energy technology (solar, EVs, batteries), nuclear technology, robotics & manufacturing automation, cybersecurity & hacking, undersea cables, and dual-use military-civilian technologies. AI is just ONE of many domains and should NOT dominate the technology section. Aim for at least 4-5 different technology domains per brief.
10. ECONOMIC INDICATORS SECTION: Search specifically for the latest values of: China GDP growth, NBS and Caixin PMI (manufacturing and services), export/import data, USD/CNY exchange rate, CPI, PPI, urban and youth unemployment, FDI flows, property market data (Evergrande, Country Garden, new home prices), local government debt, and any alternative indicators like electricity consumption or freight volumes. Use the most recent data available — prioritize official NBS releases, PBOC statements, and reputable financial sources like Bloomberg, Reuters, and Caixin. This section should read like a Bloomberg economic dashboard, not a news summary.

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
    "technology":{ "tldr": "One sentence bottom line on China's BROAD technology development across multiple sectors — not just AI.", "analysis": "4-5 sentences covering a wide range of technology domains: semiconductors, space, telecom (5G/6G), quantum computing, biotech, green energy tech, nuclear, robotics, cyber, and dual-use tech. AI may be mentioned but should not dominate.", "trends": [ { "label": "...", "text": "...", "direction": "Rising|Falling|Stable|Uncertain" } ], "signals": [ { "label": "...", "value": "...", "desc": "..." } ], "risk": "...", "field_corroboration": "..." }
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
  "tailored_section": {
    "role_relevance": "2-3 sentences on what this brief's most important findings mean specifically for this analyst's role and mission. Omit if no profile set.",
    "priority_topic_highlights": [
      { "topic": "Topic from analyst priority list", "finding": "What this brief found on this specific topic", "implication": "Operational or mission implication for this analyst" }
    ],
    "recommended_actions": [
      "Specific action or follow-up this analyst should consider given their role"
    ]
  },
  "think_tank_sources": [
    {
      "org": "Organization name e.g. CSIS",
      "title": "Publication title",
      "date": "Publication date",
      "url": "URL if available",
      "key_finding": "One sentence on the most relevant finding used in this brief"
    }
  ],
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
        
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20251022',
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
