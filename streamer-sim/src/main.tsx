import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./index.css";
import { useStore } from "./state/store";
import { applyTheme } from "./ui/themes";

applyTheme(useStore.getState().settings.theme);
useStore.persist.onFinishHydration(() => {
  applyTheme(useStore.getState().settings.theme);
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
