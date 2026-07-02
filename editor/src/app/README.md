# app

Application shell and composition root.

Put router setup, global providers, startup wiring, and DEV-only debug
utilities here.

Current modules:

- `debug/*`: DEV-only `window.__DEBUG__` console helpers (tree-shaken in
  production).
