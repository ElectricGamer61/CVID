"""Unit tests for the Autopilot autonomy policy (pure decision logic, no DB/LLM/server).

Run from the backend/ directory:
    .venv/Scripts/python.exe -m unittest tests.test_autopilot_autonomy -v
"""
import unittest

from app import autopilot, cartridge


class AutonomyPolicy(unittest.TestCase):
    def setUp(self):
        self._orig = cartridge.autonomy

    def tearDown(self):
        cartridge.autonomy = self._orig

    def _set_autonomy(self, level: str):
        cartridge.autonomy = lambda name: level

    def test_off_brand_is_not_enabled(self):
        self._set_autonomy("off")
        self.assertFalse(autopilot.is_enabled("AnyBrand"),
                         "autonomy 'off' must disable the orchestrator for the brand")

    def test_active_levels_are_enabled(self):
        for level in ("supervised", "semi", "hands_off"):
            self._set_autonomy(level)
            self.assertTrue(autopilot.is_enabled("AnyBrand"), f"{level} should be enabled")

    def test_gates_for_by_level(self):
        self._set_autonomy("off")
        self.assertEqual(autopilot.gates_for("B"), set())
        self._set_autonomy("supervised")
        self.assertEqual(autopilot.gates_for("B"), {"scripted", "ready", "scheduled"})
        self._set_autonomy("semi")
        self.assertEqual(autopilot.gates_for("B"), {"scheduled"})
        self._set_autonomy("hands_off")
        self.assertEqual(autopilot.gates_for("B"), set())

    def test_off_empty_gates_would_not_stop_advance_without_the_guard(self):
        # Regression guard for the original bug: 'off' has an EMPTY gate set, which by
        # itself removes every pause point rather than stopping the ticket. So the only
        # thing preventing an off-brand ticket from running fully unattended is the
        # explicit is_enabled() check — assert both facts hold together.
        self._set_autonomy("off")
        self.assertEqual(autopilot.gates_for("B"), set())        # no natural pause points
        self.assertFalse(autopilot.is_enabled("B"))              # ...so the guard must catch it


class PlanNext(unittest.TestCase):
    def test_ordered_hops(self):
        self.assertEqual(autopilot.plan_next("outlier"), "scripted")
        self.assertEqual(autopilot.plan_next("sourced"), "assembled")
        self.assertEqual(autopilot.plan_next("scheduled"), "posted")

    def test_terminal_and_unknown(self):
        self.assertIsNone(autopilot.plan_next("posted"))
        self.assertIsNone(autopilot.plan_next("bogus-stage"))


if __name__ == "__main__":
    unittest.main()
