// Create page — the redesigned Content Pipeline dashboard (Section A of the redesign).
//
// Replaces the old full-width 4-column Kanban with a vertical, one-screen desktop
// dashboard: a header with an honest count + Autopilot control, an ACTION QUEUE of the
// few things that actually need the user, a compact Plan→Produce→Review→Publish filter,
// and a dense work list. Every status/label/next-action comes from the shared
// deriveTicketState mapper — no raw stage/gate/autopilot strings as primary UI.
import { useEffect, useMemo, useState } from "react";
import { api, AutopilotState, Presets, Ticket } from "../api";
import { useToast } from "../Toast";
import { useConfirm } from "../Dialog";
import {
  deriveTicketState,
  isActionable,
  PHASE_LABELS,
  PRIORITY_ORDER,
  TicketDisplayState,
  TicketPhase,
} from "../lib/ticketStatus";
import { BRANDS, getRecent, isGated, markRecent, modeIcon, modeLabel } from "./constants";
import { NewTicketModal } from "./NewTicketModal";

const PHASE_ORDER: TicketPhase[] = ["plan", "produce", "review", "publish"];

// "Dismiss from the attention queue" memory. Keyed by ticket id → a signature of the
// state it was dismissed AT (priority:label), so a dismissed card reappears the moment
// its situation actually changes (e.g. it advances to a new blocker) — dismissing a
// wrong/stale card hides it without burying genuinely new work later.
const DISMISS_KEY = "cv.dismissedActions";
const loadDismissed = (): Record<number, string> => {
  try { return JSON.parse(localStorage.getItem(DISMISS_KEY) || "{}"); } catch { return {}; }
};
const actionSig = (st: TicketDisplayState) => `${st.priority}:${st.label}`;
const PHASE_SUB: Record<TicketPhase, string> = {
  plan: "Idea & script",
  produce: "Footage & assembly",
  review: "Draft ready",
  publish: "Scheduled & posted",
};

type Nav = { tid?: number; queue?: boolean; results?: boolean };

export function CreatePage({
  presets,
  onOpenTicket,
  onOpenQueue,
  onOpenResults,
}: {
  presets: Presets | null;
  onOpenTicket: (tid: number) => void;
  onOpenQueue: () => void;
  onOpenResults: () => void;
}) {
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [ap, setAp] = useState<AutopilotState | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [needsYouOnly, setNeedsYouOnly] = useState(false);
  const [phaseFilter, setPhaseFilter] = useState<TicketPhase | "all">("all");
  const [apBusy, setApBusy] = useState(false);
  const [brandFilter, setBrandFilter] = useState<string>("");
  // Brand autonomy map + posting mode — so the header can be HONEST: never claim
  // Autopilot is "working" on a brand whose autonomy is off, and always disclose when
  // posting is dry-run (no Upload-Post key configured).
  const [autonomyByBrand, setAutonomyByBrand] = useState<Record<string, string>>({});
  const [dryRun, setDryRun] = useState<boolean | null>(null);
  const [dismissed, setDismissed] = useState<Record<number, string>>(loadDismissed);
  const [collapsed, setCollapsed] = useState<Set<TicketPhase>>(new Set());
  const toast = useToast();
  const confirm = useConfirm();

  const togglePhase = (p: TicketPhase) =>
    setCollapsed((s) => { const n = new Set(s); n.has(p) ? n.delete(p) : n.add(p); return n; });

  const persistDismissed = (next: Record<number, string>) => {
    setDismissed(next);
    try { localStorage.setItem(DISMISS_KEY, JSON.stringify(next)); } catch { /* private mode */ }
  };
  const dismissAction = (t: Ticket, st: TicketDisplayState) => {
    persistDismissed({ ...dismissed, [t.id]: actionSig(st) });
    toast("Removed from your attention queue", "ok");
  };

  const refresh = () => api.listTickets().then(setTickets).catch(() => {});
  const refreshAp = () => api.autopilotState().then(setAp).catch(() => {});
  useEffect(() => {
    refresh(); refreshAp();
    api.listBrands().then((r) => setAutonomyByBrand(Object.fromEntries(r.brands.map((b) => [b.name, b.autonomy])))).catch(() => {});
    api.getQueue().then((q) => setDryRun(q.dry_run)).catch(() => {});
    const t = setInterval(() => { refresh(); refreshAp(); }, 4000);
    return () => clearInterval(t);
  }, []);

  const running = !!ap?.running;
  const brandOff = (brand: string) => autonomyByBrand[brand] === "off";

  // Derive every ticket's display state once; memoize keyed on the data that feeds it.
  const rows = useMemo(() => {
    const list = tickets ?? [];
    const recent = getRecent();
    const recencyRank = (t: Ticket) => { const i = recent.indexOf(t.id); return i === -1 ? Infinity : i; };
    return list
      .map((t) => ({ t, st: deriveTicketState(t, { autopilotRunning: running }) }))
      .sort(
        (a, b) =>
          PRIORITY_ORDER[a.st.priority] - PRIORITY_ORDER[b.st.priority] ||
          recencyRank(a.t) - recencyRank(b.t) ||
          b.t.id - a.t.id
      );
  }, [tickets, running]);

  const brands = useMemo(() => {
    const set = new Set<string>();
    (tickets ?? []).forEach((t) => t.brand && set.add(t.brand));
    return [...set];
  }, [tickets]);

  const phaseCounts = useMemo(() => {
    const c: Record<TicketPhase, number> = { plan: 0, produce: 0, review: 0, publish: 0 };
    rows.forEach((r) => { c[r.st.phase]++; });
    return c;
  }, [rows]);

  const gatedCount = useMemo(() => (tickets ?? []).filter(isGated).length, [tickets]);
  const inProgress = useMemo(
    () => rows.filter((r) => r.st.priority !== "complete").length,
    [rows]
  );
  // Honest Autopilot accounting: only count as "running" tickets whose brand can
  // actually advance (autonomy != off). Waiting = autopilot tickets paused at a gate.
  const runningCount = rows.filter((r) => r.st.priority === "running" && !brandOff(r.t.brand)).length;
  const waitingCount = useMemo(
    () => (tickets ?? []).filter((t) => t.autopilot && isGated(t)).length,
    [tickets]
  );
  // The single, honest board-level Autopilot line. Never says "working" when nothing
  // can actually advance (paused loop, all gated, or off-autonomy brands).
  const apSummary = !running
    ? "Autopilot paused"
    : runningCount > 0
      ? `Autopilot: working on ${runningCount} video${runningCount === 1 ? "" : "s"}`
      : waitingCount > 0
        ? `Autopilot: waiting on you for ${waitingCount}`
        : "Autopilot on · nothing to advance";

  const brandOk = (t: Ticket) => !brandFilter || t.brand === brandFilter;
  // Actionable, minus anything the user dismissed AT its current state signature.
  const actionRows = rows
    .filter((r) => isActionable(r.st) && brandOk(r.t) && dismissed[r.t.id] !== actionSig(r.st))
    .slice(0, 5);
  const listRows = rows.filter(
    (r) =>
      brandOk(r.t) &&
      (phaseFilter === "all" || r.st.phase === phaseFilter) &&
      (!needsYouOnly || isGated(r.t))
  );

  const open = (tid: number) => { markRecent(tid); onOpenTicket(tid); };
  const navigate = (nav: Nav) => {
    if (nav.queue) return onOpenQueue();
    if (nav.results) return onOpenResults();
    if (nav.tid != null) return open(nav.tid);
  };
  // Map a primaryAction target to a navigation destination.
  const runAction = (t: Ticket, st: TicketDisplayState) => {
    const target = st.primaryAction.target;
    if (target === "schedule") return navigate({ queue: true });
    if (target === "results") return navigate({ results: true });
    return navigate({ tid: t.id }); // every workspace:* target opens the workspace
  };

  const apAct = async (fn: () => Promise<unknown>, ok: string) => {
    setApBusy(true);
    try { await fn(); toast(ok, "ok"); refreshAp(); refresh(); }
    catch (e: any) { toast(`Failed: ${e?.message || e}`, "err"); }
    finally { setApBusy(false); }
  };

  const del = async (t: Ticket) => {
    if (!(await confirm({ title: "Delete this video?", body: t.angle ? `“${t.angle}” and its scenes will be removed.` : "Its scenes will be removed.", confirmLabel: "Delete", danger: true }))) return;
    try {
      await api.deleteTicket(t.id); toast("Video deleted", "ok");
      if (dismissed[t.id]) { const { [t.id]: _drop, ...rest } = dismissed; persistDismissed(rest); }
      refresh();
    }
    catch (e: any) { toast(`Delete failed: ${e?.message || e}`, "err"); }
  };

  const subtitle =
    tickets == null
      ? "Loading…"
      : `${inProgress} video${inProgress === 1 ? "" : "s"} in progress${gatedCount ? ` · ${gatedCount} need${gatedCount === 1 ? "s" : ""} you` : ""}`;

  return (
    <div className="cp-page">
      {/* ---- Header ---- */}
      <div className="cp-head">
        <div className="cp-head-titles">
          <h2>Content Pipeline</h2>
          <div className="cp-subtitle">{subtitle}</div>
        </div>
        <div className="cp-head-actions">
          <div className="cp-ap" title="Autopilot advances every video that's on autopilot by one step at a time. Brands with autonomy 'off' are never advanced.">
            <span className={"cp-ap-dot" + (running && runningCount > 0 ? " on" : running ? " idle" : "")} />
            <span className="cp-ap-label">{apSummary}</span>
            {dryRun && (
              <span className="cp-dryrun" title="No Upload-Post key configured — posts are simulated (dry-run), nothing is published.">Dry-run</span>
            )}
            {running ? (
              <button onClick={() => apAct(api.autopilotStop, "Autopilot paused")} disabled={apBusy}>Pause</button>
            ) : (
              <button className="primary" onClick={() => apAct(api.autopilotStart, "Autopilot running")} disabled={apBusy}>Start</button>
            )}
            <button onClick={() => apAct(() => api.autopilotTick(), "Advanced one step")} disabled={apBusy} title="Advance every autopilot video by one step now">Run once</button>
          </div>
          <button className="primary cp-new" onClick={() => setShowNew(true)}>+ Create video</button>
        </div>
      </div>

      {/* ---- Filters row ---- */}
      <div className="cp-filters">
        <button
          className={"cp-needs" + (needsYouOnly ? " on" : "")}
          disabled={gatedCount === 0 && !needsYouOnly}
          onClick={() => setNeedsYouOnly((v) => !v)}
          title="Show only videos paused for your input"
        >
          {needsYouOnly ? "✓ " : ""}Needs you ({gatedCount})
        </button>
        {brands.length > 1 && (
          <select className="cp-brand" value={brandFilter} onChange={(e) => setBrandFilter(e.target.value)} title="Filter by brand">
            <option value="">All brands</option>
            {brands.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        )}
      </div>

      {tickets == null ? (
        <div className="muted cp-loading">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="cp-empty">
          <div className="cp-empty-emoji">🎬</div>
          <h3>No videos yet</h3>
          <p className="muted">Turn an idea, a long video, a script, or raw footage into a post-ready short.</p>
          <button className="primary" onClick={() => setShowNew(true)}>+ Create your first video</button>
        </div>
      ) : (
        <>
          {/* ---- Action queue ---- */}
          {actionRows.length > 0 && (
            <section className="cp-queue">
              <div className="cp-section-head">
                <span className="cp-section-title">Needs your attention</span>
                <span className="cp-section-count">{actionRows.length}</span>
              </div>
              <div className="cp-queue-cards">
                {actionRows.map(({ t, st }) => (
                  <ActionCard key={t.id} t={t} st={st} onPrimary={() => runAction(t, st)} onOpen={() => open(t.id)}
                    onDismiss={() => dismissAction(t, st)} onDelete={() => del(t)} />
                ))}
              </div>
            </section>
          )}

          {/* ---- Compact pipeline overview ---- */}
          <div className="cp-phases">
            <button className={"cp-phase-tab" + (phaseFilter === "all" ? " on" : "")} onClick={() => setPhaseFilter("all")}>
              <span className="cp-phase-name">All</span>
              <span className="cp-phase-count">{rows.length}</span>
            </button>
            {PHASE_ORDER.map((p) => (
              <button
                key={p}
                className={"cp-phase-tab" + (phaseFilter === p ? " on" : "") + ` cp-ph-${p}`}
                onClick={() => setPhaseFilter((f) => (f === p ? "all" : p))}
              >
                <span className="cp-phase-name">{PHASE_LABELS[p]}</span>
                <span className="cp-phase-sub">{PHASE_SUB[p]}</span>
                <span className="cp-phase-count">{phaseCounts[p]}</span>
              </button>
            ))}
          </div>

          {/* ---- Work list ---- */}
          <div className="cp-list">
            {(() => {
              const renderRow = ({ t, st }: { t: Ticket; st: TicketDisplayState }) => (
                <WorkRow key={t.id} t={t} st={st} onPrimary={() => runAction(t, st)} onOpen={() => open(t.id)} onDelete={() => del(t)} />
              );
              if (listRows.length === 0) {
                return <div className="cp-list-empty muted">{needsYouOnly ? "Nothing is waiting on you here." : "Nothing in this phase."}</div>;
              }
              // A single phase is already scoped → flat list. "All" → grouped, collapsible
              // sections by phase so the full pipeline reads as tidy stacks, not one wall.
              if (phaseFilter !== "all") return listRows.map(renderRow);
              return PHASE_ORDER.map((ph) => {
                const group = listRows.filter((r) => r.st.phase === ph);
                if (!group.length) return null;
                const isCollapsed = collapsed.has(ph);
                return (
                  <div className="cp-group" key={ph}>
                    <button className="cp-group-head" onClick={() => togglePhase(ph)} aria-expanded={!isCollapsed}>
                      <span className="cp-group-caret">{isCollapsed ? "▸" : "▾"}</span>
                      <span className="cp-group-name">{PHASE_LABELS[ph]}</span>
                      <span className="cp-group-sub">{PHASE_SUB[ph]}</span>
                      <span className="cp-group-count">{group.length}</span>
                    </button>
                    {!isCollapsed && <div className="cp-group-rows">{group.map(renderRow)}</div>}
                  </div>
                );
              });
            })()}
          </div>
        </>
      )}

      {showNew && <NewTicketModal presets={presets} onClose={() => setShowNew(false)} onCreated={(tid) => { setShowNew(false); open(tid); }} />}
    </div>
  );
}

/* --------------------------- Action-queue card --------------------------- */
function ActionCard({ t, st, onPrimary, onOpen, onDismiss, onDelete }: {
  t: Ticket; st: TicketDisplayState; onPrimary: () => void; onOpen: () => void; onDismiss: () => void; onDelete: () => void;
}) {
  const made = !!t.clip_url;
  return (
    <div className={"cp-acard cp-pri-" + st.priority}>
      <button className="cp-acard-x" title="This doesn't need my attention — hide it from this list" onClick={onDismiss}>✕</button>
      <div className="cp-acard-thumb" onClick={onOpen} title="Open workspace">
        {made ? (
          <img src={api.ticketThumbUrl(t.id)} alt="" loading="lazy" onError={(e) => ((e.target as HTMLImageElement).style.display = "none")} />
        ) : (
          <span className="cp-acard-emoji">{modeIcon(t.capture_mode)}</span>
        )}
      </div>
      <div className="cp-acard-body">
        <div className="cp-acard-top">
          <span className={"cp-badge cp-pri-" + st.priority}>{st.label}</span>
          <span className="cp-acard-brand">{t.brand}</span>
        </div>
        <div className="cp-acard-title">{t.hook_text ? `“${t.hook_text}”` : (t.angle || "Untitled video")}</div>
        <div className="cp-acard-why">{st.description}</div>
      </div>
      <div className="cp-acard-actions">
        <button className="primary" onClick={onPrimary}>{st.primaryAction.label}</button>
        <button className="link-btn" onClick={onOpen}>Open workspace</button>
        <span className="cp-acard-spacer" />
        <button className="link-btn" onClick={onDismiss} title="Hide from this list (comes back if its status changes)">Not now</button>
        <button className="link-btn danger" onClick={onDelete} title="Delete this video permanently">Delete</button>
      </div>
    </div>
  );
}

/* ------------------------------ Work-list row ---------------------------- */
function WorkRow({ t, st, onPrimary, onOpen, onDelete }: { t: Ticket; st: TicketDisplayState; onPrimary: () => void; onOpen: () => void; onDelete: () => void }) {
  const made = !!t.clip_url;
  const running = st.priority === "running";
  return (
    <div className={"cp-row cp-pri-" + st.priority}>
      <div className="cp-row-thumb" onClick={onOpen} title="Open workspace">
        {made ? (
          <img src={api.ticketThumbUrl(t.id)} alt="" loading="lazy" onError={(e) => ((e.target as HTMLImageElement).style.display = "none")} />
        ) : (
          <span className="cp-row-emoji">{modeIcon(t.capture_mode)}</span>
        )}
      </div>
      <div className="cp-row-main" onClick={onOpen}>
        <div className="cp-row-title">{t.hook_text ? `“${t.hook_text}”` : (t.angle || "Untitled video")}</div>
        <div className="cp-row-meta">
          <span className="cp-row-brand">{t.brand}</span>
          <span className="cp-dotsep">·</span>
          <span className="cp-row-mode">{modeLabel(t.capture_mode)}</span>
        </div>
      </div>
      <div className="cp-row-status">
        <span className={"cp-status-label cp-pri-" + st.priority}>
          {running && <span className="cp-live-dot" />}
          {st.label}
        </span>
        <span className="cp-phase-chip">{PHASE_LABELS[st.phase]}</span>
      </div>
      <div className="cp-row-actions" onClick={(e) => e.stopPropagation()}>
        <button className="cp-row-primary" onClick={onPrimary}>{st.primaryAction.label}</button>
        <details className="cp-row-more">
          <summary title="Details">⋯</summary>
          <div className="cp-row-detail">
            <div><b>stage</b> {t.stage}</div>
            {t.gate && <div><b>gate</b> {t.gate}{t.gate_reason ? ` — ${t.gate_reason}` : ""}</div>}
            <div><b>autopilot</b> {t.autopilot ? "on" : "off"}{t.auto_voiceover ? " · AI voice" : ""}</div>
            <div><b>scenes</b> {t.n_clips ?? 0}/{t.n_beats ?? 0} clips · {t.auto_voiceover ? "AI voice" : `${t.n_vo ?? 0}/${t.n_beats ?? 0} vo`}</div>
            <button className="link-btn danger" onClick={onDelete}>Delete video</button>
          </div>
        </details>
      </div>
    </div>
  );
}
