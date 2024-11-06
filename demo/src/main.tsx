import "./index.css";
// @deno-types="@types/react"
import React, { StrictMode } from "react";
// @deno-types="@types/react-dom/client"
import { createRoot } from "react-dom/client";
import App from "./App.tsx";

// TODO: No strict because it'll try to rerun useEffect twice, which will mess up the state creation..
createRoot(document.getElementById("root") as HTMLElement).render(
  <App />,
);
