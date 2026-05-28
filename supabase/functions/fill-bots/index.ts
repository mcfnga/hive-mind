import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL'),
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
)

const HIVE_SIZE = 50
const BOT_WAIT_SECONDS = 90
const FOCAL = [1, 7, 10, 13, 17, 21, 25, 27, 33, 37, 42, 47, 50, 55, 61, 69, 73, 77, 80, 88, 99, 100]

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function botPick() {
  return Math.random() < 0.55
    ? FOCAL[Math.floor(Math.random() * FOCAL.length)]
    : Math.floor(1 + Math.random() * 100)
}

function calcScore(number: number, allNumbers: number[]) {
  const ct = allNumbers.filter((n) => n === number).length
  if (ct === 1) return 1000
  if (ct <= 3) return Math.round(1000 - (ct - 1) * 150)
  if (ct <= 7) return Math.round(700 - (ct - 3) * 80)
  return Math.max(50, Math.round(400 - (ct - 7) * 40))
}

async function scoreAndReveal(hiveId: string) {
  // Atomically claim the hive
  const { data: claimed } = await supabase
    .from('hives')
    .update({ status: 'scoring' })
    .eq('id', hiveId)
    .in('status', ['open', 'scoring'])
    .select()

  if (!claimed || claimed.length === 0) {
    return { ok: false, reason: 'already claimed or revealed' }
  }

  // Fetch all picks
  const { data: picks, error } = await supabase
    .from('picks')
    .select('id, number')
    .eq('hive_id', hiveId)

  if (error || !picks) {
    return { ok: false, reason: error?.message }
  }

  // Score each pick
  const allNumbers = picks.map((p) => p.number)
  for (const pick of picks) {
    const score = calcScore(pick.number, allNumbers)
    await supabase.from('picks').update({ score }).eq('id', pick.id)
  }

  // Flip to revealed
  const { error: revealError } = await supabase
    .from('hives')
    .update({ status: 'revealed', revealed_at: new Date().toISOString() })
    .eq('id', hiveId)

  if (revealError) {
    return { ok: false, reason: revealError.message }
  }

  return { ok: true, scored: picks.length }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const cutoff = new Date(Date.now() - BOT_WAIT_SECONDS * 1000).toISOString()

  const { data: staleHives, error } = await supabase
    .from('hives')
    .select('id, hive_code')
    .in('status', ['open', 'scoring'])
    .lt('created_at', cutoff)

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  if (!staleHives || staleHives.length === 0) {
    return new Response(JSON.stringify({ message: 'No stale hives found' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  const results = []

  for (const hive of staleHives) {
    const { data: existingPicks } = await supabase
      .from('picks')
      .select('id')
      .eq('hive_id', hive.id)

    const existingCount = existingPicks?.length ?? 0

    // Fill with bots if not full yet
    if (existingCount < HIVE_SIZE) {
      const botsNeeded = HIVE_SIZE - existingCount
      const botPicks = Array.from({ length: botsNeeded + 5 }, () => ({
        hive_id: hive.id,
        player_id: crypto.randomUUID(),
        number: botPick(),
      }))

      await supabase.from('players').upsert(
        botPicks.map((b) => ({ id: b.player_id })),
        { onConflict: 'id', ignoreDuplicates: true }
      )

      await supabase.from('picks').upsert(botPicks, {
        onConflict: 'hive_id,player_id',
        ignoreDuplicates: true,
      })
    }

    // Score and reveal directly — no HTTP call needed
    const result = await scoreAndReveal(hive.id)

    results.push({
      hive_id: hive.id,
      hive_code: hive.hive_code,
      pick_count: existingCount,
      bots_added: Math.max(0, HIVE_SIZE - existingCount),
      ...result,
    })
  }

  return new Response(JSON.stringify({ filled: results }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
})
