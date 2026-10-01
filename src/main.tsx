import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import { registerServiceWorker } from "./lib/push";
import { LOCAL_MODE } from "./lib/mode";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// The service worker exists to receive push, which the browser-only build cannot send.
if (!LOCAL_MODE) void registerServiceWorker();
