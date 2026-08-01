// Thin API client for the Cvideo backend.
import { CaptionStyle, Word } from "./captionStyles";
import { getApiToken, setApiToken } from "./apiToken";

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
  folder?: string | null;   // Home folder (drag-to-move); null = loose / virtual "Reels"
}

export interface Folder {
  id: number;
  name: string;
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
  splits_json?: string;
  effects_json?: string;
  markers_json?: string;
  voiceover_path?: string | null;
  scene_vo_json?: string;
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
  brains_default?: string;        // backend's CVIDEO_DEFAULT_BRAIN (claude | ollama | gemini | heuristic)
  transcribe: string[];
  transcribe_default?: string;   // backend's CVIDEO_DEFAULT_TRANSCRIBE (local | elevenlabs)
  resolutions: ResolutionOption[];
  stages: string[];
  formats: string[];
  capture_modes: string[];
  tts_available?: boolean;       // is ELEVENLABS_API_KEY set? (no round trip to ElevenLabs)
}

export interface PostMeta {
  tt: { caption: string; hashtags: string };
  ig: { caption: string; hashtags: string };
  yt: { title: string; description: string; tags: string };
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
  post_meta?: PostMeta | null;
  platforms: string[];
  scheduled_at?: string | null;
  posted_at?: string | null;
  created_at: string;
  autopilot?: boolean;
  auto_voiceover?: boolean;
  gate?: string | null;
  gate_reason?: string | null;
  queue_kind?: string;
  // Scene progress summary (only on the /api/tickets list) — drives the board's
  // "where did I leave off" chips.
  n_beats?: number;
  n_clips?: number;
  n_vo?: number;
}

export interface AutopilotState {
  running: boolean;
  interval: number;
  queue: Ticket[];
}

export interface ZoomKey { t: number; scale: number; duration: number }
export interface SfxCue { t: number; name: string }
export interface ClipEffects { zoom?: ZoomKey[]; sfx?: SfxCue[] }

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
  autopilot?: boolean;
  auto_voiceover?: boolean;
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

export interface PlatformStat {
  platform: string; views: number; follows: number; saves: number; sends: number; posts: number; score: number;
}
export interface TrendPoint {
  date: string; views: number; follows: number; saves: number; sends: number; score: number;
}
export interface TopVideo {
  video_kind: "clip" | "reel"; video_id: number; title: string; hook: string; score: number;
}
export interface PlatMetrics { views: number; follows: number; saves: number; sends: number }
export interface VideoPerf {
  video_kind: "clip" | "reel"; video_id: number; is_reel: boolean;
  title: string; hook: string; brand: string;
  platforms: Partial<Record<"tt" | "ig" | "yt", PlatMetrics>>;
  totals: PlatMetrics; score: number;
}
export interface InsightsData {
  kpis: { tickets: number; posted: number; views: number; follows: number; saves: number; sends: number };
  top: TopVideo[];
  videos: VideoPerf[];
  angles: { angle: string; outlier_id: number | null; posts_count: number; avg_score: number }[];
  by_platform: PlatformStat[];
  trend: TrendPoint[];
}

export interface QueueTicket extends Ticket {
  has_video: boolean;
}
export interface QueueData {
  dry_run: boolean;
  platforms: string[];
  config: { live: boolean; user_set: boolean; user: string };
  ready: QueueTicket[];
  scheduled: QueueTicket[];
  posted: QueueTicket[];
}
export interface PostResult {
  dry_run: boolean; action: string; platforms: string[];
  results: Record<string, string>; message: string;
}

// --- Shoot drop (batch raw-footage intake) ---
export interface IngestClipInfo {
  id: number;
  batch_id: string;
  filename: string;
  path: string;
  transcript: string;
  status: string;      // pending|transcribing|matched|unmatched|assigned|error
  ticket_id?: number | null;
  beat_id?: number | null;
  confidence: number;  // matcher score 0..1 (0 = manual / new ticket)
  error?: string | null;
  ticket_label?: string;
  scene_index?: number | null;
}
export interface OpenScene {
  beat_id: number; ticket_id: number; order_index: number; line: string; ticket_label: string;
}
export interface ShootdropData {
  clips: IngestClipInfo[];
  watch_dir: string;
  open_scenes: OpenScene[];
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

/* Single place that turns a fetch into typed JSON — and, crucially, throws a clean
   Error carrying the backend's `detail` when the response isn't OK. Every call below
   routes through this, so a failed action surfaces as one readable toast instead of
   silently "succeeding" or blowing up later with "cannot read properties of undefined". */
async function req<T>(input: string, init?: RequestInit): Promise<T> {
  let r: Response;
  try {
    r = await fetch(input, init);
  } catch {
    throw new Error("Can't reach the app — is the server running?");
  }
  if (r.status === 401) {
    // Backend has an API token set. Ask for it, store it, and reload so the patched
    // fetch resends every request with the token. (No token configured = never hit.)
    const cur = getApiToken();
    const t = window.prompt(cur ? "Access token rejected — re-enter it:" : "This Cvideo needs an access token:");
    if (t) { setApiToken(t); location.reload(); }
    throw new Error("Access token required");
  }
  if (!r.ok) {
    let detail = "";
    try { detail = (await r.json())?.detail ?? ""; } catch { /* non-JSON error body */ }
    throw new Error(detail || `Request failed (${r.status})`);
  }
  if (r.status === 204) return undefined as T;
  return r.json() as Promise<T>;
}
const jsonInit = (method: string, body?: unknown): RequestInit =>
  ({ method, headers: J, body: body === undefined ? undefined : JSON.stringify(body) });

export const api = {
  health: (): Promise<{ ok: boolean }> => req("/api/health"),
  presets: (): Promise<Presets> => req("/api/presets"),
  listProjects: (): Promise<Project[]> => req("/api/projects"),
  getProject: (id: number): Promise<{ project: Project; clips: Clip[] }> =>
    req(`/api/projects/${id}`),
  getWords: (id: number): Promise<{ words: Word[] }> =>
    req(`/api/projects/${id}/words`),
  deleteProject: (id: number): Promise<{ deleted: number }> =>
    req(`/api/projects/${id}`, { method: "DELETE" }),
  patchProject: (id: number, body: { name?: string; folder?: string | null }): Promise<Project> =>
    req(`/api/projects/${id}`, jsonInit("PATCH", body)),
  // --- Home folders ---
  listFolders: (): Promise<Folder[]> => req("/api/folders"),
  createFolder: (name: string): Promise<Folder> =>
    req("/api/folders", jsonInit("POST", { name })),
  renameFolder: (id: number, name: string): Promise<Folder> =>
    req(`/api/folders/${id}`, jsonInit("PATCH", { name })),
  deleteFolder: (id: number): Promise<{ deleted: number }> =>
    req(`/api/folders/${id}`, { method: "DELETE" }),
  createFromUrl: (body: {
    name: string;
    source_url: string;
    brain: string;
    transcribe_backend: string;
    aspect: string;
    caption_preset: string;
    mode: string;
    brand?: string;
  }): Promise<{ id: number }> =>
    req("/api/projects", jsonInit("POST", body)),
  createFromUpload: (form: FormData): Promise<{ id: number }> =>
    req("/api/projects/upload", { method: "POST", body: form }),
  patchClip: (
    cid: number,
    body: Partial<Clip> & { style?: CaptionStyle; words?: Word[]; cuts?: number[][]; splits?: number[]; effects?: ClipEffects }
  ): Promise<Clip> =>
    req(`/api/clips/${cid}`, jsonInit("PATCH", body)),
  renderClip: (cid: number): Promise<{ status: string }> =>
    req(`/api/clips/${cid}/render`, { method: "POST" }),
  deleteClip: (cid: number): Promise<{ deleted: number }> =>
    req(`/api/clips/${cid}`, { method: "DELETE" }),
  // --- Tickets / pipeline ---
  listTickets: (): Promise<Ticket[]> => req("/api/tickets"),
  getTicket: (tid: number): Promise<TicketWithBeats> => req(`/api/tickets/${tid}`),
  createTicket: (body: NewTicketBody): Promise<TicketWithBeats> =>
    req("/api/tickets", jsonInit("POST", body)),
  createTicketFromScript: (body: NewTicketBody): Promise<TicketWithBeats> =>
    req("/api/tickets/from-script", jsonInit("POST", body)),
  importScript: (tid: number, script: string): Promise<TicketWithBeats> =>
    req(`/api/tickets/${tid}/import-script`, jsonInit("POST", { script })),
  patchTicket: (tid: number, body: Partial<Ticket>): Promise<Ticket> =>
    req(`/api/tickets/${tid}`, jsonInit("PATCH", body)),
  deleteTicket: (tid: number): Promise<{ deleted: number }> =>
    req(`/api/tickets/${tid}`, { method: "DELETE" }),
  patchBeat: (bid: number, body: Partial<Beat>): Promise<Beat> =>
    req(`/api/beats/${bid}`, jsonInit("PATCH", body)),
  addBeat: (tid: number): Promise<Beat> =>
    req(`/api/tickets/${tid}/beats`, { method: "POST" }),
  deleteBeat: (bid: number): Promise<{ deleted: number }> =>
    req(`/api/beats/${bid}`, { method: "DELETE" }),
  reorderBeats: (tid: number, ids: number[]): Promise<{ beats: Beat[] }> =>
    req(`/api/tickets/${tid}/beats/reorder`, jsonInit("POST", { ids })),

  uploadBeatClip: (bid: number, file: File): Promise<{ clip_path: string }> => {
    const fd = new FormData(); fd.append("file", file);
    return req(`/api/beats/${bid}/clip`, { method: "POST", body: fd });
  },
  uploadBeatVoiceover: (bid: number, file: File): Promise<{ voiceover_path: string }> => {
    const fd = new FormData(); fd.append("file", file);
    return req(`/api/beats/${bid}/voiceover`, { method: "POST", body: fd });
  },
  assembleTicket: (tid: number): Promise<{ status: string }> =>
    req(`/api/tickets/${tid}/assemble`, { method: "POST" }),
  assembleStatus: (tid: number): Promise<{ state: string; stage: string; error: string | null }> =>
    req(`/api/tickets/${tid}/assemble-status`),
  useClip: (tid: number, cid: number): Promise<Ticket> =>
    req(`/api/tickets/${tid}/use-clip/${cid}`, { method: "POST" }),
  ticketDownloadUrl: (tid: number) => `/api/tickets/${tid}/download`,
  ticketThumbUrl: (tid: number) => `/api/tickets/${tid}/thumb`,
  buildEdit: (tid: number): Promise<{ pid: number; cid: number; reused_edits?: boolean; wiped_edits?: boolean }> =>
    req(`/api/tickets/${tid}/build-edit`, { method: "POST" }),

  // Text-to-speech: read the transcript into a voiceover (ElevenLabs)
  ttsVoices: (): Promise<{ available: boolean; default: string; voices: { voice_id: string; name: string }[] }> =>
    req("/api/tts/voices"),
  ttsVoiceover: (cid: number, voice_id?: string, text?: string): Promise<{ voiceover_path: string }> =>
    req(`/api/clips/${cid}/tts-voiceover`, jsonInit("POST", { voice_id, text })),

  // Clip voiceover (recorded/uploaded in the editor)
  uploadClipVoiceover: (cid: number, file: Blob): Promise<{ voiceover_path: string }> => {
    const fd = new FormData(); fd.append("file", file, "voiceover.webm");
    return req(`/api/clips/${cid}/voiceover`, { method: "POST", body: fd });
  },
  deleteClipVoiceover: (cid: number): Promise<{ ok: boolean }> =>
    req(`/api/clips/${cid}/voiceover`, { method: "DELETE" }),
  clipVoiceoverUrl: (cid: number) => `/api/clips/${cid}/voiceover-file`,

  // Per-scene voiceover (reel clips)
  uploadSceneVoiceover: (cid: number, idx: number, file: Blob): Promise<{ voiceover_path: string; scene_vos: (string | null)[] }> => {
    const fd = new FormData(); fd.append("file", file, "voiceover.webm");
    return req(`/api/clips/${cid}/scene-voiceover/${idx}`, { method: "POST", body: fd });
  },
  deleteSceneVoiceover: (cid: number, idx: number): Promise<{ ok: boolean }> =>
    req(`/api/clips/${cid}/scene-voiceover/${idx}`, { method: "DELETE" }),
  sceneVoiceoverUrl: (cid: number, idx: number) => `/api/clips/${cid}/scene-voiceover/${idx}`,
  // AI voice for ONE scene of a reel (mirrors ttsVoiceover for the whole-clip path).
  sceneTtsVoiceover: (cid: number, idx: number, voice_id?: string, text?: string): Promise<{ voiceover_path: string; scene_vos: (string | null)[] }> =>
    req(`/api/clips/${cid}/scene-tts/${idx}`, jsonInit("POST", { voice_id, text })),

  // --- Autopilot (the autonomous orchestrator) ---
  autopilotState: (): Promise<AutopilotState> => req("/api/autopilot"),
  autopilotStart: (): Promise<AutopilotState> => req("/api/autopilot/start", { method: "POST" }),
  autopilotStop: (): Promise<AutopilotState> => req("/api/autopilot/stop", { method: "POST" }),
  autopilotTick: (): Promise<{ result: Record<string, string> }> => req("/api/autopilot/tick", { method: "POST" }),
  autopilotToggle: (tid: number, on: boolean): Promise<Ticket> =>
    req(`/api/autopilot/tickets/${tid}/toggle`, jsonInit("POST", { on })),
  autopilotApprove: (tid: number): Promise<Ticket> => req(`/api/autopilot/tickets/${tid}/approve`, { method: "POST" }),
  autopilotReject: (tid: number): Promise<Ticket> => req(`/api/autopilot/tickets/${tid}/reject`, { method: "POST" }),
  autopilotRegenerate: (tid: number, note = ""): Promise<Ticket> =>
    req(`/api/autopilot/tickets/${tid}/regenerate`, jsonInit("POST", { note })),

  aiEffects: (cid: number, opts: { emphasis: boolean; zoom: boolean; sfx: boolean }): Promise<{
    clip: Clip; words: Word[]; effects: ClipEffects; counts: Record<string, number>;
  }> => req(`/api/clips/${cid}/ai-effects`, jsonInit("POST", opts)),

  scriptFactory: (tid: number, brief = ""): Promise<TicketWithBeats> =>
    req(`/api/tickets/${tid}/script-factory`, jsonInit("POST", { brief })),
  hookForge: (tid: number, brief = ""): Promise<{ hooks: string[] }> =>
    req(`/api/tickets/${tid}/hook-forge`, jsonInit("POST", { brief })),
  generatePostCopy: (tid: number): Promise<{ ticket: Ticket; post_meta: PostMeta }> =>
    req(`/api/tickets/${tid}/post-copy`, { method: "POST" }),

  // --- Shoot drop (batch raw-footage intake) ---
  shootdropUpload: (files: File[]): Promise<{ batch_id: string; count: number }> => {
    const fd = new FormData();
    files.forEach((f) => fd.append("files", f));
    return req("/api/shootdrop", { method: "POST", body: fd });
  },
  shootdropStatus: (): Promise<ShootdropData> => req("/api/shootdrop"),
  shootdropClipUrl: (icid: number) => `/api/shootdrop/clips/${icid}/file`,
  shootdropClipThumbUrl: (icid: number) => `/api/shootdrop/clips/${icid}/thumb`,
  shootdropAssign: (icid: number, body: { beat_id?: number; new_ticket?: boolean }): Promise<IngestClipInfo> =>
    req(`/api/shootdrop/clips/${icid}/assign`, jsonInit("POST", body)),
  shootdropDiscard: (icid: number): Promise<{ discarded: number }> =>
    req(`/api/shootdrop/clips/${icid}`, { method: "DELETE" }),

  // --- Outliers (swipe file) ---
  listOutliers: (): Promise<Outlier[]> => req("/api/outliers"),
  createOutlier: (body: Partial<Outlier>): Promise<Outlier> =>
    req("/api/outliers", jsonInit("POST", body)),
  deleteOutlier: (oid: number): Promise<{ deleted: number }> =>
    req(`/api/outliers/${oid}`, { method: "DELETE" }),
  ticketFromOutlier: (oid: number): Promise<TicketWithBeats> =>
    req(`/api/tickets/from-outlier/${oid}`, { method: "POST" }),

  listExports: (): Promise<ExportItem[]> => req("/api/exports"),
  setExportFolder: (kind: "clip" | "reel", id: number, folder: string): Promise<{ ok: boolean; folder: string | null }> =>
    req(`/api/exports/${kind}/${id}/folder`, jsonInit("PATCH", { folder })),

  // --- Insights (Signal Reader) ---
  getInsights: (): Promise<InsightsData> => req("/api/insights"),
  logPerf: (body: { video_kind: "clip" | "reel"; video_id: number; platform: string; brand?: string; views: number; follows: number; saves: number; sends: number }): Promise<{ ok: boolean }> =>
    req("/api/perf", jsonInit("POST", body)),
  setVideoBrand: (kind: "clip" | "reel", id: number, brand: string): Promise<{ ok: boolean; brand: string }> =>
    req(`/api/videos/${kind}/${id}/brand`, jsonInit("POST", { brand })),
  syncSheet: (): Promise<{ ok: boolean; pushed: number }> =>
    req("/api/perf/sync-sheet", { method: "POST" }),

  // --- Scheduling / posting (P6) ---
  getQueue: (): Promise<QueueData> => req("/api/queue"),
  scheduleTicket: (tid: number, body: { scheduled_at: string | null; platforms?: string[]; captions?: Record<string, string> }): Promise<Ticket> =>
    req(`/api/tickets/${tid}/schedule`, jsonInit("POST", body)),
  postTicket: (tid: number, body: { platforms?: string[]; caption?: string; scheduled_at?: string } = {}): Promise<PostResult> =>
    req(`/api/tickets/${tid}/post`, jsonInit("POST", body)),

  sourceUrl: (pid: number) => `/api/projects/${pid}/source`,
  previewUrl: (cid: number) => `/api/clips/${cid}/preview`,
  downloadUrl: (cid: number) => `/api/clips/${cid}/download`,
  clipThumbUrl: (cid: number) => `/api/clips/${cid}/thumb`,
  projectThumbUrl: (pid: number) => `/api/projects/${pid}/thumb`,
  frameUrl: (pid: number, t: number) => `/api/projects/${pid}/frame?t=${t.toFixed(2)}`,
  autoCenter: (cid: number): Promise<{ center: number }> =>
    fetch(`/api/clips/${cid}/auto-center`, { method: "POST" }).then((r) => r.json()),
};
