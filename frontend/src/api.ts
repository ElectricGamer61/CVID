// Thin API client for the Cvideo backend.
import { CaptionStyle, Word } from "./captionStyles";

export interface Project {
  id: number;
  name: string;
  source_type: string;
  source_url?: string;
  brain: string;
  transcribe_backend?: string;
  aspect: string;
  caption_preset: string;
  mode?: string; // "moments" | "caption"
  status: string;
  stage: string;
  progress: number;
  error?: string;
  duration: number;
}

export interface Clip {
  id: number;
  project_id: number;
  idx: number;
  start: number;
  end: number;
  title: string;
  score: number;
  hook?: string;
  reason: string;
  aspect: string;
  caption_preset: string;
  resolution: string;
  crop_center: number;
  status: string;
  stage?: string;
  output_path?: string;
  error?: string;
  style_json?: string;
  words_json?: string;
  cuts_json?: string;
  markers_json?: string;
  voiceover_path?: string | null;
}

export interface ResolutionOption {
  id: string;
  label: string;
  hint: string; // e.g. "1080×1920" for 9:16
}

export interface Presets {
  captions: string[];
  caption_styles: Record<string, CaptionStyle>;
  aspects: string[];
  brains: string[];
  transcribe: string[];
  resolutions: ResolutionOption[];
  stages: string[];
  formats: string[];
  capture_modes: string[];
}

export interface Ticket {
  id: number;
  brand: string;
  stage: string;
  angle: string;
  outlier_id?: number | null;
  format: string;
  capture_mode: string;
  project_id?: number | null;
  source_ref: string;
  hook_text: string;
  clip_url?: string | null;
  captions?: Record<string, string> | null;
  platforms: string[];
  scheduled_at?: string | null;
  posted_at?: string | null;
  created_at: string;
}

export interface Beat {
  id: number;
  ticket_id: number;
  order_index: number;
  spoken_line: string;
  on_screen_text: string;
  caption: string;
  shot_cue: string;
  clip_path?: string | null;
  voiceover_path?: string | null;
  is_proof_beat: boolean;
}

export interface TicketWithBeats {
  ticket: Ticket;
  beats: Beat[];
}

export interface NewTicketBody {
  brand: string;
  angle: string;
  format: string;
  capture_mode: string;
  hook_text?: string;
  script?: string;
}

export interface Outlier {
  id: number;
  url: string;
  hook: string;
  structure: string;
  why_popped: string;
  caption: string;
  angle: string;
  power_phrases: string[];
  created_at: string;
}

export interface InsightsData {
  kpis: { tickets: number; posted: number; views: number; follows: number; saves: number; sends: number };
  top: { ticket_id: number; angle: string; score: number }[];
  angles: { angle: string; outlier_id: number | null; posts_count: number; avg_score: number }[];
}

export interface ExportItem {
  kind: "clip" | "reel";
  id: number;
  title: string;
  subtitle: string;
  group: string;       // top folder — brand (reels) or project (clips)
  subgroup: string;    // "Reels" | "Clips"
  hook: string;
  filename: string;    // hook-based download filename
  score: number | null;
  download: string;
  thumb: string | null;
}

const J = { "Content-Type": "application/json" };

export const api = {
  presets: (): Promise<Presets> => fetch("/api/presets").then((r) => r.json()),
  listProjects: (): Promise<Project[]> =>
    fetch("/api/projects").then((r) => r.json()),
  getProject: (id: number): Promise<{ project: Project; clips: Clip[] }> =>
    fetch(`/api/projects/${id}`).then((r) => r.json()),
  getWords: (id: number): Promise<{ words: Word[] }> =>
    fetch(`/api/projects/${id}/words`).then((r) => r.json()),
  deleteProject: (id: number): Promise<{ deleted: number }> =>
    fetch(`/api/projects/${id}`, { method: "DELETE" }).then((r) => r.json()),
  createFromUrl: (body: {
    name: string;
    source_url: string;
    brain: string;
    transcribe_backend: string;
    aspect: string;
    caption_preset: string;
    mode: string;
  }): Promise<{ id: number }> =>
    fetch("/api/projects", {
      method: "POST",
      headers: J,
      body: JSON.stringify(body),
    }).then((r) => r.json()),
  createFromUpload: (form: FormData): Promise<{ id: number }> =>
    fetch("/api/projects/upload", { method: "POST", body: form }).then((r) =>
      r.json()
    ),
  patchClip: (
    cid: number,
    body: Partial<Clip> & { style?: CaptionStyle; words?: Word[]; cuts?: number[][] }
  ): Promise<Clip> =>
    fetch(`/api/clips/${cid}`, {
      method: "PATCH",
      headers: J,
      body: JSON.stringify(body),
    }).then((r) => r.json()),
  renderClip: (cid: number): Promise<{ status: string }> =>
    fetch(`/api/clips/${cid}/render`, { method: "POST" }).then((r) => r.json()),
  deleteClip: (cid: number): Promise<{ deleted: number }> =>
    fetch(`/api/clips/${cid}`, { method: "DELETE" }).then((r) => r.json()),
  // --- Tickets / pipeline ---
  listTickets: (): Promise<Ticket[]> => fetch("/api/tickets").then((r) => r.json()),
  getTicket: (tid: number): Promise<TicketWithBeats> =>
    fetch(`/api/tickets/${tid}`).then((r) => r.json()),
  createTicket: (body: NewTicketBody): Promise<TicketWithBeats> =>
    fetch("/api/tickets", { method: "POST", headers: J, body: JSON.stringify(body) }).then((r) => r.json()),
  createTicketFromScript: (body: NewTicketBody): Promise<TicketWithBeats> =>
    fetch("/api/tickets/from-script", { method: "POST", headers: J, body: JSON.stringify(body) }).then((r) => r.json()),
  importScript: (tid: number, script: string): Promise<TicketWithBeats> =>
    fetch(`/api/tickets/${tid}/import-script`, { method: "POST", headers: J, body: JSON.stringify({ script }) }).then((r) => r.json()),
  patchTicket: (tid: number, body: Partial<Ticket>): Promise<Ticket> =>
    fetch(`/api/tickets/${tid}`, { method: "PATCH", headers: J, body: JSON.stringify(body) }).then((r) => r.json()),
  deleteTicket: (tid: number): Promise<{ deleted: number }> =>
    fetch(`/api/tickets/${tid}`, { method: "DELETE" }).then((r) => r.json()),
  patchBeat: (bid: number, body: Partial<Beat>): Promise<Beat> =>
    fetch(`/api/beats/${bid}`, { method: "PATCH", headers: J, body: JSON.stringify(body) }).then((r) => r.json()),
  addBeat: (tid: number): Promise<Beat> =>
    fetch(`/api/tickets/${tid}/beats`, { method: "POST" }).then((r) => r.json()),
  deleteBeat: (bid: number): Promise<{ deleted: number }> =>
    fetch(`/api/beats/${bid}`, { method: "DELETE" }).then((r) => r.json()),
  reorderBeats: (tid: number, ids: number[]): Promise<{ beats: Beat[] }> =>
    fetch(`/api/tickets/${tid}/beats/reorder`, { method: "POST", headers: J, body: JSON.stringify({ ids }) }).then((r) => r.json()),

  uploadBeatClip: (bid: number, file: File): Promise<{ clip_path: string }> => {
    const fd = new FormData(); fd.append("file", file);
    return fetch(`/api/beats/${bid}/clip`, { method: "POST", body: fd }).then((r) => r.json());
  },
  uploadBeatVoiceover: (bid: number, file: File): Promise<{ voiceover_path: string }> => {
    const fd = new FormData(); fd.append("file", file);
    return fetch(`/api/beats/${bid}/voiceover`, { method: "POST", body: fd }).then((r) => r.json());
  },
  assembleTicket: (tid: number): Promise<{ status: string }> =>
    fetch(`/api/tickets/${tid}/assemble`, { method: "POST" }).then(async (r) => { if (!r.ok) throw new Error((await r.json()).detail || r.status); return r.json(); }),
  assembleStatus: (tid: number): Promise<{ state: string; stage: string; error: string | null }> =>
    fetch(`/api/tickets/${tid}/assemble-status`).then((r) => r.json()),
  useClip: (tid: number, cid: number): Promise<Ticket> =>
    fetch(`/api/tickets/${tid}/use-clip/${cid}`, { method: "POST" }).then((r) => r.json()),
  ticketDownloadUrl: (tid: number) => `/api/tickets/${tid}/download`,
  ticketThumbUrl: (tid: number) => `/api/tickets/${tid}/thumb`,
  buildEdit: (tid: number): Promise<{ pid: number; cid: number }> =>
    fetch(`/api/tickets/${tid}/build-edit`, { method: "POST" }).then(async (r) => { if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || r.status); return r.json(); }),

  // Clip voiceover (recorded/uploaded in the editor)
  uploadClipVoiceover: (cid: number, file: Blob): Promise<{ voiceover_path: string }> => {
    const fd = new FormData(); fd.append("file", file, "voiceover.webm");
    return fetch(`/api/clips/${cid}/voiceover`, { method: "POST", body: fd }).then((r) => r.json());
  },
  deleteClipVoiceover: (cid: number): Promise<{ ok: boolean }> =>
    fetch(`/api/clips/${cid}/voiceover`, { method: "DELETE" }).then((r) => r.json()),
  clipVoiceoverUrl: (cid: number) => `/api/clips/${cid}/voiceover-file`,

  scriptFactory: (tid: number, brief = ""): Promise<TicketWithBeats> =>
    fetch(`/api/tickets/${tid}/script-factory`, { method: "POST", headers: J, body: JSON.stringify({ brief }) }).then((r) => r.json()),
  hookForge: (tid: number, brief = ""): Promise<{ hooks: string[] }> =>
    fetch(`/api/tickets/${tid}/hook-forge`, { method: "POST", headers: J, body: JSON.stringify({ brief }) }).then((r) => r.json()),

  // --- Outliers (swipe file) ---
  listOutliers: (): Promise<Outlier[]> => fetch("/api/outliers").then((r) => r.json()),
  createOutlier: (body: Partial<Outlier>): Promise<Outlier> =>
    fetch("/api/outliers", { method: "POST", headers: J, body: JSON.stringify(body) }).then((r) => r.json()),
  deleteOutlier: (oid: number): Promise<{ deleted: number }> =>
    fetch(`/api/outliers/${oid}`, { method: "DELETE" }).then((r) => r.json()),
  ticketFromOutlier: (oid: number): Promise<TicketWithBeats> =>
    fetch(`/api/tickets/from-outlier/${oid}`, { method: "POST" }).then((r) => r.json()),

  listExports: (): Promise<ExportItem[]> => fetch("/api/exports").then((r) => r.json()),

  // --- Insights (Signal Reader) ---
  getInsights: (): Promise<InsightsData> => fetch("/api/insights").then((r) => r.json()),
  logPerf: (body: { ticket_id: number; platform: string; views: number; follows: number; saves: number; sends: number }): Promise<{ ok: boolean }> =>
    fetch("/api/perf", { method: "POST", headers: J, body: JSON.stringify(body) }).then((r) => r.json()),

  sourceUrl: (pid: number) => `/api/projects/${pid}/source`,
  previewUrl: (cid: number) => `/api/clips/${cid}/preview`,
  downloadUrl: (cid: number) => `/api/clips/${cid}/download`,
  clipThumbUrl: (cid: number) => `/api/clips/${cid}/thumb`,
  projectThumbUrl: (pid: number) => `/api/projects/${pid}/thumb`,
  frameUrl: (pid: number, t: number) => `/api/projects/${pid}/frame?t=${t.toFixed(2)}`,
  autoCenter: (cid: number): Promise<{ center: number }> =>
    fetch(`/api/clips/${cid}/auto-center`, { method: "POST" }).then((r) => r.json()),
};
