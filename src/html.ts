// Tiny, vscode-free HTML-escaping helper split out of panel.ts so it is unit-testable without a
// webview - it is the one place raw, server- or user-supplied strings (course names, mode labels)
// land in the panel's markup.

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Everything user-supplied passes through here: a course named `<b>` must not become markup. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);
}
