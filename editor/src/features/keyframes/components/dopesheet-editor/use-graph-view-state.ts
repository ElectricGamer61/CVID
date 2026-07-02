/**
 * Graph view state hook.
 * Owns the curve visibility set (with localStorage persistence per item),
 * the ruler unit, the show-all-handles + auto-zoom toggles, and the
 * vertical zoom level. Also exposes the toggle callbacks for individual
 * property curves and group curve batches.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { AnimatableProperty } from '@/types/keyframe'
import { loadGraphVisibleProperties, saveGraphVisibleProperties } from './graph-visibility-storage'

interface UseGraphViewStateOptions {
  itemId: string
  availableProperties: AnimatableProperty[]
  selectedProperty: AnimatableProperty | null
  onPropertyChange?: (property: AnimatableProperty | null) => void
  onActivePropertyChange?: (property: AnimatableProperty) => void
}

export interface UseGraphViewStateReturn {
  graphVisibleProperties: Set<AnimatableProperty>
  setGraphVisibleProperties: React.Dispatch<React.SetStateAction<Set<AnimatableProperty>>>
  graphRulerUnit: 'frames' | 'seconds'
  setGraphRulerUnit: React.Dispatch<React.SetStateAction<'frames' | 'seconds'>>
  showAllGraphHandles: boolean
  setShowAllGraphHandles: React.Dispatch<React.SetStateAction<boolean>>
  autoZoomGraphHeight: boolean
  setAutoZoomGraphHeight: React.Dispatch<React.SetStateAction<boolean>>
  graphVerticalZoomValue: number
  setGraphVerticalZoomValue: React.Dispatch<React.SetStateAction<number>>
  togglePropertyCurve: (property: AnimatableProperty) => void
  toggleGroupCurves: (properties: AnimatableProperty[]) => void
}

export function useGraphViewState({
  itemId,
  availableProperties,
  selectedProperty,
  onPropertyChange,
  onActivePropertyChange,
}: UseGraphViewStateOptions): UseGraphViewStateReturn {
  const skipNextSaveRef = useRef(false)
  const selectedPropertyRef = useRef<AnimatableProperty | null>(selectedProperty)

  const [graphRulerUnit, setGraphRulerUnit] = useState<'frames' | 'seconds'>('frames')
  const [showAllGraphHandles, setShowAllGraphHandles] = useState(false)
  const [autoZoomGraphHeight, setAutoZoomGraphHeight] = useState(true)
  const [graphVerticalZoomValue, setGraphVerticalZoomValue] = useState(0)
  const [graphVisibleProperties, setGraphVisibleProperties] = useState<Set<AnimatableProperty>>(
    () => loadGraphVisibleProperties(itemId, availableProperties, selectedProperty),
  )

  // Restore visible curves when clip selection or available properties change.
  // The selectedPropertyRef snapshot avoids re-running on every selectedProperty change.
  useEffect(() => {
    skipNextSaveRef.current = true
    setGraphVisibleProperties(
      loadGraphVisibleProperties(itemId, availableProperties, selectedPropertyRef.current),
    )
  }, [itemId, availableProperties])

  useEffect(() => {
    selectedPropertyRef.current = selectedProperty
  }, [selectedProperty])

  // Persist visible curves whenever they change (skip the restore-driven update).
  useEffect(() => {
    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false
      return
    }

    saveGraphVisibleProperties(itemId, graphVisibleProperties)
  }, [graphVisibleProperties, itemId])

  // Reset vertical zoom when the clip changes or auto-zoom mode toggles
  useEffect(() => {
    setGraphVerticalZoomValue(0)
  }, [itemId, autoZoomGraphHeight])

  const togglePropertyCurve = useCallback(
    (property: AnimatableProperty) => {
      setGraphVisibleProperties((prev) => {
        const next = new Set(prev)
        if (next.has(property)) {
          next.delete(property)
        } else {
          next.add(property)
        }
        // Set primary to this property when toggling on
        if (next.has(property)) {
          onPropertyChange?.(property)
          onActivePropertyChange?.(property)
        } else if (next.size > 0) {
          // Switch primary to first remaining visible
          const first = [...next][0]!
          onPropertyChange?.(first)
          onActivePropertyChange?.(first)
        }
        return next
      })
    },
    [onActivePropertyChange, onPropertyChange],
  )

  const toggleGroupCurves = useCallback(
    (properties: AnimatableProperty[]) => {
      if (properties.length === 0) return
      setGraphVisibleProperties((prev) => {
        const anyVisible = properties.some((p) => prev.has(p))
        const next = new Set(prev)
        if (anyVisible) {
          // Turn all off
          for (const p of properties) next.delete(p)
          if (next.size > 0) {
            const first = [...next][0]!
            onPropertyChange?.(first)
            onActivePropertyChange?.(first)
          }
        } else {
          // Turn all on
          for (const p of properties) next.add(p)
          onPropertyChange?.(properties[0]!)
          onActivePropertyChange?.(properties[0]!)
        }
        return next
      })
    },
    [onActivePropertyChange, onPropertyChange],
  )

  return {
    graphVisibleProperties,
    setGraphVisibleProperties,
    graphRulerUnit,
    setGraphRulerUnit,
    showAllGraphHandles,
    setShowAllGraphHandles,
    autoZoomGraphHeight,
    setAutoZoomGraphHeight,
    graphVerticalZoomValue,
    setGraphVerticalZoomValue,
    togglePropertyCurve,
    toggleGroupCurves,
  }
}
