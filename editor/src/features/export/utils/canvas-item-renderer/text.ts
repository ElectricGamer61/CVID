/**
 * Text item and subtitle segment rendering.
 *
 * Geometry (wrapping, line positions, baselines, alignment, background) comes
 * from the shared {@link layoutTextBlock}; this module only paints the result
 * onto a Canvas 2D context. Native `ctx.letterSpacing` + `fontKerning` (set via
 * the canvas measurer) make the advance match the DOM preview, so a single
 * `fillText`/`strokeText` per line reproduces CSS — no per-character drawing.
 */

import type { SubtitleSegmentItem, TextItem } from '@/types/timeline'
import { parseSubtitleCueText } from '@/shared/utils/subtitle-cue-format'
import {
  layoutTextBlock,
  lineInkWidth,
  type LaidOutLine,
} from '@/shared/typography/text-block-layout'
import {
  applyCanvasLetterSpacing,
  createCanvasTextMeasurer,
} from '@/shared/typography/text-measurer'
import type { ItemRenderContext, TextRasterCacheEntry } from './types'

/** Cap a single cached raster so a pathological box doesn't blow out memory. */
const TEXT_RASTER_MAX_PIXELS = 32_000_000 // ~32MP (~128MB) per entry ceiling
/** Total RAM budget for the preview text-raster cache. */
const TEXT_RASTER_CACHE_MAX_BYTES = 256_000_000 // ~256MB

/**
 * Build a cache key from everything that affects the rasterized pixels. It must
 * exclude frame-varying state that's applied at composite time (position,
 * rotation, opacity) so a static text item produces a stable key across scrub
 * frames. Box width/height ARE included because they drive wrapping/layout.
 */
export function getTextRasterCacheKey(item: TextItem, boxWidth: number, boxHeight: number): string {
  return JSON.stringify({
    w: Math.round(boxWidth),
    h: Math.round(boxHeight),
    text: item.text,
    textSpans: item.textSpans,
    fontSize: item.fontSize,
    fontFamily: item.fontFamily,
    fontWeight: item.fontWeight,
    fontStyle: item.fontStyle,
    underline: item.underline,
    color: item.color,
    backgroundColor: item.backgroundColor,
    backgroundRadius: item.backgroundRadius,
    textAlign: item.textAlign,
    verticalAlign: item.verticalAlign,
    lineHeight: item.lineHeight,
    letterSpacing: item.letterSpacing,
    textPadding: item.textPadding,
    textShadow: item.textShadow,
    stroke: item.stroke,
    textStyleScale: item.textStyleScale,
    textLayoutDrafts: item.textLayoutDrafts,
  })
}

function pruneTextRasterCache(cache: Map<string, TextRasterCacheEntry>): void {
  let total = 0
  for (const entry of cache.values()) total += entry.bytes
  // Evict oldest (insertion order) until within budget, keeping the newest entry.
  for (const [key, entry] of cache) {
    if (total <= TEXT_RASTER_CACHE_MAX_BYTES || cache.size <= 1) break
    cache.delete(key)
    total -= entry.bytes
  }
}

/**
 * Paint the laid-out text block (background → shadow → lines) into `ctx` with
 * the item box's top-left at (originX, originY). Shared by the direct draw and
 * the offscreen rasterization paths so both produce identical pixels.
 */
function paintTextBlock(
  ctx: OffscreenCanvasRenderingContext2D,
  item: TextItem,
  boxWidth: number,
  boxHeight: number,
  originX: number,
  originY: number,
  rctx: ItemRenderContext,
): void {
  const { textMeasureCache } = rctx
  const measurer = createCanvasTextMeasurer(ctx, (text, letterSpacing) =>
    textMeasureCache.measure(ctx, text, letterSpacing),
  )
  const layout = layoutTextBlock(item, boxWidth, boxHeight, measurer)

  if (item.backgroundColor && layout.background) {
    const bg = layout.background
    ctx.fillStyle = item.backgroundColor
    if (bg.radius > 0) {
      ctx.beginPath()
      ctx.roundRect(originX + bg.x, originY + bg.y, bg.width, bg.height, bg.radius)
      ctx.fill()
    } else {
      ctx.fillRect(originX + bg.x, originY + bg.y, bg.width, bg.height)
    }
  }

  if (item.textShadow) {
    ctx.shadowColor = item.textShadow.color
    ctx.shadowBlur = item.textShadow.blur
    ctx.shadowOffsetX = item.textShadow.offsetX
    ctx.shadowOffsetY = item.textShadow.offsetY
  }

  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'
  const strokeWidth = item.stroke?.width ?? 0

  for (const line of layout.lines) {
    if (line.text.length === 0) continue
    const x = originX + line.startX
    const y = originY + line.baselineY

    ctx.font = line.cssFont
    applyCanvasLetterSpacing(ctx, line.letterSpacing)
    ctx.fillStyle = line.color

    if (item.stroke && strokeWidth > 0) {
      ctx.strokeStyle = item.stroke.color
      ctx.lineWidth = strokeWidth * 2
      ctx.lineJoin = 'round'
      ctx.strokeText(line.text, x, y)
    }

    ctx.fillText(line.text, x, y)

    if (line.underline) {
      drawUnderline(ctx, line, x, y)
    }
  }
}

/**
 * Rasterize a text block into a standalone padded OffscreenCanvas. Padding
 * leaves room for shadow spread and glyph overflow so the cached image matches
 * the unclipped preview render. Returns null if it shouldn't be cached.
 */
function rasterizeTextBlock(
  item: TextItem,
  boxWidth: number,
  boxHeight: number,
  rctx: ItemRenderContext,
): TextRasterCacheEntry | null {
  const blur = item.textShadow?.blur ?? 0
  const offX = Math.abs(item.textShadow?.offsetX ?? 0)
  const offY = Math.abs(item.textShadow?.offsetY ?? 0)
  const fontSize = item.fontSize ?? 0
  // Canvas shadowBlur fades out within ~2-3x its value; pad generously, plus a
  // font-size-relative margin for ascenders/descenders/side-bearings.
  const padX = Math.ceil(blur * 2 + offX + fontSize * 0.5)
  const padY = Math.ceil(blur * 2 + offY + fontSize * 0.7)
  const width = Math.max(1, Math.ceil(boxWidth) + padX * 2)
  const height = Math.max(1, Math.ceil(boxHeight) + padY * 2)
  if (width * height > TEXT_RASTER_MAX_PIXELS) return null

  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  paintTextBlock(ctx, item, boxWidth, boxHeight, padX, padY, rctx)
  return { canvas, padX, padY, bytes: width * height * 4 }
}

/**
 * Render text item with clipping and word wrapping to match preview (WYSIWYG).
 *
 * In preview mode the rasterized box is cached and reused across frames (keyed
 * on content/style/size). Position, rotation and opacity are applied to `ctx`
 * by the caller before this runs, so the cached image composites correctly via
 * a single drawImage — turning ~100ms+ re-rasterization into a ~1ms blit while
 * scrubbing over static text.
 */
export function renderTextItem(
  ctx: OffscreenCanvasRenderingContext2D,
  item: TextItem,
  transform: { x: number; y: number; width: number; height: number },
  rctx: ItemRenderContext,
): void {
  const { canvasSettings } = rctx

  const itemLeft = canvasSettings.width / 2 + transform.x - transform.width / 2
  const itemTop = canvasSettings.height / 2 + transform.y - transform.height / 2

  // Preview: serve from / populate the cross-frame raster cache.
  const cache = rctx.textRasterCache
  if (rctx.renderMode === 'preview' && cache && transform.width >= 1 && transform.height >= 1) {
    const key = getTextRasterCacheKey(item, transform.width, transform.height)
    let entry: TextRasterCacheEntry | null | undefined = cache.get(key)
    if (entry) {
      // LRU touch: re-insert to move to the newest position.
      cache.delete(key)
      cache.set(key, entry)
    } else {
      entry = rasterizeTextBlock(item, transform.width, transform.height, rctx)
      if (entry) {
        cache.set(key, entry)
        pruneTextRasterCache(cache)
      }
    }
    if (entry) {
      ctx.drawImage(entry.canvas, itemLeft - entry.padX, itemTop - entry.padY)
      return
    }
    // Rasterization declined (e.g. oversized box) — fall through to direct paint.
  }

  ctx.save()
  // Preview mode should match the live DOM preview behavior where text isn't
  // hard-clipped to the item box while editing.
  if (rctx.renderMode !== 'preview') {
    ctx.beginPath()
    ctx.rect(itemLeft, itemTop, transform.width, transform.height)
    ctx.clip()
  }

  paintTextBlock(ctx, item, transform.width, transform.height, itemLeft, itemTop, rctx)

  ctx.restore()
}

/**
 * Render a {@link SubtitleSegmentItem}: find the active cue at the current
 * frame, then synthesize an ephemeral TextItem and reuse {@link renderTextItem}
 * so the export pipeline picks up font/shadow/stroke/wrap behavior with no
 * duplicated logic. Cues are stored segment-relative so we measure from
 * `frame - item.from`, not absolute timeline frames.
 */
export function renderSubtitleSegmentItem(
  ctx: OffscreenCanvasRenderingContext2D,
  item: SubtitleSegmentItem,
  transform: { x: number; y: number; width: number; height: number },
  frame: number,
  rctx: ItemRenderContext,
): void {
  const fps = rctx.canvasSettings.fps || 30
  const secondsIntoSegment = (frame - item.from) / fps
  const activeCue = findActiveSubtitleCue(item.cues, secondsIntoSegment)
  if (!activeCue) return
  const parsed = parseSubtitleCueText(activeCue.text)
  if (parsed.isEmpty) return

  const ephemeralText: TextItem = {
    id: item.id,
    type: 'text',
    trackId: item.trackId,
    from: item.from,
    durationInFrames: item.durationInFrames,
    label: item.label,
    mediaId: item.mediaId,
    text: parsed.plainText,
    textSpans: parsed.spans,
    fontSize: item.fontSize,
    fontFamily: item.fontFamily,
    fontWeight: item.fontWeight,
    fontStyle: item.fontStyle,
    underline: item.underline,
    color: item.color,
    backgroundColor: item.backgroundColor,
    backgroundRadius: item.backgroundRadius,
    textAlign: parsed.alignment?.textAlign ?? item.textAlign,
    verticalAlign: parsed.alignment?.verticalAlign ?? item.verticalAlign,
    lineHeight: item.lineHeight,
    letterSpacing: item.letterSpacing,
    textPadding: item.textPadding,
    textShadow: item.textShadow,
    stroke: item.stroke,
    transform: item.transform,
  }
  renderTextItem(ctx, ephemeralText, transform, rctx)
}

function findActiveSubtitleCue<T extends { startSeconds: number; endSeconds: number }>(
  cues: readonly T[],
  seconds: number,
): T | null {
  if (cues.length === 0) return null
  let lo = 0
  let hi = cues.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const cue = cues[mid]!
    if (seconds < cue.startSeconds) {
      hi = mid - 1
    } else if (seconds >= cue.endSeconds) {
      lo = mid + 1
    } else {
      return cue
    }
  }
  return null
}

/**
 * Underline a rendered line. Spans the visible ink (excludes trailing
 * letter-spacing); the line is already left-anchored at `x`.
 */
function drawUnderline(
  ctx: OffscreenCanvasRenderingContext2D,
  line: LaidOutLine,
  x: number,
  baselineY: number,
): void {
  const width = lineInkWidth(line)
  if (width <= 0) return

  const underlineY = baselineY + Math.max(1, line.fontSize * 0.08)
  const previousLineWidth = ctx.lineWidth
  const previousStrokeStyle = ctx.strokeStyle

  ctx.beginPath()
  ctx.lineWidth = Math.max(1, line.fontSize * 0.05)
  ctx.strokeStyle = ctx.fillStyle
  ctx.moveTo(x, underlineY)
  ctx.lineTo(x + width, underlineY)
  ctx.stroke()

  ctx.lineWidth = previousLineWidth
  ctx.strokeStyle = previousStrokeStyle
}
