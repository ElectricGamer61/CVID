"""Integrated end-to-end test against the running FastAPI server:
upload the local test video -> poll until ready -> render clip 0 -> download.
"""
from __future__ import annotations

import io
import sys
import time
from pathlib import Path

import requests

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

BASE = "http://127.0.0.1:8000"
HERE = Path(__file__).resolve().parent
SRC = HERE / "data" / "_verify" / "test_speech.mp4"
SRC = (HERE.parent / "data" / "_verify" / "test_speech.mp4")


def main():
    assert SRC.exists(), f"missing test video {SRC}"

    print("health:", requests.get(f"{BASE}/api/health", timeout=5).json())
    print("presets:", requests.get(f"{BASE}/api/presets", timeout=5).json())

    print("\nUploading project…")
    with SRC.open("rb") as f:
        r = requests.post(
            f"{BASE}/api/projects/upload",
            data={"name": "API smoke test", "brain": "ollama",
                  "aspect": "9:16", "caption_preset": "capcut"},
            files={"file": ("test_speech.mp4", f, "video/mp4")},
            timeout=30,
        )
    r.raise_for_status()
    pid = r.json()["id"]
    print("  project id:", pid)

    print("Polling status…")
    deadline = time.time() + 300
    status = ""
    while time.time() < deadline:
        d = requests.get(f"{BASE}/api/projects/{pid}", timeout=10).json()
        p = d["project"]
        if p["status"] != status:
            status = p["status"]
            print(f"  status={status} stage={p['stage']} progress={p['progress']}")
        if p["status"] == "ready":
            clips = d["clips"]
            break
        if p["status"] == "error":
            raise RuntimeError(f"project failed: {p['error']}")
        time.sleep(2)
    else:
        raise TimeoutError("project did not become ready in time")

    print(f"\n{len(clips)} clips:")
    for c in clips:
        print(f"  [{c['start']:.1f}-{c['end']:.1f}] score={c['score']:.0f} {c['title']}")
    assert clips, "no clips produced"

    cid = clips[0]["id"]
    print(f"\nRendering clip {cid}…")
    requests.post(f"{BASE}/api/clips/{cid}/render", timeout=10)
    deadline = time.time() + 180
    while time.time() < deadline:
        d = requests.get(f"{BASE}/api/projects/{pid}", timeout=10).json()
        c = next(x for x in d["clips"] if x["id"] == cid)
        if c["status"] == "rendered":
            break
        if c["status"] == "error":
            raise RuntimeError(f"render failed: {c['error']}")
        time.sleep(2)
    else:
        raise TimeoutError("render did not finish")

    print("Downloading rendered clip…")
    dl = requests.get(f"{BASE}/api/clips/{cid}/download", timeout=30)
    dl.raise_for_status()
    out = HERE.parent / "data" / "_verify" / "api_download.mp4"
    out.write_bytes(dl.content)
    print(f"  saved {out} ({len(dl.content)} bytes)")
    assert len(dl.content) > 0

    print("\nAPI END-TO-END PASSED")


if __name__ == "__main__":
    main()
