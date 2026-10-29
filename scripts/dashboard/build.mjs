/**
 * build.mjs
 * ---------------------------------------------------------------------
 * Builds the dashboard for deployment (run by deploy-pages.yml):
 *
 *   node scripts/dashboard/build.mjs <source dir> <output dir>
 *
 * The source runs as-is in a browser (ES modules, no build needed to
 * develop). For the live site this:
 *   - bundles each page's entry module into one minified file, with code
 *     shared between pages split into common chunks the page preloads,
 *     so a page loads a couple of files instead of ~18 in a chain;
 *   - minifies the stylesheet;
 *   - puts a content hash in every built file's name (main-3F2KQ.js), so
 *     a deploy can never mix old and new files;
 *   - writes the service worker (sw.js) with this build's file list and
 *     turns on its registration in each page.
 * Needs esbuild (the workflow installs it).
 * ---------------------------------------------------------------------
 */

import * as esbuild from 'esbuild';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const [source, out] = process.argv.slice(2);
if (!source || !out) {
  console.error('Usage: node scripts/dashboard/build.mjs <source dir> <output dir>');
  process.exit(1);
}

// Each page and the module it starts from.
const PAGES = {
  'index.html': 'main.js',
  'calendar.html': 'calendar.js',
  'summary.html': 'summary.js',
  'trips.html': 'trips.js',
  'chat.html': 'chat.js',
  'upload.html': 'upload.js',
  'login.html': 'login.js',
};
// The exact CDN library versions the pages load, cached by the service worker too.
const CDN_LIBRARIES = new Set();

// ---- Start from a copy of everything except the source modules and stylesheet ----
fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(source, out, {
  recursive: true,
  filter: (file) => {
    const rel = path.relative(source, file);
    if (rel === 'sw.js' || rel === path.join('css', 'styles.css')) return false;
    if (path.dirname(rel) === 'js' && rel.endsWith('.js')) return path.basename(rel) === 'config.js'; // the modules are bundled below
    return true;
  },
});

// ---- JavaScript: one bundle per page, shared code split out ----
const scripts = await esbuild.build({
  entryPoints: Object.values(PAGES).map((entry) => path.join(source, 'js', entry)),
  bundle: true,
  splitting: true,
  format: 'esm',
  minify: true,
  target: 'es2020',
  legalComments: 'none',
  outdir: path.join(out, 'js'),
  entryNames: '[name]-[hash]',
  chunkNames: 'chunks/[name]-[hash]',
  metafile: true,
  logLevel: 'warning',
});

// ---- CSS: minified, hashed ----
const styles = await esbuild.build({
  entryPoints: [path.join(source, 'css', 'styles.css')],
  minify: true,
  outdir: path.join(out, 'css'),
  entryNames: '[name]-[hash]',
  metafile: true,
  logLevel: 'warning',
});

const rel = (file) => path.relative(out, file).split(path.sep).join('/');
const outputs = Object.entries(scripts.metafile.outputs);
const stylesheet = rel(Object.keys(styles.metafile.outputs).find((file) => file.endsWith('.css')));

/** The built file for an entry module, and every chunk it pulls in (to preload). */
function builtEntry(entry) {
  const [file, meta] = outputs.find(([, m]) => m.entryPoint && path.basename(m.entryPoint) === entry);
  const chunks = new Set();
  const walk = (output) => scripts.metafile.outputs[output].imports
    .filter((i) => i.kind === 'import-statement' && !chunks.has(i.path))
    .forEach((i) => { chunks.add(i.path); walk(i.path); });
  walk(file);
  return { file: rel(file), chunks: [...chunks].map(rel), meta };
}

// ---- Build number, shown at the foot of the account menu: "Build 187 · 5e902ea · 22 Oct 2026" ----
// The workflow run number counts up with every deploy; the commit says which
// code it was. Run by hand, the commit comes from git and there's no number.
const commit = (process.env.GITHUB_SHA || (() => {
  try { return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim(); } catch { return ''; }
})()).slice(0, 7);
const runNumber = process.env.GITHUB_RUN_NUMBER;
const builtOn = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/London' });
const buildLabel = [runNumber ? `Build ${runNumber}` : 'Build', commit, builtOn].filter(Boolean).join(' · ');

// ---- Pages: point at the built files, preload chunks, register the service worker ----
const SW_REGISTER = `<script>if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function () {});</script>`;
for (const [page, entry] of Object.entries(PAGES)) {
  const file = path.join(out, page);
  let html = fs.readFileSync(file, 'utf8');
  const built = builtEntry(entry);
  const preloads = built.chunks.map((chunk) => `<link rel="modulepreload" href="${chunk}">`).join('\n');
  const before = html;
  html = html.replace(`<script type="module" src="js/${entry}"></script>`,
    `${preloads ? `${preloads}\n` : ''}<script type="module" src="${built.file}"></script>`);
  if (html === before) throw new Error(`${page}: no <script type="module" src="js/${entry}"> to replace`);
  html = html.replace('href="css/styles.css"', `href="${stylesheet}"`);
  html = html.replace(/<!-- sw-register[^>]*-->/, SW_REGISTER);
  html = html.replace('data-build>Local build<', `data-build title="Commit ${commit}">${buildLabel}<`);
  for (const match of html.matchAll(/src="(https:\/\/cdn\.jsdelivr\.net\/npm\/[^"]+@\d[^"]*)"/g)) CDN_LIBRARIES.add(match[1]);
  fs.writeFileSync(file, html);
}

// ---- Service worker: this build's files, and a version that changes with them ----
const listFiles = (dir) => fs.readdirSync(dir, { withFileTypes: true })
  .flatMap((d) => (d.isDirectory() ? listFiles(path.join(dir, d.name)) : [path.join(dir, d.name)]));
const appFiles = listFiles(out).map(rel).filter((f) => !f.endsWith('.map')).sort();
const version = createHash('sha256')
  .update(appFiles.map((f) => `${f}:${createHash('sha256').update(fs.readFileSync(path.join(out, f))).digest('hex')}`).join('\n'))
  .digest('hex')
  .slice(0, 12);
const precache = ['./', ...appFiles, ...[...CDN_LIBRARIES].sort()];
const worker = fs.readFileSync(path.join(source, 'sw.js'), 'utf8')
  .replace("'__VERSION__'", JSON.stringify(version))
  .replace('[/* __PRECACHE__ */]', JSON.stringify(precache, null, 2));
if (!worker.includes(version)) throw new Error('sw.js: version placeholder not found');
fs.writeFileSync(path.join(out, 'sw.js'), worker);

const size = (files) => files.reduce((sum, f) => sum + fs.statSync(path.join(out, f)).size, 0);
const js = appFiles.filter((f) => f.endsWith('.js') && f !== 'js/config.js');
console.log(`${buildLabel}. Built ${Object.keys(PAGES).length} pages:${js.length} script files (${Math.round(size(js) / 1024)} KB), `
  + `${stylesheet} (${Math.round(size([stylesheet]) / 1024)} KB), sw.js v${version} caching ${precache.length} files.`);
