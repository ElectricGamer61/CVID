# Graph Report - .  (2026-07-01)

## Corpus Check
- Corpus is ~20,512 words - fits in a single context window. You may not need a graph.

## Summary
- 576 nodes · 1211 edges · 26 communities (25 shown, 1 thin omitted)
- Extraction: 88% EXTRACTED · 12% INFERRED · 0% AMBIGUOUS · INFERRED: 150 edges (avg confidence: 0.51)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Data Model (SQLModel)|Data Model (SQLModel)]]
- [[_COMMUNITY_Reel Assembly Pipeline|Reel Assembly Pipeline]]
- [[_COMMUNITY_Frontend App Shell & Routing|Frontend App Shell & Routing]]
- [[_COMMUNITY_Posting Adapter (Upload-Post P6)|Posting Adapter (Upload-Post P6)]]
- [[_COMMUNITY_Beat Media UploadDownload|Beat Media Upload/Download]]
- [[_COMMUNITY_Moment-Picking Brain|Moment-Picking Brain]]
- [[_COMMUNITY_Background Job Runner|Background Job Runner]]
- [[_COMMUNITY_Frontend API Client & Types|Frontend API Client & Types]]
- [[_COMMUNITY_AI Generation (ScriptHook)|AI Generation (Script/Hook)]]
- [[_COMMUNITY_Exports & Video NamingBrand|Exports & Video Naming/Brand]]
- [[_COMMUNITY_Media Ingest (yt-dlp)|Media Ingest (yt-dlp)]]
- [[_COMMUNITY_Frontend Package Config|Frontend Package Config]]
- [[_COMMUNITY_Board  Ticket UI|Board / Ticket UI]]
- [[_COMMUNITY_TypeScript Config|TypeScript Config]]
- [[_COMMUNITY_Browser Storage & Download|Browser Storage & Download]]
- [[_COMMUNITY_Dialog  Prompt UI|Dialog / Prompt UI]]
- [[_COMMUNITY_API Test Suite 2|API Test Suite 2]]
- [[_COMMUNITY_Caption Rendering & Styles|Caption Rendering & Styles]]
- [[_COMMUNITY_DB Migrations & Backfill|DB Migrations & Backfill]]
- [[_COMMUNITY_Clip Editor (timelinetrimcut)|Clip Editor (timeline/trim/cut)]]
- [[_COMMUNITY_Learning Loop (winners)|Learning Loop (winners)]]
- [[_COMMUNITY_Queue  Schedule UI|Queue / Schedule UI]]
- [[_COMMUNITY_Sidebar Navigation|Sidebar Navigation]]
- [[_COMMUNITY_API Test Suite (e2e)|API Test Suite (e2e)]]

## God Nodes (most connected - your core abstractions)
1. `get_session()` - 70 edges
2. `Ticket` - 24 edges
3. `Clip` - 23 edges
4. `Perf` - 23 edges
5. `Folder` - 22 edges
6. `Outlier` - 22 edges
7. `Beat` - 22 edges
8. `Angle` - 22 edges
9. `Project` - 21 edges
10. `useToast()` - 17 edges

## Surprising Connections (you probably didn't know these)
- `assemble_ticket()` --calls--> `get_session()`  [INFERRED]
  backend/app/pipeline/assemble.py → backend/app/db.py
- `build_edit_video()` --calls--> `get_session()`  [INFERRED]
  backend/app/pipeline/assemble.py → backend/app/db.py
- `render_plain()` --calls--> `crop_filter()`  [INFERRED]
  backend/diag_captions.py → backend/app/pipeline/reframe.py
- `render_plain()` --calls--> `probe_size()`  [INFERRED]
  backend/diag_captions.py → backend/app/pipeline/reframe.py
- `AIBrief` --uses--> `Project`  [INFERRED]
  backend/app/main.py → backend/app/db.py

## Import Cycles
- None detected.

## Communities (26 total, 1 thin omitted)

### Community 0 - "Data Model (SQLModel)"
Cohesion: 0.06
Nodes (106): Angle, Beat, Clip, Folder, get_session(), Outlier, Perf, Project (+98 more)

### Community 1 - "Reel Assembly Pipeline"
Cohesion: 0.08
Nodes (55): assemble_ticket(), build_edit_video(), _concat_segments(), _even_split(), Path, Assemble a native-short ticket's beats into one 9:16 reel — local ffmpeg.  Pure, One stitched-preview segment: the beat clip cropped to 9:16 (looped to `dur`), Stitch a ticket's scene clips (in order) into ONE 9:16 video at     `project_dir (+47 more)

### Community 2 - "Frontend App Shell & Routing"
Cohesion: 0.05
Nodes (23): BRANDS, clipFileName(), COMING_SOON, downloadClip(), EditDoc, MODE_ICONS, MODE_LABELS, modeIcon() (+15 more)

### Community 3 - "Posting Adapter (Upload-Post P6)"
Cohesion: 0.06
Nodes (33): configured(), is_live(), post_reel(), Phase 6 — schedule/post adapter for the Upload-Post API, behind a DRY-RUN guard., True when a real Upload-Post key is configured (otherwise dry-run)., Readiness info for the UI (key set? user profile set?)., Post (or schedule) a reel to the given platforms.      ``when`` (ISO datetime) s, is_live() (+25 more)

### Community 4 - "Beat Media Upload/Download"
Cohesion: 0.07
Nodes (35): _beat_media_dir(), clip_auto_center(), clip_thumb(), clip_voiceover_file(), delete_clip_voiceover(), delete_scene_voiceover(), download_clip(), download_ticket() (+27 more)

### Community 5 - "Moment-Picking Brain"
Cohesion: 0.12
Nodes (25): build_timed_transcript(), _chunk_words(), _dedupe(), _ends_sentence(), _extract_json_array(), find_moments(), GeminiScorer, get_backend() (+17 more)

### Community 6 - "Background Job Runner"
Cohesion: 0.12
Nodes (23): _analyze(), Background job runner: ingest -> transcribe -> brain -> create Clip rows.  Singl, _set(), submit_analyze(), build_edit(), create_project(), create_project_upload(), A reel's quality score (0-100), derived from its SCRIPT. App-written (AI) script (+15 more)

### Community 7 - "Frontend API Client & Types"
Cohesion: 0.09
Nodes (21): api, Beat, Clip, ExportItem, Folder, InsightsData, J, NewTicketBody (+13 more)

### Community 8 - "AI Generation (Script/Hook)"
Cohesion: 0.13
Nodes (19): _extract_str_array(), _fallback_script(), _gemini_chat(), hook_forge(), _llm_text(), _ollama_chat(), AI buttons — Script Factory + Hook Forge.  Reuses the same Ollama/Gemini clients, Try the preferred brain, then the other, raising if none work. (+11 more)

### Community 9 - "Exports & Video Naming/Brand"
Cohesion: 0.13
Nodes (19): insights(), _is_reel_clip(), list_exports(), _perf_sheet_row(), Every rendered output across the app — project clips + assembled ticket reels., Set a video's brand on its own — no metrics needed. Lets you brand a reel straig, A caption-mode project's clip IS a reel (that's what lands in Home's 'Reels', The ONE display name for a video, identical across the editor, Results, Download (+11 more)

### Community 10 - "Media Ingest (yt-dlp)"
Cohesion: 0.19
Nodes (18): download_audio(), download_clip_range(), download_full(), download_proxy(), extract_audio(), extract_voiceover(), _finalize(), Path (+10 more)

### Community 11 - "Frontend Package Config"
Cohesion: 0.11
Nodes (17): dependencies, react, react-dom, devDependencies, @types/react, @types/react-dom, typescript, vite (+9 more)

### Community 12 - "Board / Ticket UI"
Cohesion: 0.13
Nodes (18): Board(), defaultWhen(), fmtR(), folderOf(), Home(), Intake(), Library(), MomentCard() (+10 more)

### Community 13 - "TypeScript Config"
Cohesion: 0.12
Nodes (15): compilerOptions, allowImportingTsExtensions, esModuleInterop, jsx, lib, module, moduleResolution, noEmit (+7 more)

### Community 14 - "Browser Storage & Download"
Cohesion: 0.24
Nodes (12): downloadFile(), Notify, clearExportDir(), DirHandle, exportDirSupported(), getExportDir(), idbDel(), idbGet() (+4 more)

### Community 15 - "Dialog / Prompt UI"
Cohesion: 0.18
Nodes (10): NewFolderDrop(), ConfirmOpts, DialogCtx, DialogProvider(), Pending, PromptOpts, usePrompt(), Toast (+2 more)

### Community 16 - "API Test Suite 2"
Cohesion: 0.33
Nodes (10): has_text(), main(), poll_ready(), Path, Integrated test for the v2 features: - upload project -> patch trim+caption styl, Sample several frames across the clip; captions only show while words play,, render_and_wait(), test_delete() (+2 more)

### Community 17 - "Caption Rendering & Styles"
Cohesion: 0.29
Nodes (9): Presets, Teleprompter(), CaptionOverlay(), captionAt(), CaptionStyle, endsSentence(), FALLBACK_PRESETS, groupLines() (+1 more)

### Community 18 - "DB Migrations & Backfill"
Cohesion: 0.22
Nodes (9): _backfill_post_meta(), init_db(), _migrate(), _migrate_perf_videos(), One-time: make Perf video-aware. The old table had a NOT NULL `ticket_id` (so it, Tiny additive migration: add columns that create_all won't add to an     existin, One-time data migration: fold legacy `Ticket.captions {tt,ig,yt}` (plain strings, _startup() (+1 more)

### Community 19 - "Clip Editor (timeline/trim/cut)"
Cohesion: 0.22
Nodes (9): ClipEditor(), ClipsPanel(), CutPanel(), FilmstripTimeline(), fmt(), srcToEdited(), TrimPanel(), useHistory() (+1 more)

### Community 20 - "Learning Loop (winners)"
Cohesion: 0.50
Nodes (4): Aggregate logged performance into the account's top hooks / angles / caption sty, A short prompt insert describing what's worked for this account. Empty string wh, winners_prompt_block(), winning_patterns()

### Community 21 - "Queue / Schedule UI"
Cohesion: 0.67
Nodes (4): fmtWhen(), platLabel(), PostedRow(), QueuedRow()

### Community 22 - "Sidebar Navigation"
Cohesion: 0.50
Nodes (3): ICONS, Sidebar(), View

## Knowledge Gaps
- **58 isolated node(s):** `name`, `private`, `version`, `type`, `dev` (+53 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `get_session()` connect `Data Model (SQLModel)` to `Reel Assembly Pipeline`, `Beat Media Upload/Download`, `Background Job Runner`, `Exports & Video Naming/Brand`, `DB Migrations & Backfill`, `Learning Loop (winners)`?**
  _High betweenness centrality (0.042) - this node is a cross-community bridge._
- **Why does `crop_filter()` connect `Reel Assembly Pipeline` to `Data Model (SQLModel)`, `Posting Adapter (Upload-Post P6)`, `Beat Media Upload/Download`?**
  _High betweenness centrality (0.008) - this node is a cross-community bridge._
- **Why does `probe_size()` connect `Reel Assembly Pipeline` to `Data Model (SQLModel)`, `Posting Adapter (Upload-Post P6)`, `Beat Media Upload/Download`?**
  _High betweenness centrality (0.008) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `get_session()` (e.g. with `assemble_ticket()` and `build_edit_video()`) actually correct?**
  _`get_session()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **Are the 18 inferred relationships involving `Ticket` (e.g. with `_backfill_post_meta()` and `AIBrief`) actually correct?**
  _`Ticket` has 18 INFERRED edges - model-reasoned connections that need verification._
- **Are the 17 inferred relationships involving `Clip` (e.g. with `AIBrief` and `BeatPatch`) actually correct?**
  _`Clip` has 17 INFERRED edges - model-reasoned connections that need verification._
- **Are the 17 inferred relationships involving `Perf` (e.g. with `AIBrief` and `BeatPatch`) actually correct?**
  _`Perf` has 17 INFERRED edges - model-reasoned connections that need verification._