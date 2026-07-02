import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import {
  beginPlaybackColdStart,
  cancelPlaybackColdStart,
  isPlaybackColdStartPending,
  markPlaybackColdStart,
  resolvePlaybackColdStartFrameAdvance,
} from './playback-cold-start-event'

function emittedEvents(infoSpy: { mock: { calls: unknown[][] } }) {
  return infoSpy.mock.calls
    .filter(
      (call): call is [string, Record<string, unknown>] =>
        typeof call[0] === 'string' && call[0].includes('playback_cold_start'),
    )
    .map((call) => call[1])
}

describe('playback cold start wide event', () => {
  let infoSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    // Drain any measurement leaked from a previous test before spying.
    cancelPlaybackColdStart('test_cleanup')
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
  })

  afterEach(() => {
    cancelPlaybackColdStart('test_cleanup')
    infoSpy.mockRestore()
  })

  it('emits a completed event on the first frame advance past the start frame', () => {
    beginPlaybackColdStart(
      { startFrame: 100, forceFastScrubOverlay: true, audioContextState: 'running' },
      1000,
    )
    expect(isPlaybackColdStartPending()).toBe(true)

    // Same frame does not resolve the measurement.
    resolvePlaybackColdStartFrameAdvance(100, 1010)
    expect(isPlaybackColdStartPending()).toBe(true)

    resolvePlaybackColdStartFrameAdvance(101, 1042)
    expect(isPlaybackColdStartPending()).toBe(false)

    const events = emittedEvents(infoSpy)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      result: 'completed',
      start_frame: 100,
      first_advanced_frame: 101,
      ms_to_first_frame_advance: 42,
      force_fast_scrub_overlay: true,
      audio_context_state: 'running',
      visibility_state_at_play: 'visible',
      hidden_during_measurement: false,
      outcome: 'success',
    })
  })

  it('flags measurements that overlap a hidden-tab period', () => {
    beginPlaybackColdStart(
      { startFrame: 0, forceFastScrubOverlay: true, audioContextState: 'running' },
      0,
    )

    // Simulate the tab going hidden mid-measurement (rAF-driven Clock freezes,
    // so the resulting duration says nothing about real cold start).
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    })
    document.dispatchEvent(new Event('visibilitychange'))
    Reflect.deleteProperty(document, 'visibilityState')

    resolvePlaybackColdStartFrameAdvance(1, 2500)

    const events = emittedEvents(infoSpy)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      result: 'completed',
      hidden_during_measurement: true,
    })
  })

  it('merges gate context marked while the measurement is active', () => {
    beginPlaybackColdStart(
      { startFrame: 0, forceFastScrubOverlay: false, audioContextState: null },
      0,
    )
    markPlaybackColdStart({ variable_speed_items: 2 })
    markPlaybackColdStart({ prewarm_gate_ms: 180 })
    resolvePlaybackColdStartFrameAdvance(1, 250)

    const events = emittedEvents(infoSpy)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      variable_speed_items: 2,
      prewarm_gate_ms: 180,
      audio_context_state: 'unavailable',
      ms_to_first_frame_advance: 250,
    })
  })

  it('emits a cancelled event when playback stops before any frame advanced', () => {
    beginPlaybackColdStart(
      { startFrame: 50, forceFastScrubOverlay: true, audioContextState: 'suspended' },
      500,
    )
    cancelPlaybackColdStart('paused_before_first_frame_advance', 620)

    const events = emittedEvents(infoSpy)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      result: 'cancelled',
      cancel_reason: 'paused_before_first_frame_advance',
      ms_to_cancel: 120,
    })
    expect(isPlaybackColdStartPending()).toBe(false)
  })

  it('flushes an unresolved measurement as superseded when a new play begins', () => {
    beginPlaybackColdStart(
      { startFrame: 0, forceFastScrubOverlay: true, audioContextState: 'running' },
      0,
    )
    beginPlaybackColdStart(
      { startFrame: 10, forceFastScrubOverlay: true, audioContextState: 'running' },
      100,
    )
    resolvePlaybackColdStartFrameAdvance(11, 130)

    const events = emittedEvents(infoSpy)
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({
      result: 'cancelled',
      cancel_reason: 'superseded_by_new_play',
    })
    expect(events[1]).toMatchObject({ result: 'completed', start_frame: 10 })
  })

  it('ignores resolve and mark calls when no measurement is active', () => {
    markPlaybackColdStart({ stray: true })
    resolvePlaybackColdStartFrameAdvance(5)
    cancelPlaybackColdStart('noop')
    expect(emittedEvents(infoSpy)).toHaveLength(0)
  })
})
