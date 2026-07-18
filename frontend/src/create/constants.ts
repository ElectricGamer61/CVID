// Shared Create-workflow constants and small pure helpers, extracted from App.tsx so
// both the new Create dashboard and the Video Workspace can import one copy.
//
// Note: the human status/label/priority logic now lives in ../lib/ticketStatus. These
// are the remaining display bits (brand list, capture-mode labels, the legacy 4-step
// workspace stepper, gate copy, and the "recently opened" memory).
import type { Ticket } from "../api";

// The brands with cartridges the UI offers. (Backend is the source of truth; this is
// the picker list.)
export const BRANDS = ["NoCrapDiet", "SemSeo", "Missedyu"];

// Plain-language labels for the capture mode (how the video gets made).
export const MODE_LABELS: Record<string, string> = {
  "native-short": "Film it myself",
  "longform-clip": "From a long video",
  repurpose: "Reuse old footage",
};
export const MODE_ICONS: Record<string, string> = {
  "native-short": "🎬",
  "longform-clip": "✂",
  repurpose: "♻",
};
export const modeLabel = (m: string): string => MODE_LABELS[m] ?? m;
export const modeIcon = (m: string): string => MODE_ICONS[m] ?? "🎬";

// --- Legacy 4-step workspace stepper (still used by the Video Workspace header) ---
// The 8 DB stages collapse into these 4 display steps. Stage stays the DB source of
// truth; this is display-only grouping. (The Create dashboard uses the richer
// plan/produce/review/publish model in ../lib/ticketStatus instead.)
export type Phase = { key: string; label: string; stages: string[] };
export const PHASES: Phase[] = [
  { key: "idea", label: "1. Idea", stages: ["outlier"] },
  { key: "make", label: "2. Make it", stages: ["scripted", "staged", "sourced"] },
  { key: "ready", label: "3. Ready", stages: ["assembled", "ready"] },
  { key: "posted", label: "4. Posted", stages: ["scheduled", "posted"] },
];
export const phaseOf = (stage: string): number =>
  Math.max(0, PHASES.findIndex((p) => p.stages.includes(stage)));
export const phaseLabel = (stage: string): string => PHASES[phaseOf(stage)].label;
export const PHASE_HINT: Record<string, string> = {
  idea: "New videos start here",
  make: "Write & film your scenes",
  ready: "Made — ready to post",
  posted: "Posted videos land here",
};

// --- Gate copy (autopilot pause points) ---
export const GATE_LABEL: Record<string, string> = {
  awaiting_approval: "Needs your OK",
  awaiting_footage: "Needs footage",
  parked: "Parked",
  running: "Working…",
  done: "Posted",
};
// A ticket is "waiting for you" when it's paused at an approval or footage gate.
export const isGated = (t: Ticket): boolean =>
  t.gate === "awaiting_approval" || t.gate === "awaiting_footage";
// The gate points a supervised video will pause at, shown so autopilot's behavior is legible.
export const GATE_POINTS = "Pauses for you at: ✍️ script · 🎬 reel · 📤 post";

// --- "Recently opened" memory (localStorage) ---
// The board floats these to the top and marks them so you never lose the videos you
// were working on.
const RECENT_KEY = "cv.recentTickets";
export const getRecent = (): number[] => {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"); } catch { return []; }
};
export const markRecent = (tid: number): void => {
  try {
    const r = [tid, ...getRecent().filter((i) => i !== tid)].slice(0, 8);
    localStorage.setItem(RECENT_KEY, JSON.stringify(r));
  } catch { /* private mode etc. — the board just skips the highlight */ }
};
