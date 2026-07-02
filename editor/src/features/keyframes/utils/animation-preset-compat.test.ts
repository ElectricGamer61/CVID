import { describe, expect, it } from 'vite-plus/test'
import { buildEffectAnimatableProperty } from '@/types/keyframe'
import type { ItemKeyframes } from '@/types/keyframe'
import type { TimelineItem } from '@/types/timeline'
import { captureAnimationFromItem, getPresetCompatibility } from './animation-preset-compat'

function videoItem(overrides: Partial<TimelineItem> = {}): TimelineItem {
  return {
    id: 'v1',
    type: 'video',
    durationInFrames: 100,
    effects: [],
    ...overrides,
  } as unknown as TimelineItem
}

describe('captureAnimationFromItem', () => {
  it('normalizes frames so the earliest keyframe sits at 0', () => {
    const keyframes: ItemKeyframes = {
      itemId: 'v1',
      properties: [
        {
          property: 'x',
          keyframes: [
            { id: 'k2', frame: 60, value: 100, easing: 'linear' },
            { id: 'k1', frame: 30, value: 0, easing: 'linear' },
          ],
        },
      ],
    }

    const captured = captureAnimationFromItem(videoItem(), keyframes)

    expect(captured).not.toBeNull()
    expect(captured?.sourceItemType).toBe('video')
    expect(captured?.sourceDurationInFrames).toBe(100)
    expect(captured?.properties[0]?.keyframes.map((k) => k.frame)).toEqual([0, 30])
  })

  it('returns null when the clip has no keyframes', () => {
    expect(captureAnimationFromItem(videoItem(), undefined)).toBeNull()
    expect(captureAnimationFromItem(videoItem(), { itemId: 'v1', properties: [] })).toBeNull()
    expect(
      captureAnimationFromItem(videoItem(), {
        itemId: 'v1',
        properties: [{ property: 'x', keyframes: [] }],
      }),
    ).toBeNull()
  })

  it('carries the effect definition for animated effect-param keyframes', () => {
    const property = buildEffectAnimatableProperty('gpu-gaussian-blur', 'fx1', 'radius')
    const item = videoItem({
      effects: [
        {
          id: 'fx1',
          effect: { type: 'gpu-effect', gpuEffectType: 'gpu-gaussian-blur', params: { radius: 5 } },
          enabled: true,
        },
      ],
    } as Partial<TimelineItem>)
    const keyframes: ItemKeyframes = {
      itemId: 'v1',
      properties: [{ property, keyframes: [{ id: 'k1', frame: 0, value: 5, easing: 'linear' }] }],
    }

    const captured = captureAnimationFromItem(item, keyframes)

    expect(captured?.effects).toHaveLength(1)
    expect(captured?.effects[0]?.gpuEffectType).toBe('gpu-gaussian-blur')
  })
})

describe('getPresetCompatibility', () => {
  it('blocks a preset whose source type differs from the target', () => {
    const result = getPresetCompatibility(
      { sourceItemType: 'text', properties: [{ property: 'x', keyframes: [] }] },
      videoItem(),
    )
    expect(result).toEqual({ compatible: false, reason: 'type-mismatch' })
  })

  it('allows a same-type preset whose transform properties the target can host', () => {
    const result = getPresetCompatibility(
      { sourceItemType: 'video', properties: [{ property: 'x', keyframes: [] }] },
      videoItem(),
    )
    expect(result.compatible).toBe(true)
  })

  it('treats effect-param properties as compatible even when the target lacks the effect', () => {
    const property = buildEffectAnimatableProperty('gpu-gaussian-blur', 'fx1', 'radius')
    const result = getPresetCompatibility(
      { sourceItemType: 'video', properties: [{ property, keyframes: [] }] },
      videoItem({ effects: [] }),
    )
    // The effect is auto-added on apply, so it must not block compatibility.
    expect(result.compatible).toBe(true)
  })
})
