import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL'),
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
)

const HIVE_SIZE = 100

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const { hive_id } = await req.json()

  if (!hive_id) {
    return new Response(JSON.stringify({ error: 'hive_id required' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  // Claim the hive — accept both 'open' and stuck 'scoring' states
  const { data: claimed, error: claimError } = await supabase
    .from('hives')
    .update({ status: 'scoring' })
    .eq('id', hive_id)
    .in('status', ['open', 'scoring'])
    .select()

  if (claimError) {
    return new Response(JSON.stringify({ error: claimError.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  if (!claimed || claimed.length === 0) {
    // Already revealed — bail silently
    return new Response(JSON.stringify({ message: 'Hive already revealed' }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  // Fetch all picks
  const { data: picks, error: picksError } = await supabase
    .from('picks')
    .select('id, player_id, number')
    .eq('hive_id', hive_id)

  if (picksError) {
    return new Response(JSON.stringify({ error: picksError.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  if (picks.length < HIVE_SIZE) {
    // Not full yet — revert status back to open
    await supabase.from('hives').update({ status: 'open' }).eq('id', hive_id)
    return new Response(JSON.stringify({ message: 'Hive not full yet', count: picks.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  // Score each pick
  const allNumbers = picks.map((p) => p.number)
  const scored = picks.map((pick) => {
    const ct = allNumbers.filter((n) => n === pick.number).length
    let score
    if (ct === 1) score = 1000
    else if (ct <= 3) score = Math.round(1000 - (ct - 1) * 150)
    else if (ct <= 7) score = Math.round(700 - (ct - 3) * 80)
    else score = Math.max(50, Math.round(400 - (ct - 7) * 40))
    return { id: pick.id, score }
  })

  for (const { id, score } of scored) {
    await supabase.from('picks').update({ score }).eq('id', id)
  }

  // Flip to revealed — this is what triggers the real-time subscription on clients
  const { error: updateError } = await supabase
    .from('hives')
    .update({ status: 'revealed', revealed_at: new Date().toISOString() })
    .eq('id', hive_id)

  if (updateError) {
    return new Response(JSON.stringify({ error: updateError.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  return new Response(JSON.stringify({ message: 'Hive revealed', scored }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
})
