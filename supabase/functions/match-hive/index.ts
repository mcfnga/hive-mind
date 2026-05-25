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

  const { player_id } = await req.json()

  if (!player_id) {
    return new Response(JSON.stringify({ error: 'player_id required' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  await supabase.from('players').upsert({ id: player_id }, { onConflict: 'id', ignoreDuplicates: true })

  const { data: existingPick } = await supabase
    .from('picks')
    .select('hive_id, hives(id, hive_code, status)')
    .eq('player_id', player_id)
    .in('hives.status', ['open', 'full'])
    .maybeSingle()

  if (existingPick?.hives) {
    return new Response(JSON.stringify({ hive: existingPick.hives }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  const { data: openHives } = await supabase
    .from('hives')
    .select('id, hive_code, status')
    .eq('status', 'open')
    .limit(5)

  for (const hive of openHives ?? []) {
    const { data: count } = await supabase.rpc('pick_count', { hive_id: hive.id })
    if (count < HIVE_SIZE) {
      return new Response(JSON.stringify({ hive }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
  }

  const hiveCode = 'HIVE-' + Math.floor(1000 + Math.random() * 9000)
  const { data: newHive, error } = await supabase
    .from('hives')
    .insert({ hive_code: hiveCode, status: 'open' })
    .select()
    .single()

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  return new Response(JSON.stringify({ hive: newHive }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
})
