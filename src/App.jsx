import { useState, useEffect, useRef } from 'react'
import {
  getOrCreatePlayerId,
  ensurePlayer,
  joinHive,
  submitPick,
  subscribeToHive,
  scoreResult,
} from './lib/game'

const STORAGE_KEY = 'hive_streak_v1'

function loadStreak() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch (e) {}
  return { current: 0, best: 0, totalGames: 0, totalScore: 0, history: [], calDays: [] }
}

function saveStreak(s) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)) } catch (e) {}
}

function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function recordRound(streak, pick, score, label, cls) {
  const today = todayStr()
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  const yStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`
  if (streak.lastPlayedDate !== today) {
    streak.current = streak.lastPlayedDate === yStr ? streak.current + 1 : 1
  }
  streak.best = Math.max(streak.best, streak.current)
  streak.lastPlayedDate = today
  streak.totalGames += 1
  streak.totalScore += score
  if (!streak.calDays.includes(today)) streak.calDays.push(today)
  streak.history.unshift({ pick, score, label, cls, date: today })
  if (streak.history.length > 10) streak.history = streak.history.slice(0, 10)
  saveStreak(streak)
  return { ...streak }
}

const styles = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Syne:wght@400;500;700;800&display=swap');
  *{box-sizing:border-box;margin:0;padding:0;}
  :root{
    --bg:#0a0a0f;--surface:#13131a;--surface2:#1c1c26;--border:#2a2a3a;
    --accent:#7c6fef;--accent2:#a89ff0;--text:#e8e6ff;--muted:#6b6880;
    --good:#4ecb8d;--bad:#e05c6a;--warn:#e0a44e;
  }
  body{font-family:'Syne',sans-serif;background:var(--bg);color:var(--text);margin:0;}
  .app{min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;position:relative;overflow:hidden;}
  .app::before{content:'';position:absolute;inset:0;background:radial-gradient(ellipse 60% 40% at 50% 0%,rgba(124,111,239,0.12) 0%,transparent 70%);pointer-events:none;}
  .screen{width:100%;max-width:380px;display:flex;flex-direction:column;align-items:center;position:relative;z-index:1;}
  .hive-id{font-family:'DM Mono',monospace;font-size:11px;color:var(--muted);letter-spacing:0.12em;margin-bottom:32px;text-transform:uppercase;}
  .big-number{font-size:96px;font-weight:800;line-height:1;color:var(--text);text-align:center;margin:20px 0 8px;font-variant-numeric:tabular-nums;letter-spacing:-2px;}
  .number-label{font-size:12px;color:var(--muted);text-align:center;margin-bottom:28px;letter-spacing:0.08em;text-transform:uppercase;}
  .slider-wrap{width:100%;margin-bottom:32px;}
  input[type=range]{width:100%;-webkit-appearance:none;height:2px;background:var(--border);border-radius:1px;outline:none;}
  input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:20px;height:20px;border-radius:50%;background:var(--accent);cursor:pointer;border:3px solid var(--bg);}
  .slider-ends{display:flex;justify-content:space-between;margin-top:8px;}
  .slider-ends span{font-family:'DM Mono',monospace;font-size:11px;color:var(--muted);}
  .primary-btn{width:100%;padding:16px;background-color:#a89ff0;color:#0d0b1a;border:none;border-radius:12px;font-family:'Syne',sans-serif;font-size:15px;font-weight:700;cursor:pointer;letter-spacing:0.04em;transition:background-color 0.15s,transform 0.1s;}
  .primary-btn:hover{background-color:#c5bff7;}
  .primary-btn:active{transform:scale(0.98);}
  .primary-btn:disabled{opacity:0.5;cursor:not-allowed;}
  .ghost-btn{width:100%;margin-top:10px;padding:12px;background-color:transparent;color:var(--accent2);border:1px solid var(--accent);border-radius:12px;font-family:'Syne',sans-serif;font-size:13px;font-weight:600;cursor:pointer;transition:background-color 0.15s;}
  .ghost-btn:hover{background-color:rgba(124,111,239,0.15);}
  .text-btn{width:100%;margin-top:8px;padding:10px;background:none;border:none;color:var(--muted);font-family:'Syne',sans-serif;font-size:12px;cursor:pointer;}
  .text-btn:hover{color:var(--accent2);}
  .nav-row{display:flex;gap:8px;margin-bottom:28px;width:100%;max-width:380px;position:relative;z-index:1;}
  .nav-btn{flex:1;padding:8px;background:transparent;border:0.5px solid var(--border);border-radius:8px;font-family:'Syne',sans-serif;font-size:12px;color:var(--muted);cursor:pointer;transition:all 0.15s;}
  .nav-btn.active{border-color:var(--accent);color:var(--accent2);background:rgba(124,111,239,0.1);}
  .pulse-ring{width:60px;height:60px;border-radius:50%;border:2px solid var(--accent);margin:24px auto;animation:pulse 1.5s ease-in-out infinite;}
  @keyframes pulse{0%,100%{transform:scale(0.9);opacity:0.4;}50%{transform:scale(1.1);opacity:1;}}
  .progress-bar{width:100%;height:2px;background:var(--border);border-radius:1px;margin-top:24px;overflow:hidden;}
  .progress-fill{height:100%;background:var(--accent);border-radius:1px;transition:width 0.4s;}
  .result-verdict{font-size:13px;font-weight:500;margin-top:8px;padding:6px 14px;border-radius:20px;display:inline-block;}
  .verdict-unique{background:rgba(78,203,141,0.15);color:var(--good);}
  .verdict-few{background:rgba(124,111,239,0.15);color:var(--accent2);}
  .verdict-many{background:rgba(224,92,106,0.15);color:var(--bad);}
  .chart{width:100%;background:var(--surface);border:0.5px solid var(--border);border-radius:12px;padding:16px;}
  .bar-track{flex:1;height:8px;background:var(--surface2);border-radius:4px;overflow:hidden;}
  .bar-fill{height:100%;border-radius:4px;transition:width 0.6s cubic-bezier(.34,1.56,.64,1);}
  .streak-banner{width:100%;background:var(--surface);border:0.5px solid var(--border);border-radius:12px;padding:14px 16px;margin-bottom:20px;display:flex;align-items:center;justify-content:space-between;}
  .stats-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:20px;width:100%;}
  .stat-card{background:var(--surface);border:0.5px solid var(--border);border-radius:12px;padding:14px 10px;text-align:center;}
  .history-list{width:100%;background:var(--surface);border:0.5px solid var(--border);border-radius:12px;overflow:hidden;margin-bottom:20px;}
  .history-item{display:flex;align-items:center;gap:12px;padding:11px 16px;border-bottom:0.5px solid var(--border);}
  .history-item:last-child{border-bottom:none;}
  .error-box{background:rgba(224,92,106,0.1);border:0.5px solid var(--bad);border-radius:12px;padding:14px 16px;font-size:13px;color:var(--bad);margin-bottom:16px;width:100%;text-align:center;}
`

export default function App() {
  const [tab, setTab] = useState('play')
  const [phase, setPhase] = useState('pick')
  const [myPick, setMyPick] = useState(42)
  const [hive, setHive] = useState(null)
  const [allPicks, setAllPicks] = useState([])
  const [votedCount, setVotedCount] = useState(0)
  const [result, setResult] = useState(null)
  const [streak, setStreak] = useState(loadStreak)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [copied, setCopied] = useState(false)
  const unsubRef = useRef(null)
  const playerId = useRef(getOrCreatePlayerId())

  useEffect(() => {
    return () => { if (unsubRef.current) unsubRef.current() }
  }, [])

  async function handleLockIn() {
    setLoading(true)
    setError(null)
    try {
      await ensurePlayer(playerId.current)
      const hiveData = await joinHive(playerId.current)
      setHive(hiveData)
      await submitPick(hiveData.id, playerId.current, myPick)
      setPhase('waiting')

      const unsub = subscribeToHive(hiveData.id, {
        onPlayerJoined: () => setVotedCount((c) => c + 1),
        onRevealed: (picks) => {
          setAllPicks(picks)
          const r = scoreResult(myPick, picks)
          setResult(r)
          setStreak((s) => recordRound({ ...s }, myPick, r.score, r.label, r.cls))
          setPhase('reveal')
          if (unsubRef.current) unsubRef.current()
        },
      })
      unsubRef.current = unsub
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.')
      setPhase('pick')
    } finally {
      setLoading(false)
    }
  }

  function handlePlayAgain() {
    if (unsubRef.current) unsubRef.current()
    setPhase('pick')
    setMyPick(42)
    setHive(null)
    setAllPicks([])
    setVotedCount(0)
    setResult(null)
    setError(null)
  }

  function handleShare() {
    if (!result) return
    const txt = `Hive ${hive?.hive_code}\nI picked ${myPick} — ${result.label}\n${result.score} pts | ${streak.current} day streak\nplayhive.gg`
    navigator.clipboard.writeText(txt).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const dots = Array.from({ length: 50 }, (_, i) => (
    <div key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: i < votedCount ? '#7c6fef' : '#2a2a3a' }} />
  ))

  function buildDistribution() {
    const freq = {}
    allPicks.forEach((p) => { freq[p.number] = (freq[p.number] || 0) + 1 })
    const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1])
    const top = sorted.slice(0, 10)
    if (!top.find((e) => +e[0] === myPick)) top.push([String(myPick), freq[myPick] || 1])
    top.sort((a, b) => b[1] - a[1])
    const max = top[0][1]
    return { top, max }
  }

  return (
    <>
      <style>{styles}</style>
      <div className="app">

        {tab === 'play' && (
          <>
            <div className="nav-row">
              <button className={`nav-btn${tab === 'play' ? ' active' : ''}`} onClick={() => setTab('play')}>Play</button>
              <button className={`nav-btn${tab === 'stats' ? ' active' : ''}`} onClick={() => setTab('stats')}>Stats</button>
            </div>

            {phase === 'pick' && (
              <div className="screen">
                {error && <div className="error-box">{error}</div>}
                <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', width: 175, marginBottom: 6 }}>{dots}</div>
                <div style={{ fontFamily: 'DM Mono,monospace', fontSize: 11, color: 'var(--muted)', marginBottom: 28 }}>waiting for players</div>
                <div className="hive-id">Daily hive</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 20 }}>
                  <span style={{ fontSize: 16 }}>🔥</span>
                  <span style={{ fontFamily: 'DM Mono,monospace', fontSize: 12, color: 'var(--warn)', fontWeight: 500 }}>{streak.current} day streak</span>
                </div>
                <div className="big-number">{myPick}</div>
                <div className="number-label">your pick</div>
                <div className="slider-wrap">
                  <input type="range" min="1" max="100" value={myPick} step="1" onChange={(e) => setMyPick(+e.target.value)} />
                  <div className="slider-ends"><span>1</span><span>100</span></div>
                </div>
                <button className="primary-btn" onClick={handleLockIn} disabled={loading}>
                  {loading ? 'Joining hive...' : 'Lock it in'}
                </button>
              </div>
            )}

            {phase === 'waiting' && (
              <div className="screen" style={{ textAlign: 'center', padding: '40px 0' }}>
                <div className="hive-id">{hive?.hive_code}</div>
                <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Waiting for the hive</div>
                <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.6 }}>
                  You picked <strong style={{ color: 'var(--accent2)' }}>{myPick}</strong>.<br />Results drop when everyone votes.
                </div>
                <div className="pulse-ring" />
                <div style={{ fontFamily: 'DM Mono,monospace', fontSize: 13, color: 'var(--muted)' }}>{votedCount} / 50</div>
                <div className="progress-bar">
                  <div className="progress-fill" style={{ width: `${Math.round(votedCount / 50 * 100)}%` }} />
                </div>
              </div>
            )}

            {phase === 'reveal' && result && (() => {
              const { top, max } = buildDistribution()
              const numColor = result.cls === 'verdict-unique' ? 'var(--good)' : result.cls === 'verdict-few' ? 'var(--accent2)' : 'var(--bad)'
              return (
                <div style={{ width: '100%', maxWidth: 400, position: 'relative', zIndex: 1 }}>
                  <div style={{ textAlign: 'center', marginBottom: 16, fontFamily: 'DM Mono,monospace', fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.12em' }}>{hive?.hive_code} — results</div>
                  <div style={{ textAlign: 'center', marginBottom: 20 }}>
                    <div style={{ fontSize: 72, fontWeight: 800, lineHeight: 1, letterSpacing: -2, color: numColor }}>{myPick}</div>
                    <div className={`result-verdict ${result.cls}`}>{result.label}</div>
                  </div>
                  <div style={{ fontFamily: 'DM Mono,monospace', fontSize: 13, color: 'var(--muted)', textAlign: 'center', marginBottom: 20 }}>
                    Score <span style={{ color: 'var(--text)', fontSize: 22, fontWeight: 500 }}>{result.score}</span> pts
                  </div>
                  <div className="streak-banner">
                    <span style={{ fontSize: 20, marginRight: 10 }}>🔥</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--warn)' }}>{streak.current} day streak</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>
                        {streak.current > 1 ? `Keep it going!` : `Play again tomorrow to start a streak`}
                      </div>
                    </div>
                    <div style={{ fontFamily: 'DM Mono,monospace', fontSize: 11, color: 'var(--muted)' }}>best: {streak.best}</div>
                  </div>
                  <p style={{ fontSize: 11, color: 'var(--muted)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 12 }}>How the hive voted</p>
                  <div className="chart">
                    {top.map(([num, ct]) => {
                      const pct = Math.round(ct / max * 100)
                      const isMe = +num === myPick
                      const fillColor = isMe ? 'var(--good)' : ct >= 7 ? 'var(--bad)' : ct >= 4 ? 'var(--warn)' : 'var(--accent)'
                      return (
                        <div key={num} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 7 }}>
                          <span style={{ fontFamily: 'DM Mono,monospace', fontSize: 11, color: isMe ? 'var(--good)' : 'var(--muted)', width: 24, textAlign: 'right', fontWeight: isMe ? 500 : 400 }}>{num}</span>
                          <div className="bar-track"><div className="bar-fill" style={{ width: `${pct}%`, background: fillColor }} /></div>
                          <span style={{ fontFamily: 'DM Mono,monospace', fontSize: 10, color: 'var(--muted)', width: 16 }}>{ct}</span>
                        </div>
                      )
                    })}
                  </div>
                  <button className="primary-btn" style={{ marginTop: 20 }} onClick={handleShare}>
                    {copied ? 'Copied!' : 'Copy result to share'}
                  </button>
                  <button className="ghost-btn" onClick={handlePlayAgain}>Play another round</button>
                  <button className="text-btn" onClick={() => setTab('stats')}>View full stats</button>
                </div>
              )
            })()}
          </>
        )}

        {tab === 'stats' && (() => {
          const avg = streak.totalGames > 0 ? Math.round(streak.totalScore / streak.totalGames) : 0
          const uniqueCt = streak.history.filter((h) => h.cls === 'verdict-unique').length
          const uniquePct = streak.totalGames > 0 ? Math.round(uniqueCt / streak.totalGames * 100) : 0
          const today = todayStr()
          const calDays = Array.from({ length: 14 }, (_, i) => {
            const d = new Date(); d.setDate(d.getDate() - (13 - i))
            const s = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
            return { str: s, isToday: s === today, played: streak.calDays.includes(s) }
          })
          return (
            <>
              <div className="nav-row">
                <button className="nav-btn" onClick={() => setTab('play')}>Play</button>
                <button className="nav-btn active">Stats</button>
              </div>
              <div style={{ width: '100%', maxWidth: 400, position: 'relative', zIndex: 1 }}>
                <div className="stats-grid">
                  {[
                    { val: streak.current, label: 'Streak', color: 'var(--warn)' },
                    { val: streak.best, label: 'Best', color: 'var(--accent2)' },
                    { val: streak.totalGames, label: 'Played', color: 'var(--good)' },
                    { val: avg, label: 'Avg score', color: 'var(--accent2)' },
                    { val: `${uniquePct}%`, label: 'Unique', color: 'var(--good)' },
                    { val: streak.best, label: 'Best streak', color: 'var(--warn)' },
                  ].map(({ val, label, color }) => (
                    <div key={label} className="stat-card">
                      <div style={{ fontSize: 26, fontWeight: 800, color }}>{val}</div>
                      <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
                    </div>
                  ))}
                </div>
                <p style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Last 14 days</p>
                <div style={{ display: 'flex', gap: 5, marginBottom: 16, flexWrap: 'wrap' }}>
                  {calDays.map((d) => (
                    <div key={d.str} style={{ width: 22, height: 22, borderRadius: 4, background: d.isToday ? 'var(--good)' : d.played ? 'var(--accent)' : 'var(--surface2)', border: '0.5px solid var(--border)' }} />
                  ))}
                </div>
                <p style={{ fontSize: 11, color: 'var(--muted)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 12 }}>Recent rounds</p>
                <div className="history-list">
                  {streak.history.length === 0
                    ? <div style={{ padding: 20, textAlign: 'center', fontSize: 13, color: 'var(--muted)' }}>No rounds played yet</div>
                    : streak.history.map((h, i) => (
                      <div key={i} className="history-item">
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: h.cls === 'verdict-unique' ? 'var(--good)' : h.cls === 'verdict-few' ? 'var(--accent)' : 'var(--bad)', flexShrink: 0 }} />
                        <div style={{ fontFamily: 'DM Mono,monospace', fontSize: 13, fontWeight: 500, width: 28 }}>{h.pick}</div>
                        <div style={{ fontSize: 12, color: 'var(--muted)', flex: 1 }}>{h.label}</div>
                        <div style={{ fontFamily: 'DM Mono,monospace', fontSize: 12, fontWeight: 500 }}>{h.score}</div>
                      </div>
                    ))}
                </div>
                <button className="primary-btn" onClick={() => setTab('play')}>Back to game</button>
              </div>
            </>
          )
        })()}

      </div>
    </>
  )
}
