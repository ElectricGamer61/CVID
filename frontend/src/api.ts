// Thin API client for the Cvideo backend.
import { CaptionStyle, Word } from "./captionStyles";
import type { LookOption, LookSetting, TitleCard } from "./looks";
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
  looks?: LookOption[];                       // cinematic Look presets (mirrors looks.ts)
  title_places?: { id: string; label: string }[];
  title_styles?: { id: string; label: string }[];
  stages: string[];
  formats: string[];
  capture_modes: string[];
  tts_available?: boolean;       // is ELEVENLABS_API_KEY set? (no round trip to ElevenLabs)
}

/** One video you're making from a script: its scenes, and the reel they assemble into.
 *  (The backend row is still called a ticket; nothing user-facing is.) */
export interface Ticket {
  id: number;
  brand: string;
  stage: string;
  angle: string;
  format: string;
  capture_mode: string;
  project_id?: number | null;
  source_ref: string;
  hook_text: string;
  clip_url?: string | null;
  created_at: string;
  auto_voiceover?: boolean;
  // Scene progress summary (only on the /api/tickets list) — drives each video card's
  // "where did I leave off" chips.
  n_beats?: number;
  n_clips?: number;
  n_vo?: number;
}

export interface ZoomKey { t: number; scale: number; duration: number }
export interface SfxCue { t: number; name: string }
export interface ClipEffects {
  zoom?: ZoomKey[];
  sfx?: SfxCue[];
  look?: LookSetting;      // cinematic colour grade (absent / id "none" = untouched export)
  title?: TitleCard;       // big cinematic title (absent / empty text = untouched export)
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
  auto_voiceover?: boolean;
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
/** A request the backend answered with an error, carrying the HTTP status.
 *
 *  Callers that need to tell "this thing is gone" (404) apart from "the server is down"
 *  use `isNotFound` — deleting the row is permanent, an outage is not, so they must not
 *  produce the same reaction. A network failure never becomes an ApiError. */
export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); this.name = "ApiError"; }
}
export const isNotFound = (e: unknown): boolean => e instanceof ApiError && e.status === 404;

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
    throw new ApiError(detail || `Request failed (${r.status})`, r.status);
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
  // Re-run analyze on a project that errored, reusing the media already on disk — so a
  // dropped model download or a throttled fetch doesn't cost you the upload.
  retryProject: (id: number): Promise<{ ok: boolean; id: number }> =>
    req(`/api/projects/${id}/retry`, { method: "POST" }),
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

  aiEffects: (cid: number, opts: { emphasis: boolean; zoom: boolean; sfx: boolean }): Promise<{
    clip: Clip; words: Word[]; effects: ClipEffects; counts: Record<string, number>;
  }> => req(`/api/clips/${cid}/ai-effects`, jsonInit("POST", opts)),

  scriptFactory: (tid: number, brief = ""): Promise<TicketWithBeats> =>
    req(`/api/tickets/${tid}/script-factory`, jsonInit("POST", { brief })),
  hookForge: (tid: number, brief = ""): Promise<{ hooks: string[] }> =>
    req(`/api/tickets/${tid}/hook-forge`, jsonInit("POST", { brief })),

  listExports: (): Promise<ExportItem[]> => req("/api/exports"),
  setExportFolder: (kind: "clip" | "reel", id: number, folder: string): Promise<{ ok: boolean; folder: string | null }> =>
    req(`/api/exports/${kind}/${id}/folder`, jsonInit("PATCH", { folder })),

  sourceUrl: (pid: number) => `/api/projects/${pid}/source`,
  previewUrl: (cid: number) => `/api/clips/${cid}/preview`,
  downloadUrl: (cid: number) => `/api/clips/${cid}/download`,
  clipThumbUrl: (cid: number) => `/api/clips/${cid}/thumb`,
  projectThumbUrl: (pid: number) => `/api/projects/${pid}/thumb`,
  frameUrl: (pid: number, t: number) => `/api/projects/${pid}/frame?t=${t.toFixed(2)}`,
  autoCenter: (cid: number): Promise<{ center: number }> =>
    fetch(`/api/clips/${cid}/auto-center`, { method: "POST" }).then((r) => r.json()),
};
