import React from "react";
import { createRoot } from "react-dom/client";
import "./tailwind.css";
import { App } from "./App";

// Hide the WebView's browser menu, including Reload, across the app and portals.
document.addEventListener("contextmenu", (event) => event.preventDefault(), {
  capture: true,
});

createRoot(document.getElementById("root")!).render(<App />);
