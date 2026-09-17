import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// auth.ts imports "vscode" for its ExtensionContext/Uri/env types and the two runtime calls
// runLogin() makes (Uri.parse, env.openExternal). That module only exists inside the extension
// host, so it is aliased to a tiny stand-in here purely so the file can be loaded under vitest -
// see tests/mocks/vscode.ts.
export default defineConfig({
  resolve: {
    alias: {
      vscode: fileURLToPath(new URL("./tests/mocks/vscode.ts", import.meta.url)),
    },
  },
});
