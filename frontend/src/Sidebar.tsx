import { setAdvanced, useAdvanced } from "./advanced";

type View = "home" | "board" | "intake" | "queue" | "insights" | "library";

const ICONS: Record<string, JSX.Element> = {
  // "Projects" = source videos you've clipped, so a film strip rather than a house.
  home: (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2.5" y="5" width="19" height="14" rx="2" /><path d="M7 5v14" /><path d="M17 5v14" />
      <path d="M2.5 9.5h4.5" /><path d="M2.5 14.5h4.5" /><path d="M17 9.5h4.5" /><path d="M17 14.5h4.5" />
    </svg>
  ),
  board: (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="5" height="18" rx="1.5" /><rect x="10" y="3" width="5" height="12" rx="1.5" />
      <rect x="17" y="3" width="4" height="8" rx="1.5" />
    </svg>
  ),
  intake: (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v12" /><path d="M7 10l5 5 5-5" /><path d="M4 21h16" />
    </svg>
  ),
  insights: (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19V5" /><path d="M4 19h16" /><rect x="7" y="11" width="3" height="5" /><rect x="13" y="7" width="3" height="9" />
    </svg>
  ),
  queue: (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18" /><path d="M8 2v4" /><path d="M16 2v4" /><path d="M12 13l2 2 4-4" transform="translate(-3 0)" />
    </svg>
  ),
  library: (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="7" height="7" rx="1.5" /><rect x="14" y="4" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="6" rx="1.5" /><rect x="14" y="14" width="7" height="6" rx="1.5" />
    </svg>
  ),
  settings: (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 6 19.4l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 4.6 14H4.5a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 6 7.3l-.1-.1A2 2 0 1 1 8.7 4.4l.1.1A1.6 1.6 0 0 0 11 4.6V4.5a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8 1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" />
    </svg>
  ),
};

export function Sidebar({ view, onHome, onBoard, onIntake, onQueue, onInsights, onLibrary }: { view: View; onHome: () => void; onBoard?: () => void; onIntake?: () => void; onQueue?: () => void; onInsights?: () => void; onLibrary?: () => void }) {
  const advanced = useAdvanced();
  const item = (key: string, label: string, active: boolean, onClick?: () => void, title?: string) => (
    <button className={"nav-item" + (active ? " on" : "")} onClick={onClick} title={title ?? label} disabled={!onClick}>
      {ICONS[key]}
      <span>{label}</span>
    </button>
  );
  return (
    <aside className="sidebar">
      <button className="brand sb-brand" onClick={onBoard ?? onHome} title="Create videos">
        <div className="logo">C</div>
      </button>
      {/* Ordered by the daily loop: make a video first, then the things around it.
          "Projects" is the long-form clipper + its library — same screen as before,
          renamed so the label matches its own heading and breadcrumb. */}
      <nav className="nav">
        {item("board", "Create videos", view === "board", onBoard)}
        {item("intake", "Ideas", view === "intake", onIntake)}
        {item("home", "Projects", view === "home", onHome, "Long videos you've clipped, and their reels")}
        {item("queue", "Schedule", view === "queue", onQueue)}
        {item("insights", "Results", view === "insights", onInsights)}
        {item("library", "Downloads", view === "library", onLibrary)}
      </nav>
      {/* Advanced mode: autopilot, gates and the multi-brand picker. Off by default so the
          daily path stays one path; this is how you get them back. */}
      <div className="nav-bottom">
        {item("settings", advanced ? "Advanced on" : "Advanced", advanced, () => setAdvanced(!advanced),
          advanced ? "Hide autopilot, gates & the brand picker" : "Show autopilot, gates & the brand picker")}
      </div>
    </aside>
  );
}
