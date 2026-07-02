import { beforeEach, describe, expect, it } from 'vite-plus/test'
import { makeTimelineAudioItem, makeTimelineTrack, makeTimelineVideoItem } from '../../test-helpers'
import { useItemsStore } from '../items-store'
import { useKeyframesStore } from '../keyframes-store'
import { useTransitionsStore } from '../transitions-store'
import { useTimelineCommandStore } from '../timeline-command-store'
import { useTimelineSettingsStore } from '../timeline-settings-store'
import {
  applyBentoLayout,
  commitMaskEdit,
  resetItemTransform,
  updateItemTransform,
  updateItemsTransform,
  updateItemsTransformMap,
} from './transform-actions'

function makeClip(id: string, overrides: Record<string, unknown> = {}) {
  return makeTimelineVideoItem({ id, transform: {}, ...overrides })
}

function getTransform(id: string) {
  const item = useItemsStore.getState().itemById[id]
  expect(item).toBeDefined()
  return (item as { transform?: Record<string, number> }).transform ?? {}
}

describe('transform actions', () => {
  beforeEach(() => {
    useTimelineCommandStore.getState().clearHistory()
    useTimelineSettingsStore.setState({ fps: 30, isDirty: false })
    useItemsStore
      .getState()
      .setTracks([makeTimelineTrack({ id: 'track-v1', name: 'V1', kind: 'video', order: 0 })])
    useItemsStore.getState().setItems([makeClip('a'), makeClip('b', { from: 60 })])
    useTransitionsStore.getState().setTransitions([])
    useKeyframesStore.getState().setKeyframes([])
  })

  describe('updateItemTransform', () => {
    it('merges partial transforms into the existing transform', () => {
      updateItemTransform('a', { x: 10, y: -5 })
      updateItemTransform('a', { opacity: 0.5 })

      expect(getTransform('a')).toMatchObject({ x: 10, y: -5, opacity: 0.5 })
      expect(useTimelineSettingsStore.getState().isDirty).toBe(true)
    })

    it('undo restores the previous transform', () => {
      updateItemTransform('a', { x: 10 })
      updateItemTransform('a', { x: 25 })

      useTimelineCommandStore.getState().undo()
      expect(getTransform('a').x).toBe(10)
    })
  })

  describe('multi-item transforms', () => {
    it('updateItemsTransform applies one transform to several items', () => {
      updateItemsTransform(['a', 'b'], { rotation: 45 })

      expect(getTransform('a').rotation).toBe(45)
      expect(getTransform('b').rotation).toBe(45)
    })

    it('updateItemsTransformMap applies per-item transforms in one undo entry', () => {
      const undoDepth = useTimelineCommandStore.getState().undoStack.length

      updateItemsTransformMap(
        new Map([
          ['a', { x: 1 }],
          ['b', { x: 2 }],
        ]),
      )

      expect(getTransform('a').x).toBe(1)
      expect(getTransform('b').x).toBe(2)
      expect(useTimelineCommandStore.getState().undoStack.length).toBe(undoDepth + 1)
    })
  })

  describe('resetItemTransform', () => {
    it('zeroes position and rotation', () => {
      updateItemTransform('a', { x: 10, y: 20, rotation: 90 })

      resetItemTransform('a')

      const transform = getTransform('a')
      expect(transform.x).toBe(0)
      expect(transform.y).toBe(0)
      expect(transform.rotation).toBe(0)
    })
  })

  describe('commitMaskEdit', () => {
    it('commits path vertices, transform, and auto-keyframes as one undo entry', () => {
      const undoDepth = useTimelineCommandStore.getState().undoStack.length
      const vertices = [
        {
          position: [0, 0] as [number, number],
          inHandle: [0, 0] as [number, number],
          outHandle: [0, 0] as [number, number],
        },
        {
          position: [1, 0] as [number, number],
          inHandle: [0, 0] as [number, number],
          outHandle: [0, 0] as [number, number],
        },
        {
          position: [1, 1] as [number, number],
          inHandle: [0, 0] as [number, number],
          outHandle: [0, 0] as [number, number],
        },
      ]

      commitMaskEdit('a', {
        pathVertices: vertices,
        transform: { x: 5 },
        autoKeyframeOperations: [{ type: 'add', itemId: 'a', property: 'x', frame: 0, value: 5 }],
      })

      const item = useItemsStore.getState().itemById['a'] as { pathVertices?: unknown }
      expect(item.pathVertices).toEqual(vertices)
      expect(getTransform('a').x).toBe(5)
      const keyframes = useKeyframesStore
        .getState()
        .getKeyframesForItem('a')
        ?.properties.find((group) => group.property === 'x')?.keyframes
      expect(keyframes).toHaveLength(1)
      expect(useTimelineCommandStore.getState().undoStack.length).toBe(undoDepth + 1)
    })

    it('is a no-op when the commit is empty', () => {
      const undoDepth = useTimelineCommandStore.getState().undoStack.length

      commitMaskEdit('a', {})

      expect(useTimelineCommandStore.getState().undoStack.length).toBe(undoDepth)
      expect(useTimelineSettingsStore.getState().isDirty).toBe(false)
    })
  })

  describe('applyBentoLayout', () => {
    it('lays out visual items and clears conflicting transform keyframes', () => {
      useKeyframesStore.getState()._addKeyframe('a', 'x', 0, 50)
      useKeyframesStore.getState()._addKeyframe('a', 'opacity', 0, 1)
      const undoDepth = useTimelineCommandStore.getState().undoStack.length

      applyBentoLayout(['a', 'b'], 1920, 1080)

      // Both items received computed layout transforms
      for (const id of ['a', 'b']) {
        const transform = getTransform(id)
        expect(typeof transform.x).toBe('number')
        expect(typeof transform.width).toBe('number')
        expect(transform.width).toBeGreaterThan(0)
      }
      // Bento-controlled keyframes cleared, others preserved
      const groups = useKeyframesStore.getState().getKeyframesForItem('a')?.properties ?? []
      expect(groups.find((group) => group.property === 'x')?.keyframes ?? []).toHaveLength(0)
      expect(groups.find((group) => group.property === 'opacity')?.keyframes).toHaveLength(1)
      expect(useTimelineCommandStore.getState().undoStack.length).toBe(undoDepth + 1)
    })

    it('does nothing with fewer than two visual items', () => {
      const audio = makeTimelineAudioItem({ id: 'audio-1' })
      useItemsStore.getState().setItems([makeClip('a'), audio])
      const undoDepth = useTimelineCommandStore.getState().undoStack.length

      applyBentoLayout(['a', 'audio-1'], 1920, 1080)

      expect(useTimelineCommandStore.getState().undoStack.length).toBe(undoDepth)
      expect(getTransform('a')).toEqual({})
    })
  })
})
