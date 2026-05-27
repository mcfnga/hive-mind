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
// Inserts the player's number. If they already have a pick in this hive
// (e.g. they refreshed), silently returns the existing pick instead.
// Does NOT call close-hive — the cron job handles that to avoid race conditions.
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

  return data
}

// ---------------------------------------------------------------------------
// Real-time subscription
// Subscribes to changes on the hives table for a specific hive ID.
// Handles both direct 'revealed' updates and the transient 'scoring' state
// by polling until revealed. Cleans up poll timer on unsubscribe.
// ---------------------------------------------------------------------------

export function subscribeToHive(hiveId, { onPlayerJoined, onRevealed }) {
  let pollTimer = null
  let revealed = false

  function triggerReveal() {
    if (revealed) return // Guard against double-firing
    revealed = true
    if (pollTimer) clearInterval(pollTimer)
    fetchPicks(hiveId).then((picks) => onRevealed?.(picks))
  }

  function startPolling() {
    if (pollTimer || revealed) return
    pollTimer = setInterval(async () => {
      const { data } = await supabase
        .from('hives')
        .select('status')
        .eq('id', hiveId)
        .single()
      if (data?.status === 'revealed') triggerReveal()
    }, 1500)
    // Safety timeout after 30 seconds
    setTimeout(() => { if (pollTimer) clearInterval(pollTimer) }, 30000)
  }

  const channel = supabase
    .channel(`hive:${hiveId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'picks', filter: `hive_id=eq.${hiveId}` },
      (payload) => {
        onPlayerJoined?.(payload.new)
      }
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'hives', filter: `id=eq.${hiveId}` },
      (payload) => {
        if (payload.new.status === 'revealed') {
          triggerReveal()
        } else if (payload.new.status === 'scoring') {
          // Scoring is transient — start polling until revealed
          startPolling()
        }
      }
    )
    .subscribe()

  // Return unsubscribe — cleans up channel AND any running poll timer
  return () => {
    if (pollTimer) clearInterval(pollTimer)
    supabase.removeChannel(channel)
  }
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
