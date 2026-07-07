# Graph Report - .  (2026-07-02)

## Corpus Check
- 34 files · ~0 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 629 nodes · 1348 edges · 31 communities
- Extraction: 87% EXTRACTED · 13% INFERRED · 0% AMBIGUOUS · INFERRED: 172 edges (avg confidence: 0.51)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_pipelinerender|pipeline/render]]
- [[_COMMUNITY_appmain|app/main]]
- [[_COMMUNITY_srcApp|src/App]]
- [[_COMMUNITY_pipelineeffects|pipeline/effects]]
- [[_COMMUNITY_appautopilot|app/autopilot]]
- [[_COMMUNITY_pipelinebrain|pipeline/brain]]
- [[_COMMUNITY_appmain (2)|app/main (2)]]
- [[_COMMUNITY_srcapi|src/api]]
- [[_COMMUNITY_appmain (3)|app/main (3)]]
- [[_COMMUNITY_appmain (4)|app/main (4)]]
- [[_COMMUNITY_srcApp (2)|src/App (2)]]
- [[_COMMUNITY_appmain (5)|app/main (5)]]
- [[_COMMUNITY_pipelineingest|pipeline/ingest]]
- [[_COMMUNITY_appcartridge|app/cartridge]]
- [[_COMMUNITY_srcexportDir|src/exportDir]]
- [[_COMMUNITY_appmain (6)|app/main (6)]]
- [[_COMMUNITY_pipelinetranscribe|pipeline/transcribe]]
- [[_COMMUNITY_srcDialog|src/Dialog]]
- [[_COMMUNITY_appmain (7)|app/main (7)]]
- [[_COMMUNITY_appmain (8)|app/main (8)]]
- [[_COMMUNITY_srccaptionStyles|src/captionStyles]]
- [[_COMMUNITY_srcApp (3)|src/App (3)]]
- [[_COMMUNITY_appjobs|app/jobs]]
- [[_COMMUNITY_pipelineposter|pipeline/poster]]
- [[_COMMUNITY_pipelinetts|pipeline/tts]]
- [[_COMMUNITY_appmain (9)|app/main (9)]]
- [[_COMMUNITY_appmain (10)|app/main (10)]]
- [[_COMMUNITY_appsheets|app/sheets]]
- [[_COMMUNITY_srcApp (4)|src/App (4)]]
- [[_COMMUNITY_srcSidebar|src/Sidebar]]

## God Nodes (most connected - your core abstractions)
1. `get_session()` - 87 edges
2. `Ticket` - 28 edges
3. `Clip` - 25 edges
4. `Beat` - 25 edges
5. `Perf` - 25 edges
6. `Folder` - 24 edges
7. `Outlier` - 24 edges
8. `Angle` - 24 edges
9. `Project` - 23 edges
10. `useToast()` - 19 edges

## Surprising Connections (you probably didn't know these)
- `_do_assemble()` --calls--> `probe_duration()`  [INFERRED]
  backend/app/autopilot.py → backend/app/pipeline/ingest.py
- `assemble_ticket()` --calls--> `get_session()`  [INFERRED]
  backend/app/pipeline/assemble.py → backend/app/db.py
- `build_edit_video()` --calls--> `get_session()`  [INFERRED]
  backend/app/pipeline/assemble.py → backend/app/db.py
- `set_autopilot()` --calls--> `get_session()`  [EXTRACTED]
  backend/app/autopilot.py → backend/app/db.py
- `approve()` --calls--> `get_session()`  [EXTRACTED]
  backend/app/autopilot.py → backend/app/db.py

## Import Cycles
- None detected.

## Communities (31 total, 0 thin omitted)

### Community 0 - "pipeline/render"
Cohesion: 0.07
Nodes (61): assemble_ticket(), build_edit_video(), _concat_segments(), _even_split(), Path, Assemble a native-short ticket's beats into one 9:16 reel — local ffmpeg.  Pure, One stitched-preview segment: the beat clip cropped to 9:16 (looped to `dur`), Stitch a ticket's scene clips (in order) into ONE 9:16 video at     `project_dir (+53 more)

### Community 1 - "app/main"
Cohesion: 0.15
Nodes (54): Angle, _backfill_post_meta(), Beat, Clip, Folder, init_db(), _migrate(), _migrate_perf_videos() (+46 more)

### Community 2 - "src/App"
Cohesion: 0.04
Nodes (24): BRANDS, clipFileName(), COMING_SOON, downloadClip(), EditDoc, GATE_LABEL, MODE_ICONS, MODE_LABELS (+16 more)

### Community 3 - "pipeline/effects"
Cohesion: 0.06
Nodes (42): _extract_str_array(), _fallback_script(), hook_forge(), AI buttons — Script Factory + Hook Forge.  Reuses the same Ollama/Gemini clients, LLM → labeled script → parsed beats (via intake.parse_script). Falls back to a, script_factory(), llm_hook_critique(), post_gate() (+34 more)

### Community 4 - "app/autopilot"
Cohesion: 0.06
Nodes (42): advance_ticket(), approve(), _attempts(), _bump_attempt(), _do_assemble(), _do_footage_check(), _do_post(), _do_postmeta() (+34 more)

### Community 5 - "pipeline/brain"
Cohesion: 0.12
Nodes (25): build_timed_transcript(), _chunk_words(), _dedupe(), _ends_sentence(), _extract_json_array(), find_moments(), GeminiScorer, get_backend() (+17 more)

### Community 6 - "app/main (2)"
Cohesion: 0.08
Nodes (15): autopilot_status(), autopilot_tick(), get_project(), list_projects(), patch_project(), _proj_dict(), project_source(), queue() (+7 more)

### Community 7 - "src/api"
Cohesion: 0.07
Nodes (25): api, AutopilotState, Beat, Clip, ClipEffects, ExportItem, Folder, InsightsData (+17 more)

### Community 8 - "app/main (3)"
Cohesion: 0.09
Nodes (25): get_session(), delete_beat(), delete_clip(), delete_folder(), delete_outlier(), delete_project(), delete_ticket(), hook_forge() (+17 more)

### Community 9 - "app/main (4)"
Cohesion: 0.09
Nodes (24): _assemble_job(), assemble_ticket_route(), clip_auto_center(), clip_thumb(), clip_voiceover_file(), delete_clip_voiceover(), download_clip(), download_ticket() (+16 more)

### Community 10 - "src/App (2)"
Cohesion: 0.12
Nodes (20): AIEffectsPanel(), Autopilot(), Board(), defaultWhen(), fmtR(), folderOf(), Home(), Intake() (+12 more)

### Community 11 - "app/main (5)"
Cohesion: 0.13
Nodes (19): insights(), _is_reel_clip(), list_exports(), _perf_sheet_row(), Every rendered output across the app — project clips + assembled ticket reels., Set a video's brand on its own — no metrics needed. Lets you brand a reel straig, A caption-mode project's clip IS a reel (that's what lands in Home's 'Reels', The ONE display name for a video, identical across the editor, Results, Download (+11 more)

### Community 12 - "pipeline/ingest"
Cohesion: 0.19
Nodes (18): download_audio(), download_clip_range(), download_full(), download_proxy(), extract_audio(), extract_voiceover(), _finalize(), Path (+10 more)

### Community 13 - "app/cartridge"
Cohesion: 0.19
Nodes (17): Any, angle_library(), autonomy(), cadence(), hook_seeds(), list_brands(), load(), _path() (+9 more)

### Community 14 - "src/exportDir"
Cohesion: 0.24
Nodes (12): downloadFile(), Notify, clearExportDir(), DirHandle, exportDirSupported(), getExportDir(), idbDel(), idbGet() (+4 more)

### Community 15 - "app/main (6)"
Cohesion: 0.18
Nodes (13): add_beat(), _beats_for(), get_ticket(), import_script(), Delete a ticket's beats and recreate them from parsed script beats., Re-import: replace a ticket's beats from a freshly pasted script., AI: generate a script (hook + beats) for the ticket's angle, replacing its beats, Append a blank beat to a ticket (manual editing on the native path). (+5 more)

### Community 16 - "pipeline/transcribe"
Cohesion: 0.27
Nodes (12): _get_model(), Path, Transcription via faster-whisper (CTranslate2). No PyTorch required.  Tries CUDA, Transcribe via ElevenLabs Scribe (word-level timestamps). Needs ELEVENLABS_API_K, Dispatch to the chosen transcription backend; ElevenLabs falls back to local., On Windows the pip nvidia-* packages drop their DLLs in     site-packages/nvidia, Build model + fully consume transcription on one device. Raises on failure., _register_cuda_dlls() (+4 more)

### Community 17 - "src/Dialog"
Cohesion: 0.18
Nodes (10): NewFolderDrop(), ConfirmOpts, DialogCtx, DialogProvider(), Pending, PromptOpts, usePrompt(), Toast (+2 more)

### Community 18 - "app/main (7)"
Cohesion: 0.18
Nodes (12): create_ticket(), create_ticket_from_script(), _new_ticket(), post_ticket(), Best caption for a ticket: the platform's own, else any set, else the hook., Send a reel to Upload-Post — now (scheduled_at=None) or scheduled for a time., Intake: spin a ticket from a pasted Claude script, auto-split into beats., Spin a ticket pre-tagged with the outlier's angle (the MINE→ticket step). (+4 more)

### Community 19 - "app/main (8)"
Cohesion: 0.22
Nodes (11): build_edit(), delete_scene_voiceover(), _load_scene_vos(), A reel's quality score (0-100), derived from its SCRIPT. App-written (AI) script, Stitch a native reel's scenes into ONE video and open it in the clip editor., Save a recorded voiceover for one scene of a stitched reel., _scene_count(), scene_voiceover_file() (+3 more)

### Community 20 - "src/captionStyles"
Cohesion: 0.29
Nodes (9): Presets, Teleprompter(), CaptionOverlay(), captionAt(), CaptionStyle, endsSentence(), FALLBACK_PRESETS, groupLines() (+1 more)

### Community 21 - "src/App (3)"
Cohesion: 0.22
Nodes (9): ClipEditor(), ClipsPanel(), CutPanel(), FilmstripTimeline(), fmt(), srcToEdited(), TrimPanel(), useHistory() (+1 more)

### Community 22 - "app/jobs"
Cohesion: 0.36
Nodes (7): _analyze(), Background job runner: ingest -> transcribe -> brain -> create Clip rows.  Singl, _set(), submit_analyze(), create_project(), create_project_upload(), Project

### Community 23 - "pipeline/poster"
Cohesion: 0.32
Nodes (7): configured(), is_live(), post_reel(), Phase 6 — schedule/post adapter for the Upload-Post API, behind a DRY-RUN guard., True when a real Upload-Post key is configured (otherwise dry-run)., Readiness info for the UI (key set? user profile set?)., Post (or schedule) a reel to the given platforms.      ``when`` (ISO datetime) s

### Community 24 - "pipeline/tts"
Cohesion: 0.25
Nodes (6): list_voices(), Path, ElevenLabs text-to-speech — read a clip's transcript into a voiceover.  Mirrors, The account's voices [{voice_id, name}] — for the editor's voice picker. Empty o, Generate speech for `text` into `out_mp3`. Raises on missing key / empty text /, synthesize()

### Community 25 - "app/main (9)"
Cohesion: 0.38
Nodes (7): _beat_media_dir(), Save a recorded/uploaded voiceover for a clip (normalized to wav). Render then, _set_beat_media(), upload_beat_clip(), upload_beat_voiceover(), upload_clip_voiceover(), UploadFile

### Community 26 - "app/main (10)"
Cohesion: 0.33
Nodes (6): get_words(), ai_effects(), clip_tts_voiceover(), project_words(), Submagic-style AI auto-effects (opt-in). Runs ONLY the checked sub-effects: emph, Read the clip's transcript into a voiceover via ElevenLabs and store it as the c

### Community 27 - "app/sheets"
Cohesion: 0.40
Nodes (5): is_live(), push_perf_rows(), Push performance rows to a Google Sheet via an Apps Script web-app webhook.  Whe, True when a Sheet webhook URL is configured (otherwise rows stay local)., POST `rows` (list of dicts keyed by ROW_FIELDS) to the Sheet webhook.     Return

### Community 28 - "src/App (4)"
Cohesion: 0.67
Nodes (4): fmtWhen(), platLabel(), PostedRow(), QueuedRow()

### Community 29 - "src/Sidebar"
Cohesion: 0.50
Nodes (3): ICONS, Sidebar(), View

## Knowledge Gaps
- **33 isolated node(s):** `Route`, `GATE_LABEL`, `Phase`, `PHASES`, `PHASE_HINT` (+28 more)
  These have ≤1 connection - possible missing edges or undocumented components.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `get_session()` connect `app/main (3)` to `pipeline/render`, `app/main`, `app/autopilot`, `app/main (2)`, `app/main (4)`, `app/main (5)`, `app/main (6)`, `app/main (7)`, `app/main (8)`, `app/jobs`, `app/main (9)`, `app/main (10)`?**
  _High betweenness centrality (0.085) - this node is a cross-community bridge._
- **Why does `Ticket` connect `app/main` to `app/main (7)`, `app/autopilot`, `app/main (2)`?**
  _High betweenness centrality (0.009) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `get_session()` (e.g. with `assemble_ticket()` and `build_edit_video()`) actually correct?**
  _`get_session()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **Are the 20 inferred relationships involving `Ticket` (e.g. with `_backfill_post_meta()` and `AIBrief`) actually correct?**
  _`Ticket` has 20 INFERRED edges - model-reasoned connections that need verification._
- **Are the 19 inferred relationships involving `Clip` (e.g. with `AIBrief` and `AIEffectsBody`) actually correct?**
  _`Clip` has 19 INFERRED edges - model-reasoned connections that need verification._
- **Are the 19 inferred relationships involving `Beat` (e.g. with `AIBrief` and `AIEffectsBody`) actually correct?**
  _`Beat` has 19 INFERRED edges - model-reasoned connections that need verification._
- **Are the 19 inferred relationships involving `Perf` (e.g. with `AIBrief` and `AIEffectsBody`) actually correct?**
  _`Perf` has 19 INFERRED edges - model-reasoned connections that need verification._