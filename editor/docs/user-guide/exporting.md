# Exporting

FreeCut renders exports locally in the browser. Keep the project tab open until the export finishes.

## Export type

Use **Export Video** for a rendered video file. Use **Export Audio** for an audio-only file.

## Range

Choose **Render whole project** to export the complete timeline. If in/out points are set, choose the in/out range when you only need that section.

## Formats and codecs

Video formats include MP4, MOV, WebM, and MKV. Audio formats include MP3, AAC, and WAV.

Codec support depends on browser capabilities. If the selected codec is not available, FreeCut can show a preflight warning or use a supported fallback.

## Quality and resolution

Use **Quality** and **Resolution** to control output size and render cost. Higher quality and higher resolution usually take longer and create larger files.

Use **Embed subtitles** when transcript captions should be included as a subtitle track. Embedded subtitles are supported in MP4, MKV, and WebM. Some players do not show subtitle tracks by default.

## Export preflight

The **Export preflight** checks for common blockers before rendering:

- Empty range
- Missing media
- Codec unavailable
- Worker export fallback
- Large export file expected
- Long export may take a while

Fix warnings before exporting when they affect the output. For quick validation, export a shorter in/out range first.

## Progress and cancellation

Export progress can show preparing, rendering, encoding, finalizing, complete, cancelled, or failed states. Use **Cancel** if you need to stop the export.

Keep this tab open until the export finishes. Worker export is preferred when available; main-thread fallback may need the tab to stay focused and quiet.

## Download

When the export completes, choose **Download**. FreeCut saves the rendered file from the browser.

The render queue is planned as a separate advanced guide.
