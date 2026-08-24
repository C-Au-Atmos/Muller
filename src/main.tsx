import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import {
  diagnosticInfo,
  initializeDiagnostics,
  installGlobalDiagnosticsHandlers,
  reportDiagnosticError,
} from "./diagnostics/diagnosticsClient";
import { resolveInitialDirectory } from "./features/shell/windowsNavigationClient";
import "./styles/theme.css";
import "./styles/app.css";
import "./styles/stage7.css";

const root = document.getElementById("root");

installGlobalDiagnosticsHandlers();
void initializeDiagnostics();

if (!root) {
  reportDiagnosticError("frontend.root_missing", new Error("root missing"));
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
  diagnosticInfo("frontend.rendered");
}

void bootstrap().catch((error: unknown) => {
  reportDiagnosticError("frontend.bootstrap_failed", error);
});
