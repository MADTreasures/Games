// Bundles src/ into one self-contained HTML file (no dependencies, no network).
//   node build.mjs          -> index.html  (cartoon look)
//   node build.mjs real     -> real.html   (realistic look: files in src/skins/real/ replace or extend the defaults)
// A skin folder may contain crystal.js / cave.js (replace the default module), skin.js (KF.Skin: frame, logo,
// fonts, loaded before game.js), style.css and backdrop.css (appended after the default stylesheet),
// body-prefix.html (markup placed before the game's own) and caves.json (photographs embedded as #cave-art).
// KF_CRYSTAL=<file> / KF_CAVE=<file> swap in another renderer, KF_OUT=<file> writes only that file (experiments).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const abs = (p) => (isAbsolute(p) ? p : join(root, p));
const read = (p) => readFileSync(abs(p), 'utf8');
const has = (p) => existsSync(abs(p));

const skin = process.argv[2] || '';
const skinDir = skin ? `src/skins/${skin}` : '';
if (skin && !has(skinDir)) { console.error(`unknown skin "${skin}" (no ${skinDir})`); process.exit(1); }
const pick = (name) => (skinDir && has(`${skinDir}/${name}`) ? `${skinDir}/${name}` : `src/${name}`);

const SCRIPTS = [
  'src/logic.js',
  process.env.KF_CRYSTAL || pick('crystal.js'),
  process.env.KF_CAVE || pick('cave.js'),
  'src/audio.js',
  skinDir ? `${skinDir}/skin.js` : '',
  'src/game.js',
].filter((p) => p && has(p));

const FONTS = [{ family: 'Fredoka', weight: 600, file: 'assets/Fredoka-latin.woff2' }];
if (skin === 'real') FONTS.push({ family: 'Cinzel', weight: 700, file: 'assets/Cinzel-latin.woff2' });
const fontFaces = FONTS.map((f) =>
  `@font-face { font-family: '${f.family}'; font-style: normal; font-weight: ${f.weight}; font-display: swap; src: url(data:font/woff2;base64,${readFileSync(abs(f.file)).toString('base64')}) format('woff2'); }\n`).join('');

let css = fontFaces + read('src/style.css');
let body = read('src/body.html');
if (skinDir) {
  for (const name of ['style.css', 'backdrop.css']) {
    if (has(`${skinDir}/${name}`)) css += `\n/* ---- skin ${skin}: ${name} ---- */\n` + read(`${skinDir}/${name}`);
  }
  if (has(`${skinDir}/body-prefix.html`)) body = read(`${skinDir}/body-prefix.html`) + body;
  if (has(`${skinDir}/caves.json`)) {
    // room photographs: embedded so the game stays one self-contained file
    const caves = JSON.parse(read(`${skinDir}/caves.json`));
    const uri = (file) => 'data:image/webp;base64,' + readFileSync(abs(file)).toString('base64');
    const rooms = caves.rooms.map((r) => ({ key: r.key, name: r.name, focusX: r.focusX, focusY: r.focusY, src: uri(r.file) }));
    body = `<script type="application/json" id="cave-art">${JSON.stringify(rooms)}</script>\n` + body;
    if (caves.title) css += `\n:root { --title-photo: url('${uri(caves.title)}'); }\n`;
  }
}
const js = SCRIPTS.map((p) => `// ---- ${p}\n${read(p)}`).join('\n').replace(/<\/script/gi, '<\\/script');

const icon = "data:image/svg+xml," + encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='7' fill='#0a1628'/><path d='M16 3l8 7v12l-8 7-8-7V10z' fill='#bfe8ff' stroke='#06101f' stroke-width='2' stroke-linejoin='round'/><path d='M16 3l8 7-8 4-8-4z' fill='#ffffff'/><path d='M16 14v15l8-7V10z' fill='#7fc0f0'/></svg>");

const standalone = `<!doctype html>
<html lang="de"${skin ? ` data-skin="${skin}"` : ''}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<meta name="theme-color" content="#0a1628">
<meta name="mobile-web-app-capable" content="yes">
<title>Crystal Drop</title>
<link rel="icon" href="${icon}">
<style>
:root { padding: env(safe-area-inset-top, 0px) 0 env(safe-area-inset-bottom, 0px); }
${css}</style>
</head>
<body>
${body}
<script>
${js}
</script>
</body>
</html>
`;

// Fragment variant: the host supplies doctype/head/body and the safe-area padding on :root.
const fragment = `<title>Crystal Drop</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>
${css}</style>
${body}
<script>
${js}
</script>
`;

const kb = (s) => (s.length / 1024).toFixed(1) + ' kB';
if (process.env.KF_OUT) {
  writeFileSync(process.env.KF_OUT, standalone);
  console.log(`${process.env.KF_OUT} ${kb(standalone)}`);
  process.exit(0);
}
const outName = skin ? `${skin}.html` : 'index.html';
writeFileSync(join(root, outName), standalone);
mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, `dist/crystal-drop${skin ? '-' + skin : ''}.artifact.html`), fragment);
console.log(`${outName} ${kb(standalone)} · scripts: ${SCRIPTS.join(', ')}`);
