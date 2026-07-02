import type { AnimatableProperty } from '@/types/keyframe'
import { GRAPH_VISIBLE_PROPERTIES_STORAGE_KEY } from './dopesheet-constants'

function getDefaultGraphVisibleProperties(
  properties: AnimatableProperty[],
  selectedProperty: AnimatableProperty | null | undefined,
): Set<AnimatableProperty> {
  if (selectedProperty && properties.includes(selectedProperty)) {
    return new Set([selectedProperty])
  }

  const firstProperty = properties[0]
  return firstProperty ? new Set([firstProperty]) : new Set()
}

export function loadGraphVisibleProperties(
  itemId: string,
  properties: AnimatableProperty[],
  selectedProperty: AnimatableProperty | null | undefined,
): Set<AnimatableProperty> {
  const fallback = getDefaultGraphVisibleProperties(properties, selectedProperty)

  try {
    const raw = localStorage.getItem(`${GRAPH_VISIBLE_PROPERTIES_STORAGE_KEY}:${itemId}`)
    if (!raw) {
      return fallback
    }

    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return fallback
    }

    const normalized = parsed.filter(
      (property): property is AnimatableProperty =>
        typeof property === 'string' && properties.includes(property as AnimatableProperty),
    )

    if (parsed.length === 0) {
      return new Set()
    }

    return normalized.length > 0 ? new Set(normalized) : fallback
  } catch {
    return fallback
  }
}

export function saveGraphVisibleProperties(itemId: string, properties: Set<AnimatableProperty>) {
  try {
    localStorage.setItem(
      `${GRAPH_VISIBLE_PROPERTIES_STORAGE_KEY}:${itemId}`,
      JSON.stringify([...properties]),
    )
  } catch {
    // ignore localStorage write errors
  }
}
