module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  const now     = new Date();
  const today   = now.toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
  const dateStr = now.toISOString().split('T')[0];

  const prompt = `China economic analyst supporting US DoD strategy. Date: ${today}.

Search for and provide the latest available China macroeconomic data. Be specific with actual figures where known.

Return ONLY raw JSON starting { ending }:
{"date":"${dateStr}","generated":"${now.toISOString()}","overview":"3-4 sentences on China macro condition, trajectory, and key risks relevant to US strategic competition.","dod_relevance":"2-3 sentences on what the economic picture means for China defense spending capacity and military modernization sustainability.","indicators":[{"name":"GDP Growth Rate","value":"latest figure","previous":"prior period","trend":"Rising|Falling|Stable|Uncertain","interpretation":"strategic significance for US competition"},{"name":"Defense Budget","value":"latest announced figure","previous":"prior year","trend":"Rising|Falling|Stable","interpretation":"military modernization capacity"},{"name":"Retail Sales","value":"latest YoY %","previous":"prior month","trend":"Rising|Falling|Stable|Uncertain","interpretation":"domestic demand and consumer confidence"}],"pmi":{"manufacturing":"NBS and Caixin figures with dates","services":"NBS and Caixin figures","interpretation":"what PMI signals about economic momentum and industrial capacity"},"trade":{"exports":"latest YoY %","imports":"latest YoY %","surplus":"$X billion","key_partners":"US, EU, ASEAN — notable developments in trade relationships","interpretation":"trade dependency, decoupling risks, economic coercion leverage"},"currency":{"usd_cny":"current exchange rate","trend":"Appreciation|Depreciation|Stable","pboc_action":"recent PBOC interventions or policy moves","interpretation":"capital flow, financial stability, currency war risks"},"real_estate":{"status":"current market condition","key_developers":"Evergrande, Country Garden, Vanke — current status","policy_response":"government stabilization measures","interpretation":"systemic financial risk and fiscal drag on growth"},"inflation":{"cpi":"latest CPI figure","ppi":"latest PPI figure","interpretation":"deflation risk, consumer weakness, impact on corporate margins"},"employment":{"urban_unemployment":"latest rate","youth_unemployment":"latest rate","interpretation":"social stability pressure and CCP political risk"},"foreign_investment":{"fdi":"latest FDI figures and trend","trend":"Rising|Falling|Stable","interpretation":"business confidence, technology decoupling, sanctions effectiveness"},"debt":{"local_government":"LGFV debt situation and scale","corporate":"corporate debt stress indicators","household":"household debt and consumption outlook","interpretation":"systemic risk assessment and fiscal capacity for military spending"},"forward_indicators":[{"name":"Electricity Consumption","value":"latest reading and YoY change","interpretation":"true economic activity signal beyond official GDP"},{"name":"Rail Freight Volume","value":"latest reading","interpretation":"supply chain activity and industrial output proxy"},{"name":"Property Investment","value":"YoY change","interpretation":"construction sector health and fiscal multiplier"}],"overall_assessment":"High|Medium-High|Medium|Medium-Low|Low","overall_assessment_text":"3-4 sentences on China economic health trajectory, key downside risks, and implications for ability to sustain military modernization at current pace."}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    clearTimeout(timeout);

    const data = await r.json();
    const text = (data.content||[]).filter(b=>b.type==='text'&&b.text).map(b=>b.text).join('\n')
      .replace(/```json|```/g,'').trim();
    const first = text.indexOf('{'), last = text.lastIndexOf('}');
    if (first===-1||last===-1) throw new Error('No JSON in response');
    let s = text.slice(first,last+1).replace(/,\s*([}\]])/g,'$1');
    const econ = JSON.parse(s);
    return res.status(200).json(econ);
  } catch(e) {
    const msg = e.name === 'AbortError' ? 'Request timed out — try again' : e.message;
    return res.status(500).json({ error: msg });
  }
};
