// Shared caption types + grouping logic. Mirrors backend captions.py so the live
// browser preview matches the burned ASS export.

export interface CaptionStyle {
  font: string;
  size: number; // ASS fontsize on the 1080-wide canvas
  color: string; // #RRGGBB
  highlight: string; // #RRGGBB
  outline_color: string;
  outline: number;
  shadow: number;
  bold: number;
  uppercase: boolean;
  position: "top" | "mid" | "bottom" | string;
  max_words: number;
}

export interface Word {
  start: number;
  end: number;
  word: string;
  emphasis?: boolean;   // opt-in AI auto-effect: punch this word visually
  emoji?: string;       // opt-in AI auto-effect: emoji shown with this word
}

// Fallback presets if the API hasn't loaded yet (kept in sync with captions.PRESETS).
export const FALLBACK_PRESETS: Record<string, CaptionStyle> = {
  capcut: { font: "Arial", size: 92, color: "#FFFFFF", highlight: "#FFD400", outline_color: "#000000", outline: 7, shadow: 0, bold: 1, uppercase: false, position: "bottom", max_words: 4 },
  hormozi: { font: "Arial", size: 104, color: "#FFFFFF", highlight: "#22FF55", outline_color: "#000000", outline: 8, shadow: 0, bold: 1, uppercase: true, position: "mid", max_words: 3 },
  beasty: { font: "Arial", size: 110, color: "#FFFFFF", highlight: "#00E5FF", outline_color: "#000000", outline: 6, shadow: 3, bold: 1, uppercase: true, position: "mid", max_words: 3 },
  clean: { font: "Arial", size: 72, color: "#F2F2F2", highlight: "#FFFFFF", outline_color: "#000000", outline: 3, shadow: 0, bold: 1, uppercase: false, position: "bottom", max_words: 6 },
};

function endsSentence(w: string): boolean {
  const t = w.trim();
  return t.endsWith(".") || t.endsWith("!") || t.endsWith("?");
}

export function groupLines(words: Word[], maxWords: number): Word[][] {
  const lines: Word[][] = [];
  let cur: Word[] = [];
  for (const w of words) {
    if (!w.word.trim()) continue;
    cur.push(w);
    if (cur.length >= maxWords || endsSentence(w.word)) {
      lines.push(cur);
      cur = [];
    }
  }
  if (cur.length) lines.push(cur);
  return lines;
}

// Which caption line + active word index is showing at time t (absolute video sec).
export function captionAt(
  words: Word[],
  t: number,
  maxWords: number
): { line: Word[]; activeIdx: number } | null {
  const lines = groupLines(words, maxWords);
  for (const line of lines) {
    const ls = line[0].start;
    const le = line[line.length - 1].end;
    if (t >= ls && t <= le + 0.15) {
      let activeIdx = 0;
      for (let i = 0; i < line.length; i++) if (t >= line[i].start) activeIdx = i;
      return { line, activeIdx };
    }
  }
  return null;
}

export function wordsInRange(words: Word[], start: number, end: number): Word[] {
  return words.filter((w) => w.end > start && w.start < end);
}
