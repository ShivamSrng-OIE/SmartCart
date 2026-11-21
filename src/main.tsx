import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter";
import "@fontsource-variable/geist-mono";
import "./index.css";
import App from "./App";
import { DraftProvider } from "./draft";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DraftProvider>
      <App />
    </DraftProvider>
  </StrictMode>,
);
