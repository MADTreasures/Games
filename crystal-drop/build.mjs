// Bundles src/ into one self-contained HTML file (no dependencies, no network).
//   node build.mjs            -> index.html (standalone) + dist/crystal-drop.artifact.html (page fragment for hosting inside a frame)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(isAbsolute(p) ? p : join(root, p), 'utf8');

// KF_CRYSTAL=<file> / KF_CAVE=<file> swap in another renderer, KF_OUT=<file> writes only that standalone file (for experiments).
const SCRIPTS = ['src/logic.js', process.env.KF_CRYSTAL || 'src/crystal.js', process.env.KF_CAVE || 'src/cave.js', 'src/audio.js', 'src/game.js'];
const font = readFileSync(join(root, 'assets/Fredoka-latin.woff2')).toString('base64');
const fontFace = `@font-face { font-family: 'Fredoka'; font-style: normal; font-weight: 600; font-display: swap; src: url(data:font/woff2;base64,${font}) format('woff2'); }\n`;
const css = fontFace + read('src/style.css');
const body = read('src/body.html');
const js = SCRIPTS.filter((p) => existsSync(isAbsolute(p) ? p : join(root, p)))
  .map((p) => `// ---- ${p}\n${read(p)}`)
  .join('\n')
  .replace(/<\/script/gi, '<\\/script');

const icon = "data:image/svg+xml," + encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='7' fill='#0a1628'/><path d='M16 3l8 7v12l-8 7-8-7V10z' fill='#bfe8ff' stroke='#06101f' stroke-width='2' stroke-linejoin='round'/><path d='M16 3l8 7-8 4-8-4z' fill='#ffffff'/><path d='M16 14v15l8-7V10z' fill='#7fc0f0'/></svg>");

const standalone = `<!doctype html>
<html lang="de">
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

if (process.env.KF_OUT) {
  writeFileSync(process.env.KF_OUT, standalone);
  console.log(`${process.env.KF_OUT} ${(standalone.length / 1024).toFixed(1)} kB`);
  process.exit(0);
}
writeFileSync(join(root, 'index.html'), standalone);
mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist/crystal-drop.artifact.html'), fragment);
console.log(`index.html ${(standalone.length / 1024).toFixed(1)} kB · dist/crystal-drop.artifact.html ${(fragment.length / 1024).toFixed(1)} kB`);
