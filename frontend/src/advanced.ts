// Advanced mode — the escape hatch for everything that isn't the daily loop.
//
// The daily loop is: idea → paste the script Claude wrote → drop clips → build → export →
// post copy → log the numbers. Autopilot (the autonomous multi-brand operator), its gates,
// and the multi-brand picker are all still here and still work, they're just not decisions
// the captain should be asked to make every single day. They live behind this flag.
//
// Turn it on with `?advanced=1` (or the ⚙ button in the sidebar); `?advanced=0` turns it
// back off. The choice sticks in localStorage so the URL flag is a one-time thing.
import { useEffect, useState } from "react";

const KEY = "cv.advanced";
const EVENT = "cv:advanced";

const read = (): boolean => {
  try {
    const q = new URLSearchParams(window.location.search).get("advanced");
    if (q != null) {
      const on = q !== "0" && q !== "false";
      localStorage.setItem(KEY, on ? "1" : "0");
      return on;
    }
    return localStorage.getItem(KEY) === "1";
  } catch { return false; }
};

export const setAdvanced = (on: boolean) => {
  try { localStorage.setItem(KEY, on ? "1" : "0"); } catch { /* private mode — this session only */ }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: on }));
};

/** Is the advanced (autopilot / multi-brand) surface visible? Re-renders when it's toggled. */
export function useAdvanced(): boolean {
  const [on, setOn] = useState(read);
  useEffect(() => {
    const sync = () => setOn(read());
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);   // keep two open tabs in agreement
    return () => { window.removeEventListener(EVENT, sync); window.removeEventListener("storage", sync); };
  }, []);
  return on;
}

// The brands the app offers. Only one cartridge is actually loaded today
// (docs/autopilot/00-MAP.md: "NoCrapDiet is the only cartridge loaded... don't run their
// sprints"), so the picker only appears in advanced mode — otherwise everything is
// ACTIVE_BRAND and there's no decision to make.
export const ACTIVE_BRAND = "NoCrapDiet";
export const BRANDS = [ACTIVE_BRAND, "SemSeo", "Missedyu"];
/** Brand choices for a picker: everything in advanced mode, just the live cartridge otherwise. */
export const brandChoices = (advanced: boolean) => (advanced ? BRANDS : [ACTIVE_BRAND]);
