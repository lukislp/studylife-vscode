// esbuild bundle for the extension host. "vscode" is provided by the editor at runtime and must
// stay external - bundling it produces an extension that fails to activate with a resolve error.
import { build, context } from "esbuild";

const options = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/extension.js",
  platform: "node",
  target: "node24",
  format: "cjs",
  external: ["vscode"],
  sourcemap: true,
  minify: !process.argv.includes("--watch"),
  logLevel: "info",
};

if (process.argv.includes("--watch")) {
  const ctx = await context(options);
  await ctx.watch();
} else {
  await build(options);
}
