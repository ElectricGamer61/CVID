"""Integrated test for the v2 features:
- upload project -> patch trim+caption style -> render -> confirm captions visible
- URL project -> confirm ONLY audio+proxy downloaded (no full source.mp4) -> render a
  per-range clip -> download
- delete a project -> rows + folder gone
"""
from __future__ import annotations

import io
import subprocess
import sys
import time
from pathlib import Path

import requests

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
BASE = "http://127.0.0.1:8000"
HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
SRC = ROOT / "data" / "_verify" / "test_speech.mp4"
YT = "https://www.youtube.com/watch?v=_Jg9obCxgoU"


def poll_ready(pid, timeout=400):
    deadline = time.time() + timeout
    last = ""
    while time.time() < deadline:
        d = requests.get(f"{BASE}/api/projects/{pid}", timeout=10).json()
        p = d["project"]
        if p["stage"] != last:
            last = p["stage"]
            print(f"   {p['status']} / {p['stage']} ({p['progress']}%)")
        if p["status"] == "ready":
            return d["clips"]
        if p["status"] == "error":
            raise RuntimeError(p["error"])
        time.sleep(2)
    raise TimeoutError("not ready")


def render_and_wait(cid, pid, timeout=240):
    requests.post(f"{BASE}/api/clips/{cid}/render", timeout=10)
    deadline = time.time() + timeout
    while time.time() < deadline:
        d = requests.get(f"{BASE}/api/projects/{pid}", timeout=10).json()
        c = next(x for x in d["clips"] if x["id"] == cid)
        if c["status"] == "rendered":
            return c
        if c["status"] == "error":
            raise RuntimeError(c["error"])
        time.sleep(2)
    raise TimeoutError("render timeout")


def has_text(mp4: Path) -> bool:
    """Sample several frames across the clip; captions only show while words play,
    so pass if ANY frame has white caption fill (testsrc bars are never white)."""
    import cv2
    best = 0
    for t in (1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0):
        png = mp4.with_suffix(f".f{t}.png")
        subprocess.run(["ffmpeg", "-y", "-ss", str(t), "-i", str(mp4), "-frames:v", "1",
                        str(png)], check=True, capture_output=True)
        img = cv2.imread(str(png))
        if img is None:
            continue
        white = int((img.min(axis=2) > 200).sum())
        best = max(best, white)
    print(f"     max near-white caption pixels across frames: {best}")
    return best > 400


def test_upload():
    print("\n== UPLOAD e2e + style + captions ==")
    with SRC.open("rb") as f:
        r = requests.post(f"{BASE}/api/projects/upload",
                          data={"name": "v2 upload", "brain": "ollama",
                                "aspect": "9:16", "caption_preset": "capcut"},
                          files={"file": ("test_speech.mp4", f, "video/mp4")}, timeout=30)
    pid = r.json()["id"]
    clips = poll_ready(pid)
    cid = clips[0]["id"]
    # patch trim + a custom caption style
    requests.patch(f"{BASE}/api/clips/{cid}", json={
        "start": clips[0]["start"], "end": min(clips[0]["end"], clips[0]["start"] + 8),
        "caption_preset": "hormozi",
        "style": {"color": "#FFFFFF", "highlight": "#22FF55", "outline_color": "#000000",
                  "size": 100, "position": "mid", "max_words": 3, "uppercase": True,
                  "font": "Arial", "outline": 8, "shadow": 0, "bold": 1},
    }, timeout=10)
    c = render_and_wait(cid, pid)
    out = ROOT / "data" / "_verify" / "v2_upload.mp4"
    out.write_bytes(requests.get(f"{BASE}/api/clips/{cid}/download", timeout=30).content)
    print(f"   downloaded {out.stat().st_size} bytes")
    assert has_text(out), "captions not visible in exported clip!"
    print("   ✓ captions visible")
    return pid


def test_url_efficient():
    print("\n== URL project: efficient download + per-range render ==")
    r = requests.post(f"{BASE}/api/projects", json={
        "name": "v2 url", "source_url": YT, "brain": "ollama",
        "aspect": "9:16", "caption_preset": "capcut"}, timeout=30)
    pid = r.json()["id"]
    clips = poll_ready(pid)
    pdir = ROOT / "data" / "projects" / str(pid)
    full = pdir / "source.mp4"
    proxy = pdir / "proxy.mp4"
    audio = pdir / "audio.wav"
    print(f"   source.mp4 exists? {full.exists()} (should be False)")
    print(f"   proxy.mp4 exists?  {proxy.exists()} (should be True)")
    print(f"   audio.wav exists?  {audio.exists()} (should be True)")
    assert not full.exists(), "full video was downloaded — not efficient!"
    assert proxy.exists() and audio.exists()
    cid = clips[0]["id"]
    c = render_and_wait(cid, pid)
    out = ROOT / "data" / "_verify" / "v2_url.mp4"
    out.write_bytes(requests.get(f"{BASE}/api/clips/{cid}/download", timeout=30).content)
    print(f"   per-range render downloaded {out.stat().st_size} bytes")
    assert out.stat().st_size > 0
    print("   ✓ efficient URL pipeline works")
    return pid


def test_delete(pid):
    print("\n== DELETE ==")
    requests.delete(f"{BASE}/api/projects/{pid}", timeout=10)
    folder = ROOT / "data" / "projects" / str(pid)
    listing = requests.get(f"{BASE}/api/projects", timeout=10).json()
    ids = [p["id"] for p in listing]
    print(f"   folder gone? {not folder.exists()}  in list? {pid in ids}")
    assert not folder.exists() and pid not in ids
    print("   ✓ deleted")


def main():
    print("health:", requests.get(f"{BASE}/api/health", timeout=5).json())
    up = test_upload()
    url_pid = test_url_efficient()
    test_delete(url_pid)
    test_delete(up)
    print("\nALL V2 TESTS PASSED")


if __name__ == "__main__":
    main()
