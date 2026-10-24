import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import { registerServiceWorker } from "./lib/push";
import { LOCAL_MODE } from "./lib/mode";
import { AuthGate } from "./components/AuthGate";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {LOCAL_MODE ? <App /> : <AuthGate><App /></AuthGate>}
  </StrictMode>,
);

// The service worker exists to receive push, which the browser-only build cannot send.
if (!LOCAL_MODE) void registerServiceWorker();
