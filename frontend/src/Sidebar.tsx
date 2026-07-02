type View = "home" | "board" | "intake" | "queue" | "insights" | "library" | "autopilot";

const ICONS: Record<string, JSX.Element> = {
  home: (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 11l9-8 9 8" /><path d="M5 10v10h14V10" />
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
  autopilot: (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="7" width="14" height="12" rx="3" /><path d="M12 7V3" /><circle cx="12" cy="3" r="1" />
      <circle cx="9.5" cy="13" r="1.2" /><circle cx="14.5" cy="13" r="1.2" /><path d="M9 17h6" />
    </svg>
  ),
  settings: (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 6 19.4l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 4.6 14H4.5a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 6 7.3l-.1-.1A2 2 0 1 1 8.7 4.4l.1.1A1.6 1.6 0 0 0 11 4.6V4.5a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8 1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" />
    </svg>
  ),
};

export function Sidebar({ view, onHome, onBoard, onIntake, onQueue, onInsights, onLibrary, onAutopilot }: { view: View; onHome: () => void; onBoard?: () => void; onIntake?: () => void; onQueue?: () => void; onInsights?: () => void; onLibrary?: () => void; onAutopilot?: () => void }) {
  const item = (key: string, label: string, active: boolean, onClick?: () => void) => (
    <button className={"nav-item" + (active ? " on" : "")} onClick={onClick} title={label} disabled={!onClick}>
      {ICONS[key]}
      <span>{label}</span>
    </button>
  );
  return (
    <aside className="sidebar">
      <button className="brand sb-brand" onClick={onHome}>
        <div className="logo">C</div>
      </button>
      <nav className="nav">
        {item("home", "Home", view === "home", onHome)}
        {item("intake", "Ideas", view === "intake", onIntake)}
        {item("board", "Create videos", view === "board", onBoard)}
        {item("autopilot", "Autopilot", view === "autopilot", onAutopilot)}
        {item("queue", "Schedule", view === "queue", onQueue)}
        {item("insights", "Results", view === "insights", onInsights)}
        {item("library", "Downloads", view === "library", onLibrary)}
      </nav>
      <div className="nav-bottom">{item("settings", "Settings", false)}</div>
    </aside>
  );
}
