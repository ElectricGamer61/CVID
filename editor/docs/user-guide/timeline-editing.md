# Timeline Editing

The timeline is the main edit surface. It contains video and audio tracks, clip items, markers, in/out points, and tool controls.

## Add clips to tracks

Drag media from the Media panel to a video or audio track. Use **Add Video Track** or **Add Audio Track** when the current tracks are not enough.

Video tracks hold visual items such as video, image, text, shapes, captions, and adjustment layers. Audio tracks hold audio clips and linked audio from video files.

## Track controls

Common track controls include **Lock Track**, **Unlock Track**, **Solo Track**, **Unsolo Track**, **Enable Track**, **Disable Track**, and sync lock. Lock prevents edits on a track. Visibility or enable state controls whether a track contributes to preview and export. Solo isolates a track for review. Sync lock keeps track timing aligned during ripple-style edits.

## Selection and linked selection

Use the **Select Tool** for normal clip selection and movement. **Linked Selection** controls whether linked video and audio clips select and move together. Use link and unlink commands when clips need to stay paired or separate.

## Split, join, delete

Use **Split at playhead** or the **Razor Tool** to cut clips. Use **Join Selected**, **Join With Next**, or **Join With Previous** when adjacent clip sections can be rejoined.

Use Delete for selected items. Use **Ripple Delete** to delete selected items and close the gap. Use **Close All Gaps** when you want FreeCut to remove empty timeline space across a track.

## Trim tools

The **Trim Edit Tool** adjusts clip edges. Ripple trim changes the edit and shifts later material. A rolling trim moves the cut between neighboring clips. The **Slip Tool** performs a slip edit, changing which source frames appear inside a clip without moving the clip. The **Slide Tool** performs a slide edit, moving a clip while adjusting adjacent edit points. The **Rate Stretch Tool** performs a rate stretch edit, changing clip duration by changing playback speed.

## Snapping, markers, and range

Use **Enable Snapping** or **Disable Snapping** to control whether clips snap to nearby cuts, markers, and the playhead. Use **Add Marker**, **Remove Selected Marker**, and marker navigation for edit notes and timing references.

Use **Set In Point**, **Set Out Point**, and **Clear In Out Points** to define an in/out range for preview and export workflows.

## Timeline zoom

Use **Zoom In**, **Zoom Out**, **Zoom To Fit**, and the zoom slider to scale the timeline. Zoom changes the view, not clip timing.

## Undo and redo

Use **Undo** and **Redo** from the timeline header, or use `Ctrl+Z` to undo and `Ctrl+Shift+Z` to redo.
