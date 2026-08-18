"""Fast regression checks for the local-first long-form fallback contract."""
from __future__ import annotations
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from app.pipeline import brain, ingest

failed = []
def check(name, ok):
    print(("  ok   " if ok else "  FAIL ") + name)
    if not ok: failed.append(name)

def test_order():
    check("ollama falls back through local providers", brain.fallback_order("ollama") == ["ollama", "heuristic"])
    check("heuristic never invokes a provider", brain.fallback_order("heuristic") == ["heuristic"])

def test_provider_failure_reaches_heuristic():
    words = [{"start": i * 10.0, "end": i * 10.0 + 1, "word": "word."} for i in range(8)]
    original = brain.get_backend
    calls = []
    class Broken:
        def score(self, *_):
            raise TimeoutError("provider timed out")
    def fake(name):
        calls.append(name)
        return brain.HeuristicScorer() if name == "heuristic" else Broken()
    brain.get_backend = fake
    try:
        # The test uses the actual heuristic as the final supported strategy.
        got = brain.find_moments(words, "ollama", n=1)
    finally:
        brain.get_backend = original
    check("tries the configured brain first", calls[0] == "ollama")
    check("ends in a usable heuristic clip", calls[-1] == "heuristic" and bool(got))

def test_source_is_not_discarded_on_retry():
    import tempfile
    with tempfile.TemporaryDirectory() as d:
        src, out = Path(d) / "upload.mov", Path(d) / "project" / "source.mp4"
        src.write_bytes(b"video bytes")
        out.parent.mkdir()
        ingest.save_upload(src, out)
        check("source survives fallback/retry state", out.exists() and out.read_bytes() == b"video bytes")

if __name__ == "__main__":
    test_order(); test_provider_failure_reaches_heuristic(); test_source_is_not_discarded_on_retry()
    print("\n" + ("ALL PASSED" if not failed else f"{len(failed)} FAILED: {failed}"))
    raise SystemExit(bool(failed))
