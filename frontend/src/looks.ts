/* Cinematic Look + big title — the browser half.
 *
 * Mirrors backend/app/pipeline/look.py: SAME ids, labels and title geometry, so the preview
 * shows what the export burns. CSS has no curves/colorbalance, so each look is approximated
 * with a CSS filter + a translucent tint + a vignette — but the constants are FITTED against
 * real ffmpeg renders (see lookLayers), so the preview lands within ~2/255 per channel of the
 * exported grade rather than merely gesturing at it.
 *
 * A clip with no look (`id: "none"`) produces NO filter and NO overlay: the preview is
 * pixel-identical to how it was before this feature, exactly like the export.
 */

export interface LookOption { id: string; label: string; hint: string }
export interface LookSetting { id: string; strength: number }

export const DEFAULT_STRENGTH = 0.6;

// Fallback for when /api/presets hasn't loaded (mirrors look.LOOKS, same order).
export const FALLBACK_LOOKS: LookOption[] = [
  { id: "none", label: "None", hint: "no colour change" },
  { id: "warm_film", label: "Warm Film", hint: "golden, filmic warmth" },
  { id: "cold_cinema", label: "Cold Cinema", hint: "cool teal blockbuster" },
  { id: "punchy", label: "Punchy", hint: "crisp, high contrast" },
  { id: "soft_glow", label: "Soft Glow", hint: "dreamy, lifted blacks" },
  { id: "night", label: "Night", hint: "moody blue low key" },
];

export const STRENGTHS: { value: number; label: string }[] = [
  { value: 0.35, label: "Subtle" },
  { value: 0.6, label: "Medium" },
  { value: 1, label: "Strong" },
];

export interface LookLayers {
  filter?: string;                                    // CSS filter on the <video>
  tint?: { color: string; opacity: number; blend: string };
  vignette: number;                                   // 0 = none
}

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : DEFAULT_STRENGTH);
const r2 = (v: number) => Math.round(v * 1000) / 1000;

/** How to paint one look over the preview. `none`/unknown/0 strength -> nothing at all.
 *
 * The constants below are FITTED, not guessed: each look was rendered both ways on the same
 * frame (ffmpeg vs this CSS) and the brightness/tint iterated until the mean RGB matched. At
 * full strength every look now lands within ~2/255 per channel of the real export - before
 * fitting, Night was off by 29. Re-fit if you change a chain in look.py.
 */
export function lookLayers(look: LookSetting | undefined | null): LookLayers {
  const id = look?.id;
  if (!id || id === "none") return { vignette: 0 };
  const s = clamp01(look!.strength ?? DEFAULT_STRENGTH);
  if (s <= 0.001) return { vignette: 0 };
  const f = (contrast: number, saturate: number, brightness: number) =>
    `contrast(${r2(1 + contrast * s)}) saturate(${r2(1 + saturate * s)}) brightness(${r2(1 + brightness * s)})`;
  const tint = (color: string, opacity: number, blend = "soft-light") =>
    ({ color, opacity: r2(opacity * s), blend });
  switch (id) {
    case "warm_film":
      return { filter: f(0.14, 0.12, -0.1), tint: tint("#ff9a3c", 0.25), vignette: r2(0.5 * s) };
    case "cold_cinema":
      return { filter: f(0.18, -0.1, -0.13), tint: tint("#2f7fd1", 0.2), vignette: r2(0.55 * s) };
    case "punchy":
      return { filter: f(0.28, 0.28, 0.01), vignette: 0 };
    case "soft_glow":
      return { filter: f(-0.06, 0.1, -0.03), tint: tint("#ffffff", 0.11, "screen"), vignette: 0 };
    case "night":
      return { filter: f(0.22, -0.28, -0.36), tint: tint("#1a3a80", 0.26), vignette: r2(0.7 * s) };
    default:
      return { vignette: 0 };
  }
}

/* ---------------- optional one-off big hook line ----------------
 *
 * The everyday big-text experience is the `cinematic` CAPTION preset (captionStyles.ts):
 * the subtitles themselves are the big text. What follows is the SECONDARY, optional
 * extra — one standalone hook line you type, laid out across the frame near the subject
 * by margins alone. There is no matting and nothing is cut out behind anyone.
 */

export interface TitlePlaceOption { id: string; label: string }
export interface TitleCard {
  text: string;
  place: string;       // left | right | top | bottom | center
  style: string;       // bold | glow | boxed
  start: number;       // seconds into the EXPORTED clip
  duration: number;
}

export const TITLE_PLACES: TitlePlaceOption[] = [
  { id: "left", label: "Left side" },
  { id: "right", label: "Right side" },
  { id: "top", label: "Top" },
  { id: "bottom", label: "Bottom" },
  { id: "center", label: "Across frame" },
];
export const TITLE_STYLES: { id: string; label: string }[] = [
  { id: "bold", label: "Bold" },
  { id: "glow", label: "Glow" },
  { id: "boxed", label: "Boxed" },
];
export const DEFAULT_TITLE_DURATION = 3;
export const emptyTitle = (): TitleCard =>
  ({ text: "", place: "left", style: "bold", start: 0, duration: DEFAULT_TITLE_DURATION });

/* Title geometry — mirrors look.py exactly (title_margins / title_size / fit_title), computed
   on the same 1080x1920 baseline the ASS uses, so the preview breaks its lines in the same
   places and at the same relative size as the burned title. */
export const TITLE_BASE_W = 1080;
export const TITLE_BASE_H = 1920;
const CHAR_EM = 0.6;

/** [marginLeft, marginRight] in baseline pixels. A side title lives in a ~58% column. */
export function titleMargins(place: string): [number, number] {
  const edge = Math.floor(TITLE_BASE_W * 0.06);
  const gutter = Math.floor(TITLE_BASE_W * 0.36);
  if (place === "left") return [edge, gutter];
  if (place === "right") return [gutter, edge];
  return [edge, edge];
}

export function titleBaseSize(place: string): number {
  return Math.max(40, Math.floor(TITLE_BASE_H * (place === "left" || place === "right" ? 0.062 : 0.072)));
}

/** Same line-breaking as look.wrap_title — ASS never auto-wraps, so the preview must break
    in exactly the same places as the burned title. */
export function wrapTitle(text: string, maxChars: number): string[] {
  const lines: string[] = [];
  for (const para of (text || "").replace(/\r/g, "").split("\n")) {
    let cur = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const cand = cur ? `${cur} ${word}` : word;
      if (cur && cand.length > maxChars) { lines.push(cur); cur = word; }
      else cur = cand;
    }
    lines.push(cur);
  }
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  return lines;
}

/** Line breaks + font size that FIT the placement's column. Mirrors look.fit_title. */
export function fitTitle(text: string, place: string): { lines: string[]; size: number } {
  const [ml, mr] = titleMargins(place);
  const column = Math.max(1, TITLE_BASE_W - ml - mr);
  let size = titleBaseSize(place);
  const perLine = Math.max(5, Math.floor(column / (CHAR_EM * size)));
  const lines = wrapTitle(text, perLine);
  if (!lines.length) return { lines, size };
  const widest = Math.max(...lines.map((l) => l.length)) * CHAR_EM * size;
  if (widest > column) size = Math.max(24, Math.floor((size * column) / widest));
  return { lines, size };
}

/** Is the title on screen at this (clip-local, post-cut) time? */
export function titleVisible(t: TitleCard | undefined | null, time: number): boolean {
  if (!t || !t.text.trim()) return false;
  return time >= t.start - 0.001 && time <= t.start + Math.max(0.4, t.duration);
}
