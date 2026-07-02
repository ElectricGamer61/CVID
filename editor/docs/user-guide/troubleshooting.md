# Troubleshooting

Use these checks when a project cannot open, media cannot relink, or export cannot start.

## Unsupported browser

Symptom: FreeCut shows **Unsupported browser** or the workspace picker is unavailable.

Likely cause: The browser does not support the File System Access API, OPFS, WebCodecs, or WebGPU features FreeCut needs.

What to do: Use Chrome or Edge 113+. Recent Chromium browsers are the supported path for the full workflow.

## Brave cannot choose a workspace folder

Symptom: Brave does not open the folder picker or cannot keep workspace access.

Likely cause: Brave may disable the File System Access API.

What to do: Open `brave://flags/#file-system-access-api`, set the flag to **Enabled**, and relaunch Brave.

## Workspace permission denied

Symptom: FreeCut says permission was not granted or cannot open the selected folder.

Likely cause: The browser was denied read/write access, or the folder is a restricted system location.

What to do: Choose a normal folder you can edit, then allow read/write access.

## FreeCut asks to reconnect the workspace

Symptom: FreeCut shows **Reconnect your workspace** after reopening the app.

Likely cause: Browser folder permission expired between sessions.

What to do: Choose **Reconnect** and grant access to the same workspace folder. If the folder moved, choose a different folder.

## Media is missing

Symptom: FreeCut shows **Missing Media** or clips show missing-media indicators.

Likely cause: A linked file moved, was renamed, was deleted, or needs renewed permission.

What to do: Use **Grant Access**, **Locate**, **Locate Folder**, or **Browse Another Folder**. Use **Work Offline** only when you can relink later.

## Import failed or codec unsupported

Symptom: A file fails to import, or FreeCut shows **Unsupported codec**.

Likely cause: The browser cannot decode the file, the file is damaged, or the link is not a direct media URL.

What to do: Try another browser-supported format, transcode the source file, or choose **Import Anyway** only if you understand the risk.

## WebGPU unavailable

Symptom: Local AI tools, effects, scopes, or accelerated media features are unavailable.

Likely cause: WebGPU is disabled, blocked by hardware or driver support, or unavailable in the current browser.

What to do: Use a recent Chrome or Edge build, update GPU drivers, and check browser hardware acceleration settings.

## Local AI model download is slow or fails

Symptom: Local AI stays in loading state, or a model download fails.

Likely cause: The first local model download can be large, network access can fail, or browser-managed storage can be full.

What to do: Keep the tab open, retry on a stable connection, clear the Local AI Model Cache if a download is corrupt, and confirm the browser has storage available.

## Export codec unavailable

Symptom: Export preflight says the selected format cannot be encoded or the codec is unavailable.

Likely cause: Browser encoding support does not match the selected format, codec, resolution, or quality.

What to do: Choose another codec or format, lower resolution or quality, or retry in a recent Chromium browser.

## Worker export fallback

Symptom: Export preflight says **Worker export unavailable** or that a main-thread fallback will be used.

Likely cause: The current browser or project content cannot use the export worker path.

What to do: Keep the tab focused and avoid heavy interaction during export. Replace animated image items with video clips when they trigger fallback.

## Export is large or slow

Symptom: Export preflight warns that the file may be large or that the export may be slow.

Likely cause: The timeline is long, the resolution is high, the quality preset is high, or the selected range is large.

What to do: Export a shorter in/out range first, use Balanced or Small, lower resolution, or free disk space before rendering.
