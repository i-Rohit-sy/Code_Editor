import React from "react";
import ReactDOM from "react-dom";
import "./index.css";
import App from "./App";
import { CollaborationProvider } from "./contexts/CollaborationContext";

ReactDOM.render(
  <React.StrictMode>
    <CollaborationProvider>
      <App />
    </CollaborationProvider>
  </React.StrictMode>,
  document.getElementById("root")
);
