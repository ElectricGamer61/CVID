import { setAdvanced, useAdvanced } from "./advanced";

type View = "home" | "board" | "editor" | "queue" | "library";

const ICONS: Record<string, JSX.Element> = {
  // "Clipping" = source videos you have clipped, so a film strip rather than a house.
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
  editor: (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 20h4l10-10a2.1 2.1 0 0 0-3-3L5 17v3z" /><path d="M14.5 6.5l3 3" />
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

export function Sidebar({ view, onHome, onBoard, onEditor, onQueue, onLibrary }: { view: View; onHome: () => void; onBoard?: () => void; onEditor?: () => void; onQueue?: () => void; onLibrary?: () => void }) {
  const advanced = useAdvanced();
  const item = (key: string, label: string, active: boolean, onClick?: () => void, title?: string) => (
    <button className={"nav-item" + (active ? " on" : "")} onClick={onClick} title={title ?? label} disabled={!onClick}>
      {ICONS[key]}
      <span>{label}</span>
    </button>
  );
  return (
    <aside className="sidebar">
      <button className="brand sb-brand" onClick={onHome} disabled={!onHome} title="Clipping">
        <div className="logo">C</div>
      </button>
      {/* The stops, in the order you move through them: Clipping (the home page — long videos
          you've cut, and their reels), Create (paste a script, or get one written), Editor
          (back into the clip you had open last, or drop footage in), then Schedule & Results,
          and Downloads at the bottom. */}
      <nav className="nav">
        {item("home", "Clipping", view === "home", onHome, "Long videos you've clipped, and their reels")}
        {item("board", "Create", view === "board", onBoard, "Start a video — paste a script, or get one written")}
        {item("editor", "Editor", view === "editor", onEditor, "Edit your video — or drop footage in to start")}
        {item("queue", "Schedule & Results", view === "queue", onQueue, "Post your videos, and see how they did")}
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
