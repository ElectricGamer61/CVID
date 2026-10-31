import { Fragment } from "react";
import { ACTIVE_POP, CaptionStyle, EMPHASIS_POP, FIT_MARGIN, captionAt, fitLayout, Word } from "./captionStyles";

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
  // Same layout rule the export uses: two rows and/or a smaller size for a line that would
  // otherwise run off the frame (captions.fit_layout). Identical inputs, identical result.
  const fit = fitLayout(cap.line, style);

  // ASS size is on a 1920-tall canvas; scale to the actual preview height.
  const px = (style.size / 1920) * containerHeight * fit.scale;
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
        // The style's 80 px side margins on the 1080-wide canvas. The line never wraps on its
        // own (WrapStyle 2 in the export): fitLayout decides any break.
        padding: `0 ${(FIT_MARGIN / 1080) * 100}%`,
        whiteSpace: "nowrap",
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
        const scale = active ? ACTIVE_POP : emph ? EMPHASIS_POP : 1;
        return (
          <Fragment key={i}>
          {fit.split === i ? <br /> : null}
          <span
            style={{
              color: active || emph ? style.highlight : style.color,
              fontWeight: emph ? 900 : undefined,
              display: "inline-block",
              // The pop scales the TYPE, not a transform: libass's \fscx112 widens the glyphs
              // and pushes the rest of the line along, so a transform (which doesn't reflow)
              // made the popped word overlap its neighbour — badly at the big cinematic size.
              fontSize: scale === 1 ? undefined : `${scale}em`,
              transition: "font-size 0.08s",
              margin: "0 0.12em",
            }}
          >
            {style.uppercase ? w.word.trim().toUpperCase() : w.word.trim()}
            {w.emoji ? <span style={{ marginLeft: "0.15em" }}>{w.emoji}</span> : null}
          </span>
          </Fragment>
        );
      })}
    </div>
  );
}
