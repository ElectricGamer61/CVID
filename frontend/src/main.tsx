import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ToastProvider } from "./Toast";
import { DialogProvider } from "./Dialog";
import { installApiTokenFetch } from "./apiToken";
import "./index.css";

installApiTokenFetch(); // attach the opt-in API token to /api calls (no-op when unset)

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ToastProvider>
      <DialogProvider>
        <App />
      </DialogProvider>
    </ToastProvider>
  </React.StrictMode>
);
