import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL'),
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
)

const HIVE_SIZE = 2

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
    return new Response(JSON.stringify({ message: 'Hive not full yet', count: picks.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

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
