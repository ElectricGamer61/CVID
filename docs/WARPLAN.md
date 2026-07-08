# Cvideo Warplan

> The battle-doc for what Cvideo is, what's done, what's broken, and what happens next.
> Single source of truth for prioritization. Updated 2026-07-07.

---

## 1. Mission & product identity

- Local, free **wayinvideo / OpusClip clone** + an autonomous content operator. Two creation paths,
  one editor:
  1. **Long-form → shorts** — ingest a video, transcribe, AI-pick viral moments, 9:16 reframe,
     captions, editor, export.
  2. **Native reels** — silent B-roll + a separately-recorded/AI voiceover per scene, assembled to a
     9:16 reel. (Dennis never talks on camera; clip sorting is visual drag-and-drop, not speech-match.)
- **Me-first, sellable-shaped** (locked): brands are JSON **cartridges** (`backend/brands/*.json`),
  zero hardcoding. No AGPL/copyleft deps (Postiz cut, Remotion rejected, FreeCut is MIT). Automation
  must survive headless/server-side.
- **Runtime decisions locked this week:**
  - **No Claude API in-app.** Ideas come from Dennis's Claude subscription and get pasted in —
    `intake.parse_script` is deterministic, no LLM.
  - **ElevenLabs = transcription + AI voice** (paid, working).
  - **Lean mode** runs on any Windows laptop, no GPU / no ollama
    (`backend/requirements-lean.txt`, `backend/.env.example`, `scripts/setup-laptop.ps1`).
  - **Vercel rejected** (can't run a minutes-long ffmpeg backend with a persistent disk).
  - Repo: `github.com/ElectricGamer61/CVID` (private).

---

## 2. State of the union — what's DONE (verified in code)

- **Pipeline P1–P6** ✅, **Editor P1–P4** ✅ (Descript-style transcript editor, Submagic-style AI
  effects), **Autopilot A–D** ✅ (brand cartridges, tick loop, fail-closed gates, approval queue).
- Autopilot is ~95% complete with no stubs; state is crash-safe on the Ticket row (restart = resume).
- **Learning loop is code-complete but data-starved by design** — an empty `Perf` table means
  generation behaves exactly as before. It wakes up on its own once real performance data exists.
- Multi-device serving works: `serve.ps1` → `0.0.0.0:8000`, StaticFiles mount, firewall script,
  Tailscale for away access.
- **Tech debt is nearly zero** — only 4 intentional `# FUTURE` markers (cloud-storage seams). DB
  migrations are additive + idempotent (safe to re-run on every boot).

---

## 3. The battle map

Split into **NEAR-TERM** (personal use, no new costs) and **LAUNCH-GATED** (only if/when Cvideo is
sold as a product — new money + work). Dennis **posts manually today**; the paid automation is a
launch-time cost, not a now-thing.

### NEAR-TERM — make the personal creation flow excellent + reliable

**FRONT 1 (FIRST) — QUALITY CEILING: forced caption alignment**
- *Problem:* captions are even-split across the voice, not aligned to actual speech — the single
  biggest visible quality gap in the videos shipped by hand.
- *Approach:* recorded/AI voiceover → transcribe it (ElevenLabs Scribe returns word timings) → map
  timings onto the **known** script words (words are known; the audio only times them) → fill
  `Beat.caption_timings` (the column already exists, added for exactly this) → karaoke captions use
  real timing. Fallback stays even-split when no timings are available.

**FRONT 2 — QUALITY VERIFICATION (never eyeballed on a real export)**
1. One **watched render session**: AI effects (zoom/SFX — never eyeballed; the 4 SFX wavs are
   placeholder tones → swap for real one-shots), the emoji-in-burn decision (libass renders emoji
   monochrome/tofu), a trimmed voiced-reel export, and the long-form whole-clip voice `-shortest`
   tail-clip fix + reading-speed parity.
2. **ElevenLabs key with `text_to_speech` scope** (TTS was 401ing — Dennis action) so AI voice works.

**FRONT 3 — THE MANUAL LOOP (feeds the moat without paying for anything)**
- The flow Dennis already lives: **export → post by hand → log perf by hand** (`BulkLogger` exists).
- Verify the **Google Sheet webhook** (`PERF_SHEET_WEBHOOK_URL`) with one POST — his content-engine
  sheet.
- Manual perf entry at ~day-7 → the **learning loop self-activates** on real data. No Upload-Post
  needed for the moat to start working.
- **Autopilot stays useful without posting:** it can auto-advance script → assemble → **ready**,
  pause at the approval gate, and Dennis exports + posts manually. (Full auto-post is launch-gated.)

### LAUNCH-GATED — only touch these if Cvideo is launched as a product

**FRONT 4 — GO LIVE POSTING (costs money: Upload-Post subscription)**
- Set Upload-Post creds (`UPLOAD_POST_API_KEY` / `UPLOAD_POST_USER` / `UPLOAD_POST_TIMEZONE`) → one
  real post end-to-end.
- One supervised autopilot run: idea → posted on a test account.
- **Persist Upload-Post `job_id` on the Ticket** (currently returned by `poster.py` but dropped in
  `main.py` ~1136–1168) → enables cancel-scheduled + failure visibility. Metrics auto-pull via the
  Upload-Post analytics API (per-video pull needs that job_id).

**FRONT 5 — LOCK THE DOORS (before ANY multi-user / public exposure)**
- The API has **zero authentication**. CORS is localhost-only, but same-origin requests are
  unrestricted. For solo use on his own devices/Tailscale this is an accepted trust assumption. But
  the moment anyone else can reach it (a wedge customer, a public URL), **anyone on the network can
  delete projects, flip brand cartridges, and — once keys are set — post to the connected social
  accounts.**
- *v1 fix (small):* a single shared bearer token via a FastAPI dependency on `/api/*` + a token field
  in the frontend (localStorage). Full multi-user/tenant auth only if the wedge test demands it.

**FRONT 6 — THE WEDGE (the sellable-shaped bet)**
- Phase D polish: day-7 perf-reminder cards, in-UI autonomy dial.
- Wedge pressure-test (`docs/context/decisions.md`): top pick = **medical spas** (compliance-risky
  claims, visual-native, reachable via local outreach); alternates = real estate (Fair Housing),
  financial advisors (FINRA). A wedge customer = one new cartridge file.
- Standing tension acknowledged: **$100K solo this quarter** vs Game B raise/scale — both tested in
  parallel.

---

## 4. Known issues ledger (honest, complete)

- **UNVERIFIED:** zoom/SFX render output, emoji burn, autopilot end-to-end, live posting, TTS scope,
  Google Sheet webhook.
- **LIMITS:** Cut + per-scene-voice are mutually exclusive (per-scene export ignores `cuts_json`);
  reels are fixed 1080×1920 (no 1440p/4k tier; long-form clips already have tiers); reframe is a
  static smoothed center (no per-frame panning); the whisper model reloads per analyze (subprocess
  isolation trade-off).
- **DEBT (tolerated, not blocking):** `App.tsx` is a 3,187-line monolith (no error boundaries / code
  splitting) — refactor only when it hurts; tests are ad-hoc scripts (`verify_render.py`,
  `test_api2.py`…), no pytest/vitest suite; no down-migrations (additive-only is fine for a
  single-user SQLite DB).
- **FreeCut vendored editor:** embedded at `/editor/` but the UX is bolted-on (Phase 2b — auto-open
  a seeded project — is pending). The custom **ClipEditor** is the shipping editor; FreeCut's headless
  renderer is a future full-fidelity render seam.

---

## 5. Kill list (get rid of / never build)

- **Postiz** — cut permanently (AGPL + Meta ban + TikTok localhost walls). Upload-Post is the
  publisher.
- **Meta dev flow** — never (Facebook banned); broker via Upload-Post only.
- **PyTorch / MediaPipe** — never (Blackwell `sm_120` trap); faster-whisper + YuNet stay.
- **Deprecated `Ticket.captions` reads** — `post_meta` owns publish copy; drop the legacy reads when
  touched.
- **Claude / anthropic in-app path** — dormant by choice; strip only if it ever gets in the way.
- **graphify caches** — already gitignored.

---

## 6. Sequencing (one line)

**NEAR-TERM:** captions aligned → watched render (quality proof) → manual export + post + log →
learning loop wakes on real data.
**─── LAUNCH-GATED (only if selling):** Upload-Post live → token auth → wedge pitch with a working
demo.
