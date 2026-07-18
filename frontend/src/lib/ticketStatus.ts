// Derived ticket display-state — the single source of truth for how a Ticket is
// presented in the Create workflow. Every card, action-queue row, and workspace
// header reads its human status/label/description/next-action from here instead of
// re-deriving it from raw `stage` / `gate` / `autopilot` fields all over the UI.
//
// This module is intentionally PURE: no React, no DOM, no `api` runtime import (the
// Ticket type is imported type-only, so it is erased at build time). That keeps it
// unit-testable under `node --test` with TypeScript type-stripping, no bundler needed.
import type { Ticket } from "../api";

// The four user-facing phases the 8 DB stages collapse into (Section A of the redesign).
// Stage stays the DB source of truth; this is a display-only bucketing.
export type TicketPhase = "plan" | "produce" | "review" | "publish";

// Visual priority buckets, in dashboard-hierarchy order (see PRIORITY_ORDER below).
export type TicketPriority =
  | "issue"       // broken: render/assemble failed, retries exhausted, parked
  | "needs-user"  // blocked on the user: approval, footage, or a manual next step
  | "running"     // Autopilot is actively moving it forward
  | "ready"       // a positive "go" state: draft ready to review / assemble
  | "scheduled"   // queued to post automatically
  | "complete";   // posted / done

export interface TicketPrimaryAction {
  label: string;   // button text, e.g. "Add footage"
  target: string;  // where it goes, e.g. "workspace:footage" | "schedule" | "results"
  action: string;  // stable id the UI maps to a handler, e.g. "add-footage"
}

export interface TicketDisplayState {
  phase: TicketPhase;
  label: string;        // one short human status, e.g. "Needs footage for 2 scenes"
  description: string;  // one sentence explaining why it's here / what's needed
  priority: TicketPriority;
  primaryAction: TicketPrimaryAction;
}

// Optional context the mapper can use but a bare Ticket doesn't carry.
export interface TicketStateContext {
  autopilotRunning?: boolean; // is the global Autopilot loop currently running?
}

// Stage → phase bucket. Matches the redesign brief's mapping exactly.
const PHASE_OF_STAGE: Record<string, TicketPhase> = {
  outlier: "plan",
  scripted: "plan",
  staged: "plan",
  sourced: "produce",
  assembled: "produce",
  ready: "review",
  scheduled: "publish",
  posted: "publish",
};

export const PHASE_LABELS: Record<TicketPhase, string> = {
  plan: "Plan",
  produce: "Produce",
  review: "Review",
  publish: "Publish",
};

// Sort weight — lower sorts first. Broken things scream loudest, then work blocked on
// you, then active work, then ready-to-go, then scheduled, then done. This is the
// dashboard hierarchy from Section A ("Dashboard Hierarchy").
export const PRIORITY_ORDER: Record<TicketPriority, number> = {
  issue: 0,
  "needs-user": 1,
  running: 2,
  ready: 3,
  scheduled: 4,
  complete: 5,
};

// A ticket surfaces in the top "action queue" only when it actually wants the user
// to do something (or is broken). Running/scheduled/complete work does not.
export function isActionable(state: TicketDisplayState): boolean {
  return (
    state.priority === "issue" ||
    state.priority === "needs-user" ||
    state.priority === "ready"
  );
}

export function phaseOfStage(stage: string): TicketPhase {
  return PHASE_OF_STAGE[stage] ?? "plan";
}

// Deterministic absolute date formatting (no relative "in 2 days" so tests and the UI
// never depend on the current clock inside this pure module).
function fmtWhen(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// What a Ticket needs NEXT, derived from real scene progress (beats/clips/voiceovers)
// rather than the `stage` field, which nobody remembers to bump. Mirrors the board's
// existing makeStepOf so behavior is consistent with what shipped.
type NextStep = "script" | "footage" | "voice" | "assemble";
function nextStep(t: Ticket): NextStep {
  const beats = t.n_beats ?? 0;
  const clips = t.n_clips ?? 0;
  const vo = t.n_vo ?? 0;
  if (beats === 0) return "script";
  if (clips < beats) return "footage";
  if (!t.auto_voiceover && vo === 0) return "voice";
  return "assemble";
}

// Human copy for the running-Autopilot state, keyed by what it's working toward.
function runningLabel(step: NextStep): string {
  switch (step) {
    case "script": return "Writing script";
    case "footage": return "Matching footage";
    case "voice": return "Adding voiceover";
    case "assemble": return "Assembling draft";
  }
}

/**
 * Translate a Ticket (plus optional Autopilot context) into one display state.
 *
 * Resolution order matters — the first matching condition wins, and they are ordered
 * so the most urgent / most specific truth about the ticket surfaces:
 *   posted → parked(issue) → footage gate → approval gate → scheduled →
 *   ready-to-review → autopilot-running → manual next step.
 */
export function deriveTicketState(
  t: Ticket,
  ctx: TicketStateContext = {}
): TicketDisplayState {
  const phase = phaseOfStage(t.stage);
  const beats = t.n_beats ?? 0;
  const clips = t.n_clips ?? 0;
  const made = !!t.clip_url;

  // 1. Posted / complete.
  if (t.stage === "posted" || t.posted_at) {
    return {
      phase: "publish",
      priority: "complete",
      label: "Posted",
      description: t.posted_at
        ? `Posted ${fmtWhen(t.posted_at)}.`
        : "This video has been posted.",
      primaryAction: { label: "View results", target: "results", action: "open-results" },
    };
  }

  // 2. Parked — an error or exhausted retries. This is a real problem the user must fix.
  if (t.gate === "parked") {
    return {
      phase,
      priority: "issue",
      label: "Needs attention",
      description: t.gate_reason || "CVideo hit a problem and paused this video. Open it to fix and retry.",
      primaryAction: { label: "Open & fix", target: "workspace", action: "open-workspace" },
    };
  }

  // 3. Footage gate — blocked waiting for the user to supply clips.
  if (t.gate === "awaiting_footage") {
    const missing = Math.max(0, beats - clips);
    return {
      phase: "produce",
      priority: "needs-user",
      label: missing > 1 ? `Needs footage for ${missing} scenes` : "Needs footage",
      description: t.gate_reason || "Add the missing clips so CVideo can assemble the draft.",
      primaryAction: { label: "Add footage", target: "workspace:footage", action: "add-footage" },
    };
  }

  // 4. Approval gate — CVideo prepared something and is waiting for the user's OK.
  if (t.gate === "awaiting_approval") {
    return {
      phase,
      priority: "needs-user",
      label: "Needs your approval",
      description: t.gate_reason || "CVideo prepared this step and is waiting for your OK.",
      primaryAction: { label: "Review", target: "workspace", action: "review-approval" },
    };
  }

  // 5. Scheduled — queued to post automatically, nothing to do now.
  if (t.stage === "scheduled" || (t.scheduled_at && !t.posted_at)) {
    return {
      phase: "publish",
      priority: "scheduled",
      label: t.scheduled_at ? `Scheduled ${fmtWhen(t.scheduled_at)}` : "Scheduled",
      description: "Queued to post automatically at its scheduled time.",
      primaryAction: { label: "View queue", target: "schedule", action: "open-queue" },
    };
  }

  // 6. Draft built and sitting in Review — ready for the user's creative pass.
  if (made && (t.stage === "assembled" || t.stage === "ready")) {
    return {
      phase: "review",
      priority: "ready",
      label: "Ready to review",
      description: "The draft is built. Review it, then schedule or post.",
      primaryAction: { label: "Review & schedule", target: "workspace:review", action: "open-review" },
    };
  }

  const step = nextStep(t);

  // 7. Autopilot is on AND running AND the ticket can advance — show live activity.
  if (t.autopilot && ctx.autopilotRunning && beats > 0 && step !== "script") {
    return {
      phase,
      priority: "running",
      label: runningLabel(step),
      description: "Autopilot is moving this forward automatically.",
      primaryAction: { label: "Open workspace", target: "workspace", action: "open-workspace" },
    };
  }

  // 8. Manual next step (or Autopilot paused / not yet started).
  switch (step) {
    case "script":
      return {
        phase,
        priority: "needs-user",
        label: "Needs a script",
        description: "Write the script yourself or let CVideo generate one to get started.",
        primaryAction: { label: "Write script", target: "workspace:script", action: "write-script" },
      };
    case "footage": {
      const missing = Math.max(0, beats - clips);
      return {
        phase: "produce",
        priority: "needs-user",
        label: missing > 1 ? `Needs footage for ${missing} scenes` : "Needs footage",
        description: "Add clips for the remaining scenes so CVideo can build the draft.",
        primaryAction: { label: "Add footage", target: "workspace:footage", action: "add-footage" },
      };
    }
    case "voice":
      return {
        phase,
        priority: "needs-user",
        label: "Needs voiceover",
        description: "Record or generate the voiceover for your scenes.",
        primaryAction: { label: "Add voiceover", target: "workspace:voice", action: "add-voice" },
      };
    case "assemble":
      return {
        phase,
        priority: "ready",
        label: "Ready to assemble",
        description: "Every scene has what it needs — build the first draft.",
        primaryAction: { label: "Assemble draft", target: "workspace:assemble", action: "assemble" },
      };
  }
}

// Convenience: derive display state for a whole list and sort by dashboard hierarchy.
export function sortByPriority<T>(
  items: T[],
  getState: (item: T) => TicketDisplayState
): T[] {
  return [...items].sort(
    (a, b) => PRIORITY_ORDER[getState(a).priority] - PRIORITY_ORDER[getState(b).priority]
  );
}
