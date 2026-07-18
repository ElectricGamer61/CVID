"""Unit tests for script normalization + validation (pure, no DB/LLM/server).

    .venv/Scripts/python.exe -m unittest tests.test_normalize -v
"""
import unittest

from app import normalize


class NormalizeBeats(unittest.TestCase):
    def test_fills_all_keys_and_renumbers(self):
        # Deliberately malformed: missing keys, out-of-order indices, extra junk key.
        raw = [
            {"spoken_line": "one", "order_index": 7, "junk": "x"},
            {"caption": "two only"},
            {"on_screen_text": "THREE"},
        ]
        out = normalize.normalize_beats(raw)
        self.assertEqual([b["order_index"] for b in out], [0, 1, 2])
        for b in out:
            for k in ("order_index", "spoken_line", "on_screen_text", "caption", "shot_cue", "is_proof_beat"):
                self.assertIn(k, b)
        self.assertEqual(out[0]["caption"], "one")      # caption backfills from spoken
        self.assertEqual(out[1]["spoken_line"], "two only")  # spoken backfills from caption

    def test_drops_empty_scenes(self):
        raw = [{"spoken_line": "keep"}, {"spoken_line": "   "}, {}, {"caption": "keep2"}]
        out = normalize.normalize_beats(raw)
        self.assertEqual(len(out), 2)

    def test_caps_beat_count(self):
        raw = [{"spoken_line": f"line {i}"} for i in range(100)]
        out = normalize.normalize_beats(raw)
        self.assertEqual(len(out), normalize.MAX_BEATS)

    def test_caps_field_length_and_collapses_whitespace(self):
        raw = [{"spoken_line": "a  \n\t b   c" + " x" * 1000}]
        out = normalize.normalize_beats(raw)
        self.assertLessEqual(len(out[0]["spoken_line"]), normalize.MAX_SPOKEN)
        self.assertNotIn("\n", out[0]["spoken_line"])
        self.assertTrue(out[0]["spoken_line"].startswith("a b c"))

    def test_survives_non_dict_and_none(self):
        self.assertEqual(normalize.normalize_beats(None), [])
        self.assertEqual(normalize.normalize_beats(["a string", 5, {"spoken_line": "ok"}]),
                         normalize.normalize_beats([{"spoken_line": "ok"}]))


class ValidatePlan(unittest.TestCase):
    def test_valid_plan_has_no_errors(self):
        plan = normalize.normalize_plan(beats=[{"spoken_line": "hi"}], hook="hook")
        self.assertEqual(normalize.validate_plan(plan), [])

    def test_empty_plan_flagged(self):
        plan = normalize.normalize_plan(beats=[])
        errs = normalize.validate_plan(plan)
        self.assertTrue(any("no usable scenes" in e for e in errs))


class StarterPlan(unittest.TestCase):
    def test_starter_is_valid_and_editable(self):
        plan = normalize.starter_plan("hidden sugar", "reel")
        self.assertEqual(normalize.validate_plan(plan), [])
        self.assertGreaterEqual(len(plan["beats"]), 1)
        self.assertTrue(plan["hook"])
        self.assertIn("hidden sugar", plan["beats"][0]["spoken_line"])


if __name__ == "__main__":
    unittest.main()
