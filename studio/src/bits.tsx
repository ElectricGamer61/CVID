// Small shared pieces of UI.
import type { Toast } from "./hooks";

export function Toasts({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="toast-wrap" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={"toast" + (t.kind === "err" ? " err" : "")}>
          {t.text}
          {t.action && <button onClick={t.action.run}>{t.action.label}</button>}
        </div>
      ))}
    </div>
  );
}

export const KIND_COLOR: Record<string, string> = {
  filler: "var(--k-filler)", cutoff: "var(--k-cutoff)", repeat: "var(--k-repeat)",
  retake: "var(--k-retake)", pause: "var(--k-pause)", dead: "var(--k-dead)",
};

export function Icon({ name, size = 18 }: { name: "play" | "pause" | "undo" | "redo" | "eye" | "eyeOff" | "back" | "scissors" | "plus"; size?: number }) {
  const p = {
    play: <path d="M7 5.5v13l11-6.5z" fill="currentColor" />,
    pause: <path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor" />,
    undo: <path d="M9 7 4 12l5 5M4.5 12H15a5 5 0 0 1 0 10h-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />,
    redo: <path d="m15 7 5 5-5 5M19.5 12H9a5 5 0 0 0 0 10h3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />,
    eye: <g fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></g>,
    eyeOff: <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 3l18 18M10.6 5.1A10.8 10.8 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6C3.8 8.4 2 12 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6" /></g>,
    back: <path d="M15 5 8 12l7 7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />,
    scissors: <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12" /></g>,
    plus: <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />,
  }[name];
  return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">{p}</svg>;
}
