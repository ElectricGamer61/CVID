/**
 * Wide-event instrumentation for playback cold start — the window between the
 * user pressing play and the first advancing frame reaching the preview.
 *
 * One measurement is active at a time (playback is a singleton):
 * - `beginPlaybackColdStart` on the store's `isPlaying` false→true transition
 * - `markPlaybackColdStart` to attach gate context (variable-speed prewarm
 *   await, pump start delay) as the start path progresses
 * - `resolvePlaybackColdStartFrameAdvance` on the first Clock framechange that
 *   moves past the start frame — emits the event
 * - `cancelPlaybackColdStart` when playback stops before any frame advanced —
 *   emits the event with `result: 'cancelled'` so aborted starts stay visible
 *
 * Visibility guard: the Clock is rAF-driven, so a hidden/occluded tab freezes
 * frame delivery entirely and resumes with a wall-time catch-up jump. A
 * measurement that overlaps a hidden period reports multi-second
 * `ms_to_first_frame_advance` values that say nothing about real cold start.
 * Such events are flagged `hidden_during_measurement: true` — exclude them
 * when reading the metric.
 */
import { createLogger, createOperationId, type WideEvent } from '@/shared/logging/logger'

const log = createLogger('PlaybackColdStart')

export interface PlaybackColdStartContext {
  startFrame: number
  forceFastScrubOverlay: boolean
  audioContextState: string | null
}

interface ActivePlaybackColdStart {
  event: WideEvent
  startFrame: number
  startMs: number
  hiddenDuringMeasurement: boolean
}

let active: ActivePlaybackColdStart | null = null

function readVisibilityState(): DocumentVisibilityState | 'unknown' {
  return typeof document !== 'undefined' ? document.visibilityState : 'unknown'
}

function handleVisibilityChange(): void {
  if (active && readVisibilityState() === 'hidden') {
    active.hiddenDuringMeasurement = true
  }
}

function watchVisibility(): void {
  if (typeof document === 'undefined') return
  document.addEventListener('visibilitychange', handleVisibilityChange)
}

function unwatchVisibility(): void {
  if (typeof document === 'undefined') return
  document.removeEventListener('visibilitychange', handleVisibilityChange)
}

export function beginPlaybackColdStart(
  ctx: PlaybackColdStartContext,
  nowMs: number = performance.now(),
): void {
  if (active) {
    emit('cancelled', 'superseded_by_new_play', nowMs)
  }
  const event = log.startEvent('playback_cold_start', createOperationId())
  const visibility = readVisibilityState()
  event.merge({
    start_frame: ctx.startFrame,
    force_fast_scrub_overlay: ctx.forceFastScrubOverlay,
    audio_context_state: ctx.audioContextState ?? 'unavailable',
    visibility_state_at_play: visibility,
  })
  active = {
    event,
    startFrame: ctx.startFrame,
    startMs: nowMs,
    hiddenDuringMeasurement: visibility === 'hidden',
  }
  watchVisibility()
}

/** Attach gate context (prewarm await ms, item counts, …) to the active measurement. */
export function markPlaybackColdStart(data: Record<string, unknown>): void {
  active?.event.merge(data)
}

/**
 * Complete the measurement on the first frame that advanced past the start
 * frame. Safe to call on every framechange — no-ops once resolved.
 */
export function resolvePlaybackColdStartFrameAdvance(
  frame: number,
  nowMs: number = performance.now(),
): void {
  if (!active || frame === active.startFrame) return
  active.event.merge({
    first_advanced_frame: frame,
    ms_to_first_frame_advance: Math.round(nowMs - active.startMs),
  })
  emit('completed', null, nowMs)
}

/** Playback stopped before any frame advanced — flush so the abort is visible. */
export function cancelPlaybackColdStart(reason: string, nowMs: number = performance.now()): void {
  if (!active) return
  emit('cancelled', reason, nowMs)
}

function emit(result: 'completed' | 'cancelled', cancelReason: string | null, nowMs: number): void {
  if (!active) return
  if (result === 'cancelled') {
    active.event.merge({ ms_to_cancel: Math.round(nowMs - active.startMs) })
    if (cancelReason !== null) {
      active.event.merge({ cancel_reason: cancelReason })
    }
  }
  active.event.merge({ hidden_during_measurement: active.hiddenDuringMeasurement })
  active.event.success({ result })
  active = null
  unwatchVisibility()
}

/** Test hook: true while a measurement is awaiting its first frame advance. */
export function isPlaybackColdStartPending(): boolean {
  return active !== null
}
