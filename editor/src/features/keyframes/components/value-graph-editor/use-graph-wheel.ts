/**
 * Graph wheel hook.
 * Owns the wheel handler: Ctrl/Cmd+wheel zooms about the mouse,
 * plain wheel pans the frame axis. Gates against active drags via
 * shared refs so the wheel does not interrupt a pointer drag in flight.
 */

import { useCallback, useEffect, useRef } from 'react'
import type { GraphViewport } from './types'
import {
  FRAME_ZOOM_IN_FACTOR,
  FRAME_ZOOM_OUT_FACTOR,
  type BezierDragStartState,
  type DragStartState,
} from './graph-interaction-types'

interface GraphDimensionsSlice {
  graphWidth: number
  frameRange: number
}

interface UseGraphWheelOptions {
  disabled: boolean
  viewport: GraphViewport
  graphDimensions: GraphDimensionsSlice
  screenToGraph: (screenX: number, screenY: number) => { frame: number; value: number }
  clampViewportToBounds: (next: GraphViewport) => GraphViewport
  ensureKeyframesRemainVisible: (next: GraphViewport) => GraphViewport
  dragStartRef: React.RefObject<DragStartState | null>
  bezierDragStartRef: React.RefObject<BezierDragStartState | null>
  onViewportChange?: (viewport: GraphViewport) => void
}

export interface UseGraphWheelReturn {
  handleWheel: (event: React.WheelEvent) => void
}

export function useGraphWheel({
  disabled,
  viewport,
  graphDimensions,
  screenToGraph,
  clampViewportToBounds,
  ensureKeyframesRemainVisible,
  dragStartRef,
  bezierDragStartRef,
  onViewportChange,
}: UseGraphWheelOptions): UseGraphWheelReturn {
  const onViewportChangeRef = useRef(onViewportChange)
  useEffect(() => {
    onViewportChangeRef.current = onViewportChange
  }, [onViewportChange])

  const handleWheel = useCallback(
    (event: React.WheelEvent) => {
      if (disabled) return
      // Don't zoom/pan while dragging a keyframe or bezier handle
      if (dragStartRef.current || bezierDragStartRef.current) return

      event.preventDefault()

      const rect = event.currentTarget.getBoundingClientRect()
      const mouseX = event.clientX - rect.left
      const mouseY = event.clientY - rect.top

      const { frameRange } = graphDimensions
      const { frame: mouseFrame } = screenToGraph(mouseX, mouseY)

      if (event.ctrlKey || event.metaKey) {
        const zoomFactor = event.deltaY > 0 ? FRAME_ZOOM_OUT_FACTOR : FRAME_ZOOM_IN_FACTOR
        const newFrameRange = frameRange * zoomFactor
        const frameRatioBefore = (mouseFrame - viewport.startFrame) / frameRange
        const unclampedStartFrame = mouseFrame - newFrameRange * frameRatioBefore
        const nextViewport = ensureKeyframesRemainVisible({
          ...viewport,
          startFrame: Math.max(0, unclampedStartFrame),
          endFrame: Math.max(0, unclampedStartFrame) + newFrameRange,
          minValue: viewport.minValue,
          maxValue: viewport.maxValue,
        })

        onViewportChangeRef.current?.({
          ...nextViewport,
          minValue: viewport.minValue,
          maxValue: viewport.maxValue,
        })
        return
      }

      const deltaFrames = Math.round(
        (event.deltaY / Math.max(1, graphDimensions.graphWidth)) * frameRange,
      )
      onViewportChangeRef.current?.(
        clampViewportToBounds({
          ...viewport,
          startFrame: viewport.startFrame + deltaFrames,
          endFrame: viewport.endFrame + deltaFrames,
        }),
      )
    },
    [
      disabled,
      viewport,
      screenToGraph,
      graphDimensions,
      ensureKeyframesRemainVisible,
      clampViewportToBounds,
      dragStartRef,
      bezierDragStartRef,
    ],
  )

  return { handleWheel }
}
