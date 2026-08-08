import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { resolveInitialDirectory } from "./features/shell/windowsNavigationClient";
import "./styles/theme.css";
import "./styles/app.css";
import "./styles/stage7.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Muller root element was not found");
}

const reactRoot = createRoot(root);

async function bootstrap() {
  const initialPath = await resolveInitialDirectory();
  reactRoot.render(
    <StrictMode>
      <App initialPath={initialPath} />
    </StrictMode>,
  );
}

void bootstrap();
