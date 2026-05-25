import { supabase } from './supabase'

// ---------------------------------------------------------------------------
// Player identity
// A random UUID is stored in localStorage so the same player is recognised
// across sessions without requiring sign-up.
// ---------------------------------------------------------------------------

const PLAYER_KEY = 'hive_player_id'

export function getOrCreatePlayerId() {
  let id = localStorage.getItem(PLAYER_KEY)
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem(PLAYER_KEY, id)
  }
  return id
}

export async function ensurePlayer(playerId) {
  // Insert is a no-op if the player already exists (upsert on primary key)
  const { error } = await supabase
    .from('players')
    .upsert({ id: playerId }, { onConflict: 'id', ignoreDuplicates: true })
  if (error) throw error
}

// ---------------------------------------------------------------------------
// Hive matching
// Calls the match-hive edge function, which either finds an open hive with
// room left or creates a fresh one. Returns the hive row.
// ---------------------------------------------------------------------------

export async function joinHive(playerId) {
  const { data, error } = await supabase.functions.invoke('match-hive', {
    body: { player_id: playerId },
  })
  if (error) throw error
  return data.hive // { id, hive_code, status }
}

// ---------------------------------------------------------------------------
// Submitting a pick
// Inserts the player's number into the picks table. The edge function
// close-hive is triggered automatically once all seats are filled.
// ---------------------------------------------------------------------------

export async function submitPick(hiveId, playerId, number) {
  const { data, error } = await supabase
    .from('picks')
    .insert({ hive_id: hiveId, player_id: playerId, number })
    .select()
    .single()

  if (error) {
    if (error.code === '23505') {
      // Already picked — fetch and return existing pick
      const { data: existing, error: fetchError } = await supabase
        .from('picks')
        .select()
        .eq('hive_id', hiveId)
        .eq('player_id', playerId)
        .single()
      if (fetchError) throw fetchError
      return existing
    }
    throw error
  }

  // Attempt to close the hive — succeeds silently if not full yet
  await supabase.functions.invoke('close-hive', {
    body: { hive_id: hiveId },
  })

  return data
}

// ---------------------------------------------------------------------------
// Real-time subscription
// Subscribes to changes on the hives table for a specific hive ID.
// When status flips to 'revealed', onReveal is called with all picks.
// ---------------------------------------------------------------------------

export function subscribeToHive(hiveId, { onPlayerJoined, onRevealed }) {
  console.log('Subscribing to hive:', hiveId)

  const channel = supabase
    .channel(`hive:${hiveId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'picks', filter: `hive_id=eq.${hiveId}` },
      (payload) => {
        console.log('Pick inserted:', payload)
        onPlayerJoined?.(payload.new)
      }
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'hives', filter: `id=eq.${hiveId}` },
      async (payload) => {
        console.log('Hive updated:', payload)
        if (payload.new.status === 'revealed') {
          const picks = await fetchPicks(hiveId)
          onRevealed?.(picks)
        }
      }
    )
    .subscribe((status) => {
      console.log('Subscription status:', status)
    })

  return () => supabase.removeChannel(channel)
}

// ---------------------------------------------------------------------------
// Fetch all picks for a hive (called after reveal)
// ---------------------------------------------------------------------------

export async function fetchPicks(hiveId) {
  const { data, error } = await supabase
    .from('picks')
    .select('player_id, number, score')
    .eq('hive_id', hiveId)
  if (error) throw error
  return data
}

// ---------------------------------------------------------------------------
// Scoring helper (mirrors the edge function logic, used client-side too)
// ---------------------------------------------------------------------------

export function scoreResult(myNumber, allPicks) {
  const allNumbers = allPicks.map((p) => p.number)
  const ct = allNumbers.filter((n) => n === myNumber).length

  if (ct === 1) return { score: 1000, label: 'Only you — perfect!', cls: 'verdict-unique', ct }
  if (ct <= 3) return { score: Math.round(1000 - (ct - 1) * 150), label: `${ct} people picked this`, cls: 'verdict-few', ct }
  if (ct <= 7) return { score: Math.round(700 - (ct - 3) * 80), label: `${ct} people picked this`, cls: 'verdict-few', ct }
  return { score: Math.max(50, Math.round(400 - (ct - 7) * 40)), label: `${ct} people picked this — crowded!`, cls: 'verdict-many', ct }
}
