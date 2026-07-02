import { CaptionStyle, captionAt, Word } from "./captionStyles";

// Renders the active caption line over the 9:16 preview, with the current word
// highlighted — mirrors how the burned ASS will look.
export function CaptionOverlay({
  words,
  time,
  style,
  containerHeight,
}: {
  words: Word[];
  time: number;
  style: CaptionStyle;
  containerHeight: number;
}) {
  const cap = captionAt(words, time, style.max_words);
  if (!cap) return null;

  // ASS size is on a 1920-tall canvas; scale to the actual preview height.
  const px = (style.size / 1920) * containerHeight;
  const outline = Math.max(1, (style.outline / 1920) * containerHeight);
  const pos =
    style.position === "top"
      ? { top: "8%" }
      : style.position === "mid"
      ? { top: "50%", transform: "translateY(-50%)" }
      : { bottom: "12%" };

  const shadow = `${outline}px ${outline}px 0 ${style.outline_color},` +
    `-${outline}px -${outline}px 0 ${style.outline_color},` +
    `${outline}px -${outline}px 0 ${style.outline_color},` +
    `-${outline}px ${outline}px 0 ${style.outline_color},` +
    `0 ${outline}px 0 ${style.outline_color},0 -${outline}px 0 ${style.outline_color},` +
    `${outline}px 0 0 ${style.outline_color},-${outline}px 0 0 ${style.outline_color}`;

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        padding: "0 6%",
        textAlign: "center",
        fontFamily: `${style.font}, Arial, sans-serif`,
        fontWeight: style.bold ? 800 : 600,
        fontSize: px,
        lineHeight: 1.15,
        textTransform: style.uppercase ? "uppercase" : "none",
        textShadow: shadow,
        pointerEvents: "none",
        ...pos,
      }}
    >
      {cap.line.map((w, i) => {
        const active = i === cap.activeIdx;
        // Opt-in AI emphasis: persistent pop in the highlight color (mirrors the burned ASS).
        const emph = !!w.emphasis;
        const scale = active ? 1.12 : emph ? 1.16 : 1;
        return (
          <span
            key={i}
            style={{
              color: active || emph ? style.highlight : style.color,
              fontWeight: emph ? 900 : undefined,
              display: "inline-block",
              transform: `scale(${scale})`,
              transition: "transform 0.08s",
              margin: "0 0.12em",
            }}
          >
            {style.uppercase ? w.word.trim().toUpperCase() : w.word.trim()}
            {w.emoji ? <span style={{ marginLeft: "0.15em" }}>{w.emoji}</span> : null}
          </span>
        );
      })}
    </div>
  );
}
