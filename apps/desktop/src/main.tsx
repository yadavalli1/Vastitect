import React from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { App } from "./App";
import { app, boot, set } from "./state";

// Startup must never hang silently: show what went wrong instead of "Loading…".
const showBootError = (e: unknown) => {
  const msg = e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e);
  set({ phase: "error" as never, bootError: msg });
};
window.addEventListener("error", (e) => app.getState().phase === "loading" && showBootError(e.error ?? e.message));
window.addEventListener("unhandledrejection", (e) => app.getState().phase === "loading" && showBootError(e.reason));
boot().catch(showBootError);
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
