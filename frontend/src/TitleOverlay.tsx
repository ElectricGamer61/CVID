import type { CSSProperties } from "react";

import { CaptionStyle } from "./captionStyles";
import { fitTitle, TITLE_BASE_H, TitleCard, titleMargins, TITLE_BASE_W, titleVisible } from "./looks";

/* The big cinematic title over the 9:16 preview. Geometry mirrors captions._title_style_line
   (ASS alignment + margins) and looks.wrap_title, so what you place here is what gets burned:
   a side title lives in a ~52% column hugging its edge — that's how it ends up BESIDE the
   person without any segmentation to go wrong. */
export function TitleOverlay({ title, time, style, containerHeight }: {
  title: TitleCard | undefined | null;
  time: number;                 // clip-local (post-cut) seconds, same clock as the captions
  style: CaptionStyle;          // for the font + accent colour, so the title belongs to the clip
  containerHeight: number;
}) {
  if (!titleVisible(title, time)) return null;
  const t = title!;
  // Line breaks AND size come from the same fit the export uses (on the 1080x1920 ASS
  // canvas), then scale to the preview box — so preview and export break identically.
  const { lines, size } = fitTitle(t.text, t.place);
  if (!lines.length) return null;
  const px = (size / TITLE_BASE_H) * containerHeight;
  const [ml, mr] = titleMargins(t.place);
  const pct = (v: number) => `${(v / TITLE_BASE_W) * 100}%`;
  const ring = Math.max(1.5, px * 0.055);
  const dur = Math.max(0.4, t.duration);
  const fade = Math.min(0.4, Math.max(0.15, dur / 6));
  const since = time - t.start;
  const opacity = Math.max(0, Math.min(1, Math.min(since / fade, (dur - since) / fade)));
  const grow = Math.min(1, Math.max(0, since / (fade + 0.06)));
  const scale = 0.86 + 0.14 * grow;

  const side: CSSProperties = { left: pct(ml), right: pct(mr) };
  const box: CSSProperties =
    t.place === "left" ? { ...side, top: "50%", transform: "translateY(-50%)", textAlign: "left" }
      : t.place === "right" ? { ...side, top: "50%", transform: "translateY(-50%)", textAlign: "right" }
        : t.place === "top" ? { ...side, top: "10%", textAlign: "center" }
          : t.place === "bottom" ? { ...side, bottom: "26%", textAlign: "center" }
            : { ...side, top: "50%", transform: "translateY(-50%)", textAlign: "center" };

  const outline = [
    `${ring}px ${ring}px 0 #000`, `-${ring}px -${ring}px 0 #000`,
    `${ring}px -${ring}px 0 #000`, `-${ring}px ${ring}px 0 #000`,
    `0 ${ring}px 0 #000`, `0 -${ring}px 0 #000`,
    `${ring}px 0 0 #000`, `-${ring}px 0 0 #000`,
  ].join(",");
  const skin: CSSProperties =
    t.style === "boxed"
      ? { background: "rgba(0,0,0,0.62)",
          padding: `${px * 0.14}px ${px * 0.24}px`, borderRadius: px * 0.1 }
      : t.style === "glow"
        ? { textShadow: `0 0 ${px * 0.22}px ${style.highlight},0 0 ${px * 0.5}px ${style.highlight},${outline}` }
        : { textShadow: `${outline},${ring * 1.6}px ${ring * 1.6}px ${ring}px rgba(0,0,0,0.55)` };

  return (
    <div style={{
      position: "absolute", pointerEvents: "none", ...box,
      transformOrigin: t.place === "right" ? "right center" : t.place === "left" ? "left center" : "center",
      opacity,
    }}>
      <div style={{
        fontFamily: `${style.font}, Arial, sans-serif`, fontWeight: 900, fontSize: px,
        lineHeight: 1.06, letterSpacing: "0.01em", color: "#fff",
        transform: `scale(${scale})`, transformOrigin: "inherit",
        transition: "transform 0.08s linear",
      }}>
        {lines.map((l, i) => (
          <div key={i}><span style={{ ...skin, display: "inline-block" }}>{l || " "}</span></div>
        ))}
      </div>
    </div>
  );
}
