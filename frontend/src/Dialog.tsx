import { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from "react";

/* In-app confirm/prompt dialogs — a smooth, on-brand replacement for the browser's
   native confirm()/prompt() (which break the app's look and feel). Mirrors the
   useToast provider: wrap the app once, then call useConfirm()/usePrompt() anywhere.
   Both return a Promise that resolves when the user acts. */

type ConfirmOpts = { title: string; body?: string; confirmLabel?: string; cancelLabel?: string; danger?: boolean };
type PromptOpts = { title: string; body?: string; placeholder?: string; defaultValue?: string; confirmLabel?: string };

type Pending =
  | { kind: "confirm"; opts: Required<Omit<ConfirmOpts, "body">> & { body?: string }; resolve: (v: boolean) => void }
  | { kind: "prompt"; opts: Required<Omit<PromptOpts, "body" | "defaultValue">> & { body?: string; defaultValue: string }; resolve: (v: string | null) => void };

const DialogCtx = createContext<{
  confirm: (o: ConfirmOpts | string) => Promise<boolean>;
  prompt: (o: PromptOpts | string) => Promise<string | null>;
}>({ confirm: async () => false, prompt: async () => null });

export const useConfirm = () => useContext(DialogCtx).confirm;
export const usePrompt = () => useContext(DialogCtx).prompt;

export function DialogProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const confirm = useCallback((o: ConfirmOpts | string) => {
    const opts = typeof o === "string" ? { title: o } : o;
    return new Promise<boolean>((resolve) => {
      setPending({
        kind: "confirm",
        opts: { title: opts.title, body: opts.body, confirmLabel: opts.confirmLabel ?? "Confirm", cancelLabel: opts.cancelLabel ?? "Cancel", danger: opts.danger ?? false },
        resolve,
      });
    });
  }, []);

  const prompt = useCallback((o: PromptOpts | string) => {
    const opts = typeof o === "string" ? { title: o } : o;
    setValue(opts.defaultValue ?? "");
    return new Promise<string | null>((resolve) => {
      setPending({
        kind: "prompt",
        opts: { title: opts.title, body: opts.body, placeholder: opts.placeholder ?? "", defaultValue: opts.defaultValue ?? "", confirmLabel: opts.confirmLabel ?? "OK" },
        resolve,
      });
    });
  }, []);

  // Focus the input (prompt) or the confirm button once the dialog mounts.
  useEffect(() => {
    if (pending?.kind === "prompt") inputRef.current?.focus();
  }, [pending]);

  const close = (result: boolean | string | null) => {
    if (!pending) return;
    if (pending.kind === "confirm") pending.resolve(result as boolean);
    else pending.resolve(result as string | null);
    setPending(null);
  };
  const onCancel = () => close(pending?.kind === "prompt" ? null : false);
  const onAccept = () => {
    if (!pending) return;
    if (pending.kind === "prompt") {
      const v = value.trim();
      close(v ? v : null);
    } else close(true);
  };

  return (
    <DialogCtx.Provider value={{ confirm, prompt }}>
      {children}
      {pending && (
        <div className="modal-back" onClick={onCancel}>
          <div className="modal confirm" onClick={(e) => e.stopPropagation()}
               onKeyDown={(e) => { if (e.key === "Escape") onCancel(); else if (e.key === "Enter" && pending.kind === "prompt") onAccept(); }}>
            <h3>{pending.opts.title}</h3>
            {pending.opts.body && <p className="muted" style={{ marginTop: 0, fontSize: 13.5, lineHeight: 1.5 }}>{pending.opts.body}</p>}
            {pending.kind === "prompt" && (
              <input ref={inputRef} value={value} placeholder={pending.opts.placeholder}
                     onChange={(e) => setValue(e.target.value)} style={{ width: "100%" }} />
            )}
            <div className="modal-actions">
              <button onClick={onCancel}>{pending.kind === "confirm" ? pending.opts.cancelLabel : "Cancel"}</button>
              <button className={"primary" + (pending.kind === "confirm" && pending.opts.danger ? " danger-solid" : "")}
                      autoFocus={pending.kind === "confirm"} onClick={onAccept}>
                {pending.opts.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </DialogCtx.Provider>
  );
}
