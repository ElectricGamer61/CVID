# infrastructure

Platform adapters — browser/runtime integrations, GPU pipelines, storage,
and ML/analysis backends. Features import from here directly; there is no
intermediate `lib/` layer.

## GPU modules

WebGPU-backed rendering pipelines and shared shader code.

- `gpu-effects/` — WebGPU effect pipeline + shader definitions.
- `gpu-transitions/` — WebGPU transition pipeline + per-transition shaders.
- `gpu-compositor/` — WebGPU blend-mode compositor and texture pool.
- `gpu-masks/` — Mask combine pipeline and texture manager.
- `gpu-media/` — Media render + blend pipelines.
- `gpu-scopes/` — Waveform / vectorscope / histogram renderers.
- `gpu-shapes/` — Shape render pipeline.
- `gpu-text/` — Glyph-atlas text pipeline.
- `gpu-shared/` — WGSL fragments shared by other GPU modules (blend modes, etc.).

## Analysis

- `analysis/` — Scene detection, captioning, embeddings, optical flow.
  Wraps transformers.js / ONNX runtimes used for ML-driven media analysis.

## Audio

- `audio/time-stretch.ts` — Audio time-stretch processor (SoundTouch-based).

## Browser adapters

- `browser/blob-url-manager.ts` — Blob URL lifecycle + subscription adapter.
- `browser/mediabunny-input-source.ts` — Mediabunny input adapter.
- `browser/opfs-file-access.ts` — OPFS file access helpers.
- `browser/object-url-registry.ts` — Object URL registry.

## Storage

- `storage/workspace-fs/*` — File System Access API-backed persistence
  (projects, media, thumbnails, waveforms, captions, transcripts, etc.).
- `storage/handles-db.ts` — Tiny IndexedDB registry for non-serializable
  `FileSystem*Handle` references.
- `storage/legacy-idb/*` — One-time migration reader for the legacy
  `video-editor-db` IndexedDB.
- `storage/cache-version.ts` — Cache version constants/helpers.

## Thumbnails

- `thumbnails/gpu-thumbnail-renderer.ts` — WebGPU thumbnail rendering.
- `thumbnails/sample-strategy.ts` — Sample-frame strategy helpers.
