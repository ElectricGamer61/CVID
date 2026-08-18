"""A failed YouTube job must stay an ordinary project error you can retry.

Runs the real analyze worker and the real /api/projects/{id}/retry route against a
throwaway database (CVIDEO_DATA_DIR), with yt-dlp stubbed out - no network, no browser
profile, no media. What it proves: a bot/sign-in challenge ends as status="error" with an
actionable message, the project and its source URL survive, the backend keeps serving, and
a retry re-runs the same project and succeeds once the fallback can reach the video.
"""
from __future__ import annotations
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
_TMP = tempfile.TemporaryDirectory()
os.environ["CVIDEO_DATA_DIR"] = _TMP.name          # must precede the settings import
os.environ.setdefault("CVIDEO_LEARNING", "off")

import settings                                     # noqa: E402
from app import jobs                                # noqa: E402
from app.db import Project, get_session, init_db    # noqa: E402
from app.pipeline import ingest                     # noqa: E402

failed = []
def check(name, ok):
    print(("  ok   " if ok else "  FAIL ") + name)
    if not ok: failed.append(name)


CHALLENGE = ("YouTube asked you to sign in because it detected automated traffic. "
             "The browser-cookie fallback is turned off. Set "
             "CVIDEO_YOUTUBE_COOKIE_BROWSERS=chrome,edge,firefox in backend/.env and retry.")


def _make_project(url: str) -> int:
    init_db()
    with get_session() as s:
        p = Project(name="bot challenge", source_type="url", source_url=url, mode="caption")
        s.add(p); s.commit(); s.refresh(p)
        return p.id


def _project(pid: int) -> Project:
    with get_session() as s:
        return s.get(Project, pid)


def test_challenge_is_a_project_error_not_a_crash():
    url = "https://youtube.example/watch?v=blocked"
    pid = _make_project(url)
    original = (ingest.download_audio, ingest.download_proxy)
    def blocked(*_args, **_kwargs):
        raise RuntimeError(CHALLENGE)
    ingest.download_audio = ingest.download_proxy = blocked
    try:
        jobs._analyze(pid, None)            # the worker body, run inline
    finally:
        ingest.download_audio, ingest.download_proxy = original

    p = _project(pid)
    check("failed YouTube job ends as a project error", p.status == "error")
    check("stage names the ingest step", "URL ingest" in (p.stage or ""))
    check("error text stays actionable", "CVIDEO_YOUTUBE_COOKIE_BROWSERS" in (p.error or ""))
    check("error is the user-facing message, not a type name",
          not (p.error or "").startswith("RuntimeError"))
    check("source URL is preserved for the retry", p.source_url == url)
    return pid


def test_retry_reruns_the_same_project(pid: int):
    from app import main                    # the real route, not a re-implementation
    original = (ingest.download_audio, jobs.submit_analyze)
    submitted = []
    jobs.submit_analyze = lambda project_id, upload_path=None: submitted.append(project_id)
    main.submit_analyze = jobs.submit_analyze
    try:
        result = main.retry_project(pid)
    finally:
        ingest.download_audio, jobs.submit_analyze = original
        main.submit_analyze = jobs.submit_analyze

    p = _project(pid)
    check("retry is accepted for an errored project", result.get("ok") is True)
    check("retry clears the error and re-queues", p.status == "created" and p.error is None
          and submitted == [pid])

    # And the second run gets through once the cookie fallback can reach the video.
    original_audio = ingest.download_audio
    def fake_audio(url, audio):
        Path(audio).write_bytes(b"RIFF")
        return Path(audio), 42.0
    ingest.download_audio = fake_audio
    original_tx, original_proxy = jobs.transcribe_subprocess, ingest.download_proxy
    original_prefetch = jobs._prefetch_full
    # Keep the run hermetic: the preview proxy and the full-video prefetch would otherwise
    # send the fake URL to yt-dlp for real.
    jobs.transcribe_subprocess = lambda *a, **k: {"text": "", "words": [], "segments": []}
    ingest.download_proxy = lambda url, out: Path(out)
    jobs._prefetch_full = lambda *a, **k: None
    try:
        jobs._analyze(pid, None)
    finally:
        ingest.download_audio, jobs.transcribe_subprocess = original_audio, original_tx
        ingest.download_proxy, jobs._prefetch_full = original_proxy, original_prefetch
    p = _project(pid)
    check("a retry that succeeds leaves the project usable",
          p.status == "ready" and p.error is None and p.duration == 42.0)


def test_backend_survives_and_keeps_serving(pid: int):
    # The API must still answer after the failure above: the worker catches the error, so
    # it never propagates into the executor thread or the app. (Route handlers are called
    # directly - an HTTP client would add a test-only dependency for no extra coverage.)
    from app import main
    health = main.health()
    listed = main.list_projects()
    check("health route still answers after a failed job", bool(health))
    check("the failed project is still listed and retryable",
          any(row["id"] == pid for row in listed))


if __name__ == "__main__":
    pid = test_challenge_is_a_project_error_not_a_crash()
    test_retry_reruns_the_same_project(pid)
    test_backend_survives_and_keeps_serving(pid)
    print("\n" + ("ALL PASSED" if not failed else f"{len(failed)} FAILED: {failed}"))
    raise SystemExit(bool(failed))
