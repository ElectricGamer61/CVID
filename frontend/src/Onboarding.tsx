// First-run welcome: what Cvideo does and the three steps to a finished clip, in plain words.
// Shown once on first launch (remembered in localStorage) and any time from Help in the sidebar.
import { useEffect } from "react";

export const ONBOARDING_KEY = "cv.onboarded.v1";

/** First launch = nothing recorded yet. Storage that throws (private mode, blocked site data)
 *  counts as "already seen" so the welcome can never get stuck on screen. */
export function shouldShowOnboarding(storage: Pick<Storage, "getItem"> | null | undefined): boolean {
  try {
    return !!storage && storage.getItem(ONBOARDING_KEY) !== "1";
  } catch {
    return false;
  }
}

export function markOnboarded(storage: Pick<Storage, "setItem"> | null | undefined): void {
  try {
    storage?.setItem(ONBOARDING_KEY, "1");
  } catch {
    /* nothing to remember in; the welcome simply shows again next time */
  }
}

export const ONBOARDING_STEPS: { title: string; body: string }[] = [
  {
    title: "Paste a link",
    body: "On Clipping, paste a YouTube link or upload a video, then press Generate clips.",
  },
  {
    title: "Give it a minute",
    body: "Cvideo writes down every word and picks the best moments, each scored out of 100. Longer on a laptop without a graphics card.",
  },
  {
    title: "Edit, export, post",
    body: "Open any clip to change the captions or the crop, then press Export and Download.",
  },
];

export function Onboarding({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal onboarding" role="dialog" aria-modal="true" aria-labelledby="onb-title"
        onClick={(e) => e.stopPropagation()}>
        <div className="onb-logo">C</div>
        <h3 id="onb-title">Welcome to Cvideo</h3>
        <p className="onb-lead">Turn one long video into short clips you can post.</p>
        <ol className="onb-steps">
          {ONBOARDING_STEPS.map((s, i) => (
            <li key={s.title}>
              <span className="onb-num">{i + 1}</span>
              <span><b>{s.title}</b><span className="muted">{s.body}</span></span>
            </li>
          ))}
        </ol>
        <p className="onb-note muted">Runs on this computer. Videos stay here unless you turn on a cloud service.</p>
        <div className="modal-actions">
          <button className="primary" autoFocus onClick={onClose}>Start clipping</button>
        </div>
      </div>
    </div>
  );
}
