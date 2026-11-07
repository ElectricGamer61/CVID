import { decodeEnergy } from "./snap";
import type { Cut, EngineInfo, ExportStatus, Project, ProjectSettings, ProjectSummary, Word } from "./types";

const BASE = "/api/studio";

export class ApiError extends Error {
  constructor(public status: number, message: string, public body?: unknown) {
    super(message);
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  let r: Response;
  try {
    r = await fetch(BASE + path, init);
  } catch {
    throw new ApiError(0, "Can't reach Cvideo. Is it still running?");
  }
  const body = await r.json().catch(() => null);
  if (!r.ok) {
    const detail = body && typeof body === "object" && "detail" in body ? String((body as { detail: unknown }).detail) : r.statusText;
    throw new ApiError(r.status, detail, body);
  }
  return body as T;
}

const json = (method: string, data: unknown): RequestInit => ({
  method, headers: { "content-type": "application/json" }, body: JSON.stringify(data),
});

export interface ProjectEdit {
  edit_rev: number;
  name?: string;
  cuts?: Cut[];
  settings?: Partial<ProjectSettings>;
  clip_order?: string[];
}

export const api = {
  engines: () => req<{ order: string[]; engines: Record<string, EngineInfo>; default: string | null }>("/engines"),
  projects: () => req<{ projects: ProjectSummary[] }>("/projects"),
  create: (name: string) => req<Project>("/projects", json("POST", { name })),
  project: (id: string) => req<Project>(`/projects/${id}`),
  remove: (id: string) => req<{ ok: boolean }>(`/projects/${id}`, { method: "DELETE" }),

  /** Save an edit. Throws ApiError(409) with body.project when another window saved first. */
  save: (id: string, edit: ProjectEdit) => req<Project>(`/projects/${id}`, json("PATCH", edit)),

  /** Upload clips with progress (fetch can't report upload progress; XHR can). */
  addClips(id: string, files: File[], onProgress: (fraction: number) => void): Promise<Project> {
    return new Promise((resolve, reject) => {
      const form = new FormData();
      for (const f of files) form.append("files", f, f.name);
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${BASE}/projects/${id}/clips`);
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
      xhr.onload = () => {
        let body: unknown = null;
        try { body = JSON.parse(xhr.responseText); } catch { /* not json */ }
        if (xhr.status >= 200 && xhr.status < 300) resolve(body as Project);
        else reject(new ApiError(xhr.status, (body as { detail?: string })?.detail || xhr.statusText, body));
      };
      xhr.onerror = () => reject(new ApiError(0, "Upload failed: can't reach Cvideo."));
      xhr.send(form);
    });
  },
  removeClip: (id: string, cid: string) => req<Project>(`/projects/${id}/clips/${cid}`, { method: "DELETE" }),
  retryClip: (id: string, cid: string) => req<Project>(`/projects/${id}/clips/${cid}/retry`, { method: "POST" }),
  retranscribe: (id: string, cid: string) =>
    req<Project>(`/projects/${id}/clips/${cid}/retranscribe`, { method: "POST" }),

  words: (id: string, cid: string) => req<Word[]>(`/projects/${id}/clips/${cid}/words`),
  async energy(id: string, cid: string): Promise<Float32Array | null> {
    const r = await fetch(`${BASE}/projects/${id}/clips/${cid}/energy`);
    return r.ok ? decodeEnergy(await r.arrayBuffer()) : null;
  },
  proxyUrl: (id: string, cid: string) => `${BASE}/projects/${id}/clips/${cid}/proxy`,
  thumbUrl: (id: string, cid: string) => `${BASE}/projects/${id}/clips/${cid}/thumb`,

  startExport: (id: string) => req<ExportStatus>(`/projects/${id}/export`, { method: "POST" }),
  exportStatus: (id: string) => req<ExportStatus>(`/projects/${id}/export`),
  cancelExport: (id: string) => req<ExportStatus>(`/projects/${id}/export/cancel`, { method: "POST" }),
  exportFileUrl: (id: string, kind: "mp4" | "srt") => `${BASE}/projects/${id}/export/file?kind=${kind}`,
};
