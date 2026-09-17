// Minimal stand-in for the "vscode" module, aliased in for tests only (see vitest.config.ts).
// Node cannot resolve a real "vscode" package - it only exists inside the extension host - so any
// file that does `import * as vscode from "vscode"` needs this to even load under vitest. Only
// the members auth.ts touches at runtime are implemented; @types/vscode still supplies the types.

export class Uri {
  private constructor(readonly value: string) {}
  static parse(value: string): Uri {
    return new Uri(value);
  }
}

export const env = {
  openExternal: async (_uri: Uri): Promise<boolean> => true,
};
