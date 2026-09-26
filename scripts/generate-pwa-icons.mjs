/**
 * Generate Master Touch OS PWA icons from public/master-touch-app-icon.png.
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import pngToIco from "png-to-ico";

const root = process.cwd();
const sourcePath = path.join(root, "public", "master-touch-app-icon.png");
const DARK = { r: 11, g: 11, b: 12, alpha: 1 };

if (!fs.existsSync(sourcePath)) {
  throw new Error("Missing public/master-touch-app-icon.png");
}

const meta = await sharp(sourcePath).metadata();
console.log("source", sourcePath, `${meta.width}x${meta.height}`, meta.format);

async function edgeFilledSource() {
  const { data, info } = await sharp(sourcePath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const isEdgeFill = (i) => {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    return max > 220 && min > 200 && max - min < 40;
  };
  const seen = new Uint8Array(width * height);
  const stack = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const p = y * width + x;
    if (seen[p]) return;
    if (!isEdgeFill(p * 4)) return;
    seen[p] = 1;
    stack.push(p);
  };
  for (let x = 0; x < width; x += 1) {
    push(x, 0);
    push(x, height - 1);
  }
  for (let y = 0; y < height; y += 1) {
    push(0, y);
    push(width - 1, y);
  }
  while (stack.length) {
    const p = stack.pop();
    const x = p % width;
    const y = (p - x) / width;
    const i = p * 4;
    data[i] = DARK.r;
    data[i + 1] = DARK.g;
    data[i + 2] = DARK.b;
    data[i + 3] = 255;
    push(x + 1, y);
    push(x - 1, y);
    push(x, y + 1);
    push(x, y - 1);
  }
  return sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

const filled = await edgeFilledSource();

async function squareIcon(size, padRatio) {
  const inner = Math.round(size * (1 - 2 * padRatio));
  const logo = await sharp(filled)
    .resize(inner, inner, { fit: "contain", background: DARK, withoutEnlargement: false })
    .png()
    .toBuffer();
  return sharp({
    create: { width: size, height: size, channels: 4, background: DARK },
  })
    .composite([{ input: logo, gravity: "centre" }])
    .png()
    .toBuffer();
}

async function writeReplace(dest, buf) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.${process.pid}.tmp`;
  await fs.promises.writeFile(tmp, buf);
  await fs.promises.copyFile(tmp, dest);
  await fs.promises.unlink(tmp).catch(() => {});
}

const any192 = await squareIcon(192, 0.03);
const any512 = await squareIcon(512, 0.03);
const mask192 = await squareIcon(192, 0.2);
const mask512 = await squareIcon(512, 0.2);
const apple180 = await squareIcon(180, 0.03);
const fav32 = await squareIcon(32, 0.03);
const fav48 = await squareIcon(48, 0.03);

const out = {
  icon192: path.join(root, "public", "icons", "icon-192x192.png"),
  icon512: path.join(root, "public", "icons", "icon-512x512.png"),
  mask192: path.join(root, "public", "icons", "icon-maskable-192x192.png"),
  mask512: path.join(root, "public", "icons", "icon-maskable-512x512.png"),
  favicon32: path.join(root, "public", "icons", "favicon-32.png"),
  appleTouch: path.join(root, "public", "apple-touch-icon.png"),
  applePublic: path.join(root, "public", "apple-icon.png"),
  appleApp: path.join(root, "src", "app", "apple-icon.png"),
  appIcon: path.join(root, "src", "app", "icon.png"),
  faviconIco: path.join(root, "src", "app", "favicon.ico"),
};

await writeReplace(out.icon192, any192);
await writeReplace(out.icon512, any512);
await writeReplace(out.mask192, mask192);
await writeReplace(out.mask512, mask512);
await writeReplace(out.favicon32, fav32);
await writeReplace(out.appleTouch, apple180);
await writeReplace(out.applePublic, apple180);
await writeReplace(out.appleApp, apple180);
await writeReplace(out.appIcon, any192);
await writeReplace(out.faviconIco, await pngToIco([fav32, fav48]));

for (const file of Object.values(out)) {
  if (file.endsWith(".ico")) {
    console.log("wrote", path.relative(root, file), fs.statSync(file).size, "ico");
    continue;
  }
  const m = await sharp(file).metadata();
  console.log("wrote", path.relative(root, file), `${m.width}x${m.height}`, m.format, fs.statSync(file).size);
}
