import React from "react";
import { createRoot } from "react-dom/client";
import { Reshaped } from "reshaped";
import "reshaped/bundle.css";
import "reshaped/themes/slate/theme.css";
import "./styles.css";
import "./shell.css";
import "./structure.css";
import { App } from "./App";
import "./harness.css";
import "./interaction-repairs.css";

createRoot(document.getElementById("root")!).render(
  <Reshaped theme="slate" defaultColorMode="light">
    <App />
  </Reshaped>,
);
