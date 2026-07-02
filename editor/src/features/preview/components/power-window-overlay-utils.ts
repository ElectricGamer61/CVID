import type { ItemEffect } from '@/types/effects'
import type { Point } from '../types/gizmo'
import { rotatePoint } from '../utils/coordinate-transform'

export type PowerWindowHandle = 'center' | 'east' | 'west' | 'north' | 'south'

export interface PowerWindowParams {
  shape: string
  centerX: number
  centerY: number
  sizeX: number
  sizeY: number
  rotation: number
}

export interface PowerWindowDragState {
  handle: PowerWindowHandle
  startParams: PowerWindowParams
  startUv: Point
}

const MIN_WINDOW_SIZE = 0.02
const MAX_WINDOW_SIZE = 1.5

export function readPowerWindowParams(effect: ItemEffect): PowerWindowParams | null {
  if (effect.effect.type !== 'gpu-effect' || effect.effect.gpuEffectType !== 'gpu-power-window') {
    return null
  }
  const params = effect.effect.params
  return {
    shape: typeof params.shape === 'string' ? params.shape : 'ellipse',
    centerX: readNumber(params.centerX, 0.5),
    centerY: readNumber(params.centerY, 0.5),
    sizeX: readNumber(params.sizeX, 0.5),
    sizeY: readNumber(params.sizeY, 0.5),
    rotation: readNumber(params.rotation, 0),
  }
}

export function clampPowerWindowParams(params: PowerWindowParams): PowerWindowParams {
  return {
    ...params,
    centerX: clamp(params.centerX, 0, 1),
    centerY: clamp(params.centerY, 0, 1),
    sizeX: clamp(params.sizeX, MIN_WINDOW_SIZE, MAX_WINDOW_SIZE),
    sizeY: clamp(params.sizeY, MIN_WINDOW_SIZE, MAX_WINDOW_SIZE),
  }
}

export function derivePowerWindowDragParams(
  drag: PowerWindowDragState,
  currentUv: Point,
): PowerWindowParams {
  const next: PowerWindowParams = { ...drag.startParams }
  if (drag.handle === 'center') {
    next.centerX = drag.startParams.centerX + currentUv.x - drag.startUv.x
    next.centerY = drag.startParams.centerY + currentUv.y - drag.startUv.y
    return clampPowerWindowParams(next)
  }

  const center = { x: drag.startParams.centerX, y: drag.startParams.centerY }
  const local = rotatePoint(currentUv, center, -drag.startParams.rotation)
  if (drag.handle === 'east' || drag.handle === 'west') {
    next.sizeX = Math.abs(local.x - center.x) * 2
  }
  if (drag.handle === 'north' || drag.handle === 'south') {
    next.sizeY = Math.abs(local.y - center.y) * 2
  }
  return clampPowerWindowParams(next)
}

export function buildPowerWindowEffects(
  effects: readonly ItemEffect[],
  effectId: string,
  params: PowerWindowParams,
): ItemEffect[] {
  return effects.map((entry) => {
    if (entry.id !== effectId || entry.effect.type !== 'gpu-effect') return entry
    return {
      ...entry,
      effect: {
        ...entry.effect,
        params: {
          ...entry.effect.params,
          shape: params.shape,
          centerX: params.centerX,
          centerY: params.centerY,
          sizeX: params.sizeX,
          sizeY: params.sizeY,
          rotation: params.rotation,
        },
      },
    }
  })
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, value))
}
