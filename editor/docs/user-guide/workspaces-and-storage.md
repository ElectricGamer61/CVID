# Workspaces and Storage

FreeCut is local-first. It uses a workspace folder you choose, then asks the browser for read/write permission when it needs that folder again.

## What the workspace contains

FreeCut writes project data into the workspace folder, including:

- Projects and project settings
- Media metadata
- Thumbnails and waveforms
- Generated AI assets
- Transcripts and scene cuts
- Project caches
- Exports

Imported local media is linked from its location on disk. FreeCut does not upload source media to a server.

## Permissions and reconnecting

The browser can expire folder permission between sessions. When FreeCut shows **Reconnect your workspace**, choose **Reconnect** and grant read/write access to the same folder.

If permission is denied, choose the folder again and allow access. If the folder moved, was renamed, or is no longer available, choose **Choose a different folder**.

## Switching workspaces

Use the **Workspaces** control to switch, remove, or add known workspaces. Switching changes which workspace folder FreeCut reads from and writes to; it does not move source media unless you export or import a project bundle.

## Project bundles

Use **Export Project** when you need a portable project bundle. A bundle packages project data and media files so another workspace can import them.

## Missing media

When FreeCut shows **Missing Media**, it cannot read one or more linked files. Use **Grant Access**, **Locate**, **Locate Folder**, or **Browse Another Folder** to restore access. You can also choose **Work Offline** and continue editing with broken references until the files are available.

## Cache maintenance

Project cache actions remove regenerated data such as waveforms, filmstrips, GIF frames, decoded audio, and local model cache entries. Cache cleanup does not delete source media. Missing previews or waveforms can be regenerated when the project needs them.
