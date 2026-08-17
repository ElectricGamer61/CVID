type View = "home" | "board" | "editor" | "library";

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
  library: (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="7" height="7" rx="1.5" /><rect x="14" y="4" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="6" rx="1.5" /><rect x="14" y="14" width="7" height="6" rx="1.5" />
    </svg>
  ),
};

export function Sidebar({ view, onHome, onBoard, onEditor, onLibrary }: { view: View; onHome: () => void; onBoard?: () => void; onEditor?: () => void; onLibrary?: () => void }) {
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
      {/* Four stops, in the order you move through them: Clipping (the home page — long videos
          you've cut, and their reels), Create (paste a script, or get one written), Editor
          (back into the clip you had open last, or drop footage in), and Downloads at the
          bottom, where the finished exports land. Nothing else: this is a video editor. */}
      <nav className="nav">
        {item("home", "Clipping", view === "home", onHome, "Long videos you've clipped, and their reels")}
        {item("board", "Create", view === "board", onBoard, "Start a video — paste a script, or get one written")}
        {item("editor", "Editor", view === "editor", onEditor, "Edit your video — or drop footage in to start")}
        {item("library", "Downloads", view === "library", onLibrary, "Every video you've exported")}
      </nav>
    </aside>
  );
}
