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
    body: Partial<Clip> & { style?: CaptionStyle; words?: Word[] }
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
  sourceUrl: (pid: number) => `/api/projects/${pid}/source`,
  previewUrl: (cid: number) => `/api/clips/${cid}/preview`,
  downloadUrl: (cid: number) => `/api/clips/${cid}/download`,
  clipThumbUrl: (cid: number) => `/api/clips/${cid}/thumb`,
  projectThumbUrl: (pid: number) => `/api/projects/${pid}/thumb`,
};
