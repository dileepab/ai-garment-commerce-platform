/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Renders the installable app's icons.
 *
 * The platform had no app icon at all — only a favicon — so an installed
 * shortcut would have fallen back to a screenshot of the page. Icons are drawn
 * here and committed rather than generated at build time so the manifest can
 * point at stable paths.
 *
 *   node scripts/generate-app-icons.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const publicDir = path.join(__dirname, '..', 'public', 'icons');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'garmentos-icons-'));

const ACCENT = '#C4622D';
const INK = '#FFFFFF';

/**
 * `inset` keeps the mark inside the safe zone of a maskable icon, where the
 * launcher is free to crop the outer ~10% to whatever shape it likes.
 */
function iconHtml({ size, inset, radius }) {
  const markSize = Math.round(size * (1 - inset * 2));
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html, body { margin: 0; padding: 0; width: ${size}px; height: ${size}px; }
  .plate {
    width: ${size}px; height: ${size}px;
    border-radius: ${radius}px;
    background: ${ACCENT};
    display: flex; align-items: center; justify-content: center;
  }
  .mark {
    width: ${markSize}px; height: ${markSize}px;
    display: flex; align-items: center; justify-content: center;
    font-family: Georgia, 'Times New Roman', serif;
    font-size: ${Math.round(markSize * 0.62)}px;
    font-weight: 500;
    color: ${INK};
    letter-spacing: -0.04em;
    line-height: 1;
  }
</style></head>
<body><div class="plate"><div class="mark">G</div></div></body></html>`;
}

const targets = [
  // A launcher rounds these itself, so they carry their own corner radius.
  { name: 'icon-192.png', size: 192, inset: 0.16, radius: 42 },
  { name: 'icon-512.png', size: 512, inset: 0.16, radius: 112 },
  // Maskable: square edge to edge, mark pulled well inside the safe zone.
  { name: 'icon-maskable-512.png', size: 512, inset: 0.26, radius: 0 },
  // iOS applies its own mask and does not want a pre-rounded corner.
  { name: 'apple-touch-icon.png', size: 180, inset: 0.16, radius: 0 },
];

fs.mkdirSync(publicDir, { recursive: true });

for (const target of targets) {
  const htmlFile = path.join(tmpDir, `${target.name}.html`);
  const pngFile = path.join(publicDir, target.name);
  fs.writeFileSync(htmlFile, iconHtml(target));

  execFileSync(chromePath, [
    '--headless=new',
    `--screenshot=${pngFile}`,
    `--window-size=${target.size},${target.size}`,
    '--default-background-color=00000000',
    '--hide-scrollbars',
    `file://${htmlFile}`,
  ], { stdio: 'ignore' });

  console.log(`Rendered ${target.name} (${target.size}x${target.size})`);
}

console.log(`\nIcons written to ${publicDir}`);
