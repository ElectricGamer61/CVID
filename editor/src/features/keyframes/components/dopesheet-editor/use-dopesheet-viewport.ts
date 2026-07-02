import { useCallback, useEffect, useMemo, useState } from 'react'
import { normalizeKeyframeNavigatorViewport } from './compact-navigator-utils'
import { MIN_VISIBLE_FRAMES } from './dopesheet-constants'
import type { Viewport } from './dopesheet-types'

interface UseDopesheetViewportOptions {
  totalFrames: number
  frameViewport: Viewport | undefined
  onFrameViewportChange: ((viewport: Viewport) => void) | undefined
}

interface UseDopesheetViewportResult {
  viewport: Viewport
  updateViewport: (next: Viewport | ((prev: Viewport) => Viewport)) => void
  normalizeViewport: (next: Viewport) => Viewport
  contentFrameMax: number
  minViewportFrames: number
}

/**
 * Owns the visible-frame viewport for the dopesheet, syncing with an optional
 * external `frameViewport` prop (used in split mode where the editor shares
 * its viewport with a sibling). Keeps the viewport clamped to the content
 * range and notifies the parent only when it actually changes.
 */
export function useDopesheetViewport({
  totalFrames,
  frameViewport,
  onFrameViewportChange,
}: UseDopesheetViewportOptions): UseDopesheetViewportResult {
  const contentFrameMax = useMemo(() => Math.max(totalFrames, 1), [totalFrames])
  const minViewportFrames = useMemo(
    () => Math.max(1, Math.min(MIN_VISIBLE_FRAMES, contentFrameMax)),
    [contentFrameMax],
  )

  const normalizeViewport = useCallback(
    (nextViewport: Viewport) =>
      normalizeKeyframeNavigatorViewport(nextViewport, contentFrameMax, minViewportFrames),
    [contentFrameMax, minViewportFrames],
  )

  const buildDefaultViewport = useCallback(
    (): Viewport =>
      normalizeViewport({
        startFrame: 0,
        endFrame: contentFrameMax,
      }),
    [contentFrameMax, normalizeViewport],
  )

  const [viewport, setViewport] = useState<Viewport>(() => frameViewport ?? buildDefaultViewport())

  const updateViewport = useCallback(
    (next: Viewport | ((prev: Viewport) => Viewport)) => {
      setViewport((prev) => {
        const resolved = normalizeViewport(typeof next === 'function' ? next(prev) : next)
        if (resolved.startFrame !== prev.startFrame || resolved.endFrame !== prev.endFrame) {
          onFrameViewportChange?.(resolved)
        }
        return resolved
      })
    },
    [normalizeViewport, onFrameViewportChange],
  )

  // Reset viewport when the content range changes (e.g. a different item or clip
  // duration) — the previous viewport may no longer fit the new content. Do NOT
  // reset on property/keyframe selection: the frame (time) axis is the same for
  // every property of a clip, so refitting there would discard the user's zoom.
  useEffect(() => {
    setViewport(frameViewport ? normalizeViewport(frameViewport) : buildDefaultViewport())
  }, [buildDefaultViewport, frameViewport, normalizeViewport])

  // Sync from external viewport when in split mode without overwriting if
  // the value hasn't actually changed (avoids feedback loops).
  useEffect(() => {
    if (!frameViewport) return
    setViewport((prev) => {
      const normalizedViewport = normalizeViewport(frameViewport)
      if (
        prev.startFrame === normalizedViewport.startFrame &&
        prev.endFrame === normalizedViewport.endFrame
      ) {
        return prev
      }
      return normalizedViewport
    })
  }, [frameViewport, normalizeViewport])

  return {
    viewport,
    updateViewport,
    normalizeViewport,
    contentFrameMax,
    minViewportFrames,
  }
}
