// Shapes shared with the backend (backend/app/studio/store.py, words.py).

export type WordKind = "filler" | "cutoff" | "event";

export interface Word {
  start: number;
  end: number;
  word: string;
  kind?: WordKind;
}

export type CutReason =
  | "manual" | "filler" | "cutoff" | "repeat" | "pause" | "retake" | "dead";

export interface Cut {
  clip: string;
  start: number; // seconds in the clip's own time
  end: number;
  reason: CutReason | string;
}

export interface ClipProgress {
  proxy?: number;
  transcript?: number;
  msg?: string;
}

export interface Clip {
  id: string;
  name: string;
  file: string;
  size: number;
  duration: number;
  width: number;
  height: number;
  fps: string;
  has_audio: boolean;
  vfr: boolean;
  recorded_at: string;
  proxy: "pending" | "done" | "error";
  transcript: "pending" | "done" | "error" | "none";
  engine: string;
  error: string;
  progress: ClipProgress;
}

export interface ExportStatus {
  state: "idle" | "running" | "done" | "error" | "cancelled";
  pct?: number;
  duration?: number;
  file?: string;
  srt?: string;
  error?: string;
}

export interface ProjectSettings {
  engine?: string;
  ignored?: string[]; // suggestion ids the user said "keep" to
  pauseMax?: number;
  pauseKeep?: number;
  [k: string]: unknown;
}

export interface Project {
  id: string;
  name: string;
  created: string;
  updated: string;
  edit_rev: number;
  clips: Clip[];
  cuts: Cut[];
  settings: ProjectSettings;
  export: ExportStatus;
  export_format: { width: number; height: number; fps: string };
}

export interface ProjectSummary {
  id: string;
  name: string;
  updated: string;
  clips: number;
  duration: number;
  thumb_clip: string | null;
}

export interface EngineInfo {
  ok: boolean;
  label: string;
  why: string;
}
