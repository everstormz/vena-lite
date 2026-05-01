import React from "react";
import ReactDOM from "react-dom/client";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import App from "./App";

function mount() {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <FluentProvider theme={webLightTheme}>
        <App />
      </FluentProvider>
    </React.StrictMode>,
  );
}

// Office.js loads via a classic <script> tag in index.html. In Vite dev mode the
// module loader can race ahead and execute main.tsx before office.js has set up
// the global. Poll briefly, then mount — falling back to mounting without Office
// after 5s so the taskpane is never silently blank.
declare const Office: { onReady: (cb: () => void) => void } | undefined;

let attempts = 0;
const tick = window.setInterval(() => {
  attempts += 1;
  if (typeof Office !== "undefined" && Office.onReady) {
    window.clearInterval(tick);
    Office.onReady(() => mount());
  } else if (attempts > 100) {
    window.clearInterval(tick);
    // eslint-disable-next-line no-console
    console.warn("Office.js never loaded; mounting React without Office context");
    mount();
  }
}, 50);
