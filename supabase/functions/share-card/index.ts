import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL'),
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
)

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const url = new URL(req.url)
  const hiveId = url.searchParams.get('hive_id')
  const playerId = url.searchParams.get('player_id')

  if (!hiveId || !playerId) {
    return new Response('Missing hive_id or player_id', { status: 400 })
  }

  const { data: hive } = await supabase
    .from('hives')
    .select('hive_code, status')
    .eq('id', hiveId)
    .single()

  if (!hive || hive.status !== 'revealed') {
    return new Response('Hive not revealed yet', { status: 400 })
  }

  const { data: picks } = await supabase
    .from('picks')
    .select('player_id, number, score')
    .eq('hive_id', hiveId)

  if (!picks || picks.length === 0) {
    return new Response('No picks found', { status: 404 })
  }

  const myPick = picks.find((p) => p.player_id === playerId)
  if (!myPick) {
    return new Response('Player pick not found', { status: 404 })
  }

  // Build distribution
  const freq: Record<number, number> = {}
  picks.forEach((p) => { freq[p.number] = (freq[p.number] || 0) + 1 })
  const sorted = Object.entries(freq).sort((a, b) => Number(b[1]) - Number(a[1]))
  const top = sorted.slice(0, 7)
  if (!top.find(([n]) => Number(n) === myPick.number)) {
    top.push([String(myPick.number), freq[myPick.number]])
  }
  top.sort((a, b) => Number(b[1]) - Number(a[1]))
  const maxCount = Number(top[0][1])

  const ct = freq[myPick.number] || 1
  const scoreLabel = ct === 1 ? 'Only you — perfect!' : `${ct} people picked this`
  const verdictColor = ct === 1 ? '#4ecb8d' : ct <= 3 ? '#a89ff0' : '#e05c6a'

  const barsHtml = top.map(([num, count]) => {
    const n = Number(num)
    const c = Number(count)
    const isMe = n === myPick.number
    const pct = Math.round((c / maxCount) * 100)
    const barColor = isMe ? '#4ecb8d' : c >= 7 ? '#e05c6a' : c >= 4 ? '#e0a44e' : '#7c6fef'
    return `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
        <span style="font-family:monospace;font-size:12px;color:${isMe ? '#4ecb8d' : '#6b6880'};width:28px;text-align:right;font-weight:${isMe ? 600 : 400};">${n}</span>
        <div style="flex:1;height:8px;background:#1c1c26;border-radius:4px;overflow:hidden;">
          <div style="width:${pct}%;height:100%;background:${barColor};border-radius:4px;"></div>
        </div>
        <span style="font-family:monospace;font-size:11px;color:${isMe ? '#4ecb8d' : '#6b6880'};width:16px;">${c}</span>
      </div>`
  }).join('')

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Hive — ${hive.hive_code}</title>
  <meta property="og:title" content="I picked ${myPick.number} — ${scoreLabel}"/>
  <meta property="og:description" content="${myPick.score} pts on ${hive.hive_code}. Can you pick a number nobody else picks?"/>
  <meta property="og:url" content="https://hive-mind-teal-two.vercel.app"/>
  <style>
    *{box-sizing:border-box;margin:0;padding:0;}
    body{background:#0a0a0f;font-family:'Segoe UI',sans-serif;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;}
    .card{background:#13131a;border:0.5px solid #2a2a3a;border-radius:16px;padding:32px;width:100%;max-width:480px;position:relative;overflow:hidden;}
    .card::before{content:'';position:absolute;inset:0;background:radial-gradient(ellipse 60% 40% at 50% 0%,rgba(124,111,239,0.15) 0%,transparent 70%);pointer-events:none;}
    .header{display:flex;justify-content:space-between;align-items:center;margin-bottom:28px;}
    .hive-code{font-family:monospace;font-size:11px;color:#6b6880;letter-spacing:2px;}
    .site{font-family:monospace;font-size:11px;color:#6b6880;}
    .number{font-size:80px;font-weight:800;line-height:1;letter-spacing:-3px;margin-bottom:10px;}
    .verdict{display:inline-block;padding:5px 14px;border-radius:20px;font-size:12px;font-weight:500;background:rgba(124,111,239,0.12);margin-bottom:20px;}
    .score-row{margin-bottom:24px;}
    .score-label{font-size:11px;color:#6b6880;margin-bottom:4px;font-family:monospace;}
    .score-val{font-size:28px;font-weight:700;color:#e8e6ff;font-family:monospace;}
    .divider{height:0.5px;background:#2a2a3a;margin:20px 0;}
    .chart-label{font-size:10px;color:#6b6880;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px;font-family:monospace;}
    .cta{margin-top:24px;text-align:center;}
    .cta a{display:inline-block;padding:12px 28px;background:#a89ff0;color:#0d0b1a;border-radius:10px;font-weight:700;font-size:14px;text-decoration:none;letter-spacing:0.04em;}
    .footer{margin-top:16px;text-align:center;font-size:11px;color:#6b6880;font-family:monospace;}
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <span class="hive-code">${hive.hive_code}</span>
      <span class="site">playhive.gg</span>
    </div>
    <div class="number" style="color:${verdictColor};">${myPick.number}</div>
    <div class="verdict" style="color:${verdictColor};">${scoreLabel}</div>
    <div class="score-row">
      <div class="score-label">score</div>
      <div class="score-val">${myPick.score} pts</div>
    </div>
    <div class="divider"></div>
    <div class="chart-label">Top picks</div>
    ${barsHtml}
    <div class="divider"></div>
    <div class="cta">
      <a href="https://hive-mind-teal-two.vercel.app">Play Hive</a>
    </div>
  </div>
  <div class="footer" style="margin-top:16px;">Can you pick a number nobody else picks?</div>
</body>
</html>`

  return new Response(html, {
    headers: {
      ...corsHeaders,
      'Content-Type': 'text/html',
      'Cache-Control': 'public, max-age=86400',
    },
  })
})
