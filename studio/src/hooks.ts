import { useCallback, useReducer, useRef, useState } from "react";

// ---------------------------------------------------------------- undo / redo

interface Hist<T> { past: T[]; present: T; future: T[] }
type Act<T> = { t: "set"; v: T } | { t: "undo" } | { t: "redo" } | { t: "reset"; v: T };

const LIMIT = 300;

function histReducer<T>(h: Hist<T>, a: Act<T>): Hist<T> {
  switch (a.t) {
    case "set":
      return a.v === h.present ? h : { past: [...h.past, h.present].slice(-LIMIT), present: a.v, future: [] };
    case "undo":
      return h.past.length ? { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] } : h;
    case "redo":
      return h.future.length ? { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) } : h;
    case "reset":
      return { past: [], present: a.v, future: [] };
  }
}

/** Every edit is one step; undo/redo walk them. `reset` replaces history (load, conflict). */
export function useHistory<T>(initial: T) {
  const [h, dispatch] = useReducer(histReducer<T>, { past: [], present: initial, future: [] });
  return {
    value: h.present,
    canUndo: h.past.length > 0,
    canRedo: h.future.length > 0,
    set: useCallback((v: T) => dispatch({ t: "set", v }), []),
    undo: useCallback(() => dispatch({ t: "undo" }), []),
    redo: useCallback(() => dispatch({ t: "redo" }), []),
    reset: useCallback((v: T) => dispatch({ t: "reset", v }), []),
  };
}

// ---------------------------------------------------------------- toasts

export interface Toast { id: number; text: string; kind?: "err"; action?: { label: string; run: () => void } }

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const n = useRef(0);
  const push = useCallback((text: string, opts: Omit<Toast, "id" | "text"> = {}) => {
    const id = ++n.current;
    setToasts((t) => [...t.slice(-2), { id, text, ...opts }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), opts.kind === "err" ? 7000 : 3800);
  }, []);
  return { toasts, push };
}
