// Derives the Activity Bar's viewsContainers icon from the full-color StudyLife logo.
//
// media/studylife-icon.png is the maskable PWA icon copied from lukislp/studylife's own
// manifest.json ("purpose": "any maskable") - it is *designed* to be fully opaque, with the dark
// #0e0e0f background baked in as real pixels, because OS home-screen icon masks crop a maskable
// icon into all sorts of shapes and need that background to fill whatever safe zone remains.
// Confirmed via `file`: the source PNG has no alpha channel at all (8-bit/color RGB).
//
// VS Code's Activity Bar renders its icon as a single theme-coloured silhouette via an alpha
// mask (see the extension guidelines: icons there should be a single colour at 24x24, the shape
// coming from the image's own transparency). Handing it a fully-opaque PNG gives it nothing to
// mask against, so reusing the PWA asset as-is looks wrong there - hence this derivative, built
// only for that one slot. package.json's top-level Marketplace `icon` keeps pointing at the
// original full-colour media/studylife-icon.png; only viewsContainers.activitybar[0].icon uses
// this file.
//
// The logo's foreground (the ring and the "S") is a distinct light orange/cream against the flat
// dark background, so the background can be recovered by thresholding each pixel's colour
// distance from the known background colour: close to it -> transparent, far from it -> opaque.
// The foreground is then flattened to a single colour (white) - VS Code re-tints whatever colour
// is here with the current theme's icon colour anyway, as long as the alpha is meaningful.
//
// Regenerate with `node scripts/make-activitybar-icon.mjs` after the source logo changes; the
// output is committed like any other generated asset in this repo (see the streamdeck sibling
// repo's scripts/render-icons.mjs for the same "script is the only source of truth" convention).
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SOURCE = join(ROOT, "media", "studylife-icon.png");
const OUTPUT = join(ROOT, "media", "studylife-icon-activitybar.png");

/** The maskable icon's flat background fill, sampled from the source PNG's corner pixel. */
const BACKGROUND = { r: 0x0e, g: 0x0e, b: 0x0f };

/** Below this distance from BACKGROUND, a pixel is treated as background (fully transparent).
 *  Above it, fully opaque - a hard cutoff keeps the silhouette crisp rather than smearing a soft
 *  edge across the ring/lettering's own anti-aliasing. */
const THRESHOLD = 60;

function colorDistance(r, g, b) {
  const dr = r - BACKGROUND.r;
  const dg = g - BACKGROUND.g;
  const db = b - BACKGROUND.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

async function main() {
  const image = sharp(SOURCE).ensureAlpha();
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;

  const out = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const base = i * channels;
    const r = data[base] ?? 0;
    const g = data[base + 1] ?? 0;
    const b = data[base + 2] ?? 0;
    const isForeground = colorDistance(r, g, b) > THRESHOLD;
    const o = i * 4;
    // Flattened to white - VS Code re-tints this with the active theme's icon colour regardless
    // of what colour sits here, as long as the alpha channel carries the shape.
    out[o] = 255;
    out[o + 1] = 255;
    out[o + 2] = 255;
    out[o + 3] = isForeground ? 255 : 0;
  }

  await sharp(out, { raw: { width, height, channels: 4 } })
    .png()
    .toFile(OUTPUT);

  // Sanity check: a mask with no real alpha variation would fail exactly the way the original
  // bug did, just with a different file - so this has to prove both values are actually present
  // before it can be trusted, not just assume the threshold worked.
  const { data: check } = await sharp(OUTPUT).raw().toBuffer({ resolveWithObject: true });
  const alphaValues = new Set();
  for (let i = 3; i < check.length; i += 4) alphaValues.add(check[i]);
  const hasTransparent = alphaValues.has(0);
  const hasOpaque = alphaValues.has(255);
  console.log(`wrote ${OUTPUT}`);
  console.log(
    `alpha channel distinct values: ${[...alphaValues].sort((a, b) => a - b).join(", ")}`,
  );
  if (!hasTransparent || !hasOpaque) {
    throw new Error(
      `${OUTPUT} does not have meaningful alpha variation (transparent present: ${hasTransparent}, opaque present: ${hasOpaque}) - the threshold likely needs adjusting.`,
    );
  }
  console.log("alpha channel has both fully-transparent and fully-opaque pixels - looks correct.");
}

await main();
