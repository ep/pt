/* qa-kit-coverage.mjs: the rules every page on pt meets, run as a test across the whole repo.
   GitHub Actions runs it on every push with the other suites. A contributor's chat runs it on one file.

   For every page in the repo it checks five rules:
     noindex    <meta name="robots" content="noindex, nofollow">
     requests   it loads and calls only pt itself (ep.github.io/pt/), the pt worker, Google Fonts and
                any analytics it carries. Links people click can go anywhere; this is about what the
                page fetches on its own. Read from the markup, from what its scripts add on a normal
                visit, and from every fetch, XHR, beacon, WebSocket and EventSource they try.
     kit        the feedback kit's line: <script src="/pt/assets/kit/feedback.js" defer></script>
                (or the same file by its full address)
     id         EPKit.tool.id, set by the page itself: lowercase letters, numbers and hyphens, at most
                40, written as a plain string in the hook, and used by no other page
     restore    the board can rebuild every screen: sections() lists each screen once, and each one
                opens through the real kit and replay files in a frame like the board's (no storage,
                no cookies, no network, no address to go on). restore() returns true, screen() then
                names that screen, nothing errors, each screen draws something of its own, and they
                also open one after another in a single frame.
   It also records which pages carry analytics (Clarity, Google Analytics, Hotjar and the like) and
   lists them at the end. That's a record, never a failure.

   Two lists below change what a failure means.
     EXEMPT   pages a rule doesn't apply to, or extra hosts a page may reach, each with its reason.
              Changing it is a team decision.
     NOT_YET  pages that were live before a rule and come up to it one at a time. A rule on
              this list prints TODO instead of failing. The list only shrinks: an entry that now
              passes fails until it's removed, and NOT_YET_SIZE must equal the number of rules
              listed, so adding one means raising that number in the same diff. Run with --shrink
              and the test takes off every entry that now passes (and any for a page that's gone)
              and rewrites this file; it never adds one.

   Run every page (from the repo root, after: npm install jsdom jsqr):
     node _backend/tests/qa-kit-coverage.mjs
   Run one page in the repo:
     node _backend/tests/qa-kit-coverage.mjs field-tools/my-tool/index.html
   Run a file that isn't in the repo yet, as if it were at its repo path:
     node _backend/tests/qa-kit-coverage.mjs /path/to/draft.html --as field-tools/my-tool/index.html
   Before packaging a change, in a fresh clone with the package's files in place:
     node _backend/tests/qa-kit-coverage.mjs --shrink

   What it doesn't check: the tool's own behaviour (its harness does that), whether a live tool keeps
   feedback mode in the links it makes, what a rebuilt screen shows beyond being its own, names or
   client details in the words, and requests a script makes only after someone clicks. */
import { JSDOM, VirtualConsole } from 'jsdom';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '../..');
const SITE = 'https://ep.github.io/pt/';
const WORKER = 'pt.armand-khambatta.workers.dev';
const OK_HOSTS = [WORKER, 'fonts.googleapis.com', 'fonts.gstatic.com'];
const RULES = ['noindex', 'requests', 'kit', 'id', 'restore'];
const SELF = fileURLToPath(import.meta.url);
const KIT = fs.readFileSync(path.join(ROOT, 'assets/kit/feedback.js'), 'utf8');
const REPLAY = fs.readFileSync(path.join(ROOT, 'assets/kit/feedback-replay.js'), 'utf8');

/* Analytics, by the host it loads from or the call it makes. Recorded, never refused. */
const ANALYTICS = [
  { name: 'Microsoft Clarity', host: 'clarity.ms' },
  { name: 'Google Tag Manager', host: 'googletagmanager.com' },
  { name: 'Google Analytics', host: 'google-analytics.com' },
  { name: 'Google Analytics', host: 'analytics.google.com' },
  { name: 'DoubleClick', host: 'doubleclick.net' },
  { name: 'Hotjar', host: 'hotjar.com' },
  { name: 'Hotjar', host: 'hotjar.io' },
  { name: 'Plausible', host: 'plausible.io' },
  { name: 'Segment', host: 'segment.com' },
  { name: 'Segment', host: 'segment.io' },
  { name: 'Mixpanel', host: 'mixpanel.com' },
  { name: 'PostHog', host: 'posthog.com' },
  { name: 'Heap', host: 'heapanalytics.com' },
  { name: 'FullStory', host: 'fullstory.com' },
  { name: 'Amplitude', host: 'amplitude.com' },
  { name: 'Umami', host: 'umami.is' },
  { name: 'Cloudflare Web Analytics', host: 'cloudflareinsights.com' },
  { name: 'Meta Pixel', host: 'connect.facebook.net' },
  { name: 'LinkedIn Insight', host: 'snap.licdn.com' },
  { name: 'HubSpot', host: 'hs-scripts.com' },
  { name: 'HubSpot', host: 'hs-analytics.net' },
  { name: 'Mouseflow', host: 'mouseflow.com' },
  { name: 'LogRocket', host: 'logrocket.com' },
  { name: 'New Relic', host: 'nr-data.net' },
  { name: 'Google tag', re: /\bgtag\s*\(\s*['"](?:config|event|js)['"]/ },
  { name: 'Matomo', re: /\b_paq\.push\s*\(/ }
];

/* Pages a rule doesn't apply to. skip: rules left out. allow: extra hosts (and their subdomains)
   the page may load or call. */
const EXEMPT = {
  'join/index.html': { skip: ['kit', 'id', 'restore'], why: 'a redirect to Pair Poll, with no screen of its own' },
  'pulse/index.html': { skip: ['kit', 'id', 'restore'], why: 'a redirect to Room Pulse, with no screen of its own' },
  'feedback/index.html': { skip: ['kit', 'id', 'restore'], allow: ['api.github.com', 'raw.githubusercontent.com'], why: 'the board itself, which reads older versions of each tool from the public repo' },
  'wbwai201/report-builder/index.html': { skip: ['kit', 'id', 'restore'], why: 'handles real session exports, so its security policy blocks every outgoing request' },
  'kc/report-builder/index.html': { skip: ['kit', 'id', 'restore'], why: 'handles real session exports, so its security policy blocks every outgoing request' }
};

/* Pages live before a rule, one line each. A pattern must match exactly one page. --shrink edits these lines. */
const NOT_YET = [
  ['Logistics/EC/In-Person/es/index.html', 'noindex kit id restore'],
  ['Logistics/EC/In-Person/fr/index.html', 'noindex kit id restore'],
  ['Logistics/EC/In-Person/index.html', 'noindex kit id restore'],
  ['Logistics/EC/In-Person/zh/index.html', 'noindex kit id restore'],
  [/^Logistics\/EC\/In-Person\/(?!(?:es|fr|zh)\/)[^/]+\/index\.html$/, 'noindex kit id restore'], // the client copy; a pattern keeps its folder name out of this file
  ['agents/index.html', 'noindex kit id restore'],
  ['ai-champion-charter/index.html', 'noindex kit id restore'],
  ['design-ideas/clear-instructions/index.html', 'kit id restore'],
  ['design-ideas/clear-instructions/parts.html', 'kit id restore'],
  ['design-ideas/clear-instructions/picture-steps.html', 'kit id restore'],
  ['design-ideas/clear-instructions/show-me.html', 'kit id restore'],
  ['design-ideas/clear-instructions/the-track.html', 'kit id restore'],
  ['design-ideas/clear-instructions/your-screen.html', 'kit id restore'],
  ['design-ideas/room-pulse/arrivals.html', 'kit id restore'],
  ['design-ideas/room-pulse/chord.html', 'kit id restore'],
  ['design-ideas/room-pulse/cover-story.html', 'kit id restore'],
  ['design-ideas/room-pulse/field.html', 'kit id restore'],
  ['design-ideas/room-pulse/index.html', 'kit id restore'],
  ['design-ideas/room-pulse/reveals.html', 'kit id restore'],
  ['design-ideas/room-pulse/setup.html', 'kit id restore'],
  ['design-ideas/room-pulse/toys.html', 'kit id restore'],
  ['design-ideas/room-pulse/tune-in.html', 'kit id restore'],
  ['design-ideas/room-pulse/waiting.html', 'kit id restore'],
  ['design-ideas/wbwai-ai-guide/index.html', 'kit id restore'],
  ['design-ideas/wbwai-icebreakers/index.html', 'kit id restore'],
  ['field-tools/ai-impact-ladder/index.html', 'kit id restore'],
  ['field-tools/chips/index.html', 'noindex kit id restore'],
  ['field-tools/pair-poll/index.html', 'kit id restore'],
  ['field-tools/room-pulse/index.html', 'kit id restore'],
  ['kc/index.html', 'kit id restore'],
  ['podium-for-partners-ideo/index.html', 'kit id restore'],
  ['podium-for-partners/index.html', 'noindex kit id restore'],
  ['t3/wbwai-curveballroleplay/index.html', 'noindex kit id restore'],
  ['t3/wbwai-prepskillbuilder/index.html', 'noindex kit id restore'],
  ['wbwai201/index.html', 'kit id restore'],
  ['webinars/reimagine-with-ai/index.html', 'kit id restore']
];
const NOT_YET_SIZE = 119;

/* ---------- reading the command line ---------- */
const argv = process.argv.slice(2);
let only = null, as = null, shrinking = false;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--as') as = argv[++i];
  else if (argv[i] === '--shrink') shrinking = true;
  else if (!only) only = argv[i];
}

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.git' || e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.html?$/i.test(e.name)) out.push(path.relative(ROOT, p).split(path.sep).join('/'));
  }
  return out;
}
function pageUrl(rel) { return SITE + rel.replace(/(^|\/)index\.html?$/i, '$1'); }
function page(rel, file) {
  const html = fs.readFileSync(file, 'utf8');
  return { rel, file, html, url: pageUrl(rel), dir: SITE + rel.replace(/[^/]*$/, '') };
}

const all = walk(ROOT, []).sort();
let pages;
if (only) {
  const file = path.resolve(only);
  if (!fs.existsSync(file)) { console.log('FAIL  no file at ' + only); process.exit(1); }
  const inRepo = !path.relative(ROOT, file).startsWith('..');
  const rel = as ? as.replace(/^\/+/, '').replace(/^pt\//, '') : inRepo ? path.relative(ROOT, file).split(path.sep).join('/') : null;
  if (!rel) { console.log('FAIL  ' + only + ' is outside the repo: add --as <its repo path>, such as --as field-tools/my-tool/index.html'); process.exit(1); }
  pages = [page(rel, file)];
} else pages = all.map((rel) => page(rel, path.join(ROOT, rel)));

/* ---------- small helpers ---------- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms) { const t0 = Date.now(); for (;;) { let v = false; try { v = fn(); } catch (e) {} if (v) return v; if (Date.now() - t0 > ms) return false; await sleep(20); } }
async function pool(items, n, fn) {
  const out = new Array(items.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (next < items.length) { const k = next++; out[k] = await fn(items[k], k); } }));
  return out;
}
/* A page may leave a rejected promise unhandled when its network is blocked; that's not a crash here. */
process.on('unhandledRejection', () => {});

function hostAllowed(h, allow) { return (allow || []).some((a) => h === a || h.endsWith('.' + a)); }
/* null when a page may fetch the address, else the address. */
function offSite(raw, base, allow) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s || s.startsWith('#')) return null;
  let u; try { u = new URL(s, base); } catch (e) { return null; }
  if (/^(data|blob|about|javascript|mailto|tel):$/.test(u.protocol)) return null;
  if (u.protocol !== 'https:') return u.href;
  if (u.hostname === 'ep.github.io' && u.pathname.startsWith('/pt/')) return null;
  if (OK_HOSTS.includes(u.hostname) || hostAllowed(u.hostname, allow)) return null;
  return u.href;
}

/* Everything in a document that makes the browser fetch something. */
const LOADS = [['script', 'src'], ['img', 'src'], ['img', 'srcset'], ['source', 'src'], ['source', 'srcset'], ['video', 'src'], ['video', 'poster'],
  ['audio', 'src'], ['track', 'src'], ['iframe', 'src'], ['frame', 'src'], ['embed', 'src'], ['object', 'data'], ['input[type="image"]', 'src'], ['form', 'action']];
const NOT_LOADS = /^(canonical|alternate|author|license|help|next|prev|search|me|bookmark|external)$/i;
function fetchedBy(doc) {
  const out = [];
  for (const [sel, attr] of LOADS) for (const el of doc.querySelectorAll(sel + '[' + attr + ']')) {
    const v = el.getAttribute(attr) || '';
    if (attr === 'srcset') v.split(',').forEach((part) => { const u = part.trim().split(/\s+/)[0]; if (u) out.push(u); });
    else out.push(v);
  }
  for (const el of doc.querySelectorAll('link[href]')) {
    const rel = (el.getAttribute('rel') || '').trim().split(/\s+/);
    if (rel.length && rel.every((r) => NOT_LOADS.test(r))) continue;
    out.push(el.getAttribute('href'));
  }
  for (const el of doc.querySelectorAll('image, use, feImage')) {
    const v = el.getAttribute('href') || el.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
    if (v) out.push(v);
  }
  const css = [...doc.querySelectorAll('style')].map((s) => s.textContent).concat([...doc.querySelectorAll('[style]')].map((e) => e.getAttribute('style')));
  for (const t of css) {
    for (const m of t.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)) out.push(m[2]);
    for (const m of t.matchAll(/@import\s+(?:url\(\s*)?['"]([^'"]+)['"]/g)) out.push(m[1]);
  }
  return out;
}
/* Literal addresses handed straight to a request in a script's text. */
function fetchedInScripts(html) {
  const out = [];
  const res = [/\b(?:fetch|sendBeacon|EventSource|WebSocket|importScripts|import)\s*\(\s*(['"`])((?:https?:|wss?:)?\/\/[^'"`\s]+)/g,
    /\.open\(\s*['"][A-Za-z]+['"]\s*,\s*(['"`])((?:https?:)?\/\/[^'"`\s]+)/g,
    /\.src\s*=\s*(['"`])((?:https?:)?\/\/[^'"`\s]+)/g];
  for (const re of res) for (const m of html.matchAll(re)) out.push(m[2].startsWith('//') ? 'https:' + m[2] : m[2]);
  for (const m of html.matchAll(/https:\/\/[a-z0-9.-]+\.workers\.dev/gi)) out.push(m[0]);
  return out;
}

/* What jsdom lacks and a browser has, so a page's scripts run as far as they would there. */
function stubs(w) {
  const noop = () => {};
  const ctx = new Proxy({}, { get(t, k) { if (k in t) return t[k]; if (k === 'measureText') return (s) => ({ width: String(s).length * 8 }); if (k === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) }); if (/^create/.test(String(k))) return () => ({ addColorStop: noop }); return noop; }, set(t, k, v) { t[k] = v; return true; } });
  w.HTMLCanvasElement.prototype.getContext = function () { return ctx; };
  w.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,iVBORw0KGgo=';
  w.HTMLCanvasElement.prototype.toBlob = function (cb) { setTimeout(() => cb(new w.Blob(['x'], { type: 'image/png' })), 0); };
  w.matchMedia = (q) => ({ matches: false, media: q, onchange: null, addEventListener: noop, removeEventListener: noop, addListener: noop, removeListener: noop });
  w.IntersectionObserver = w.IntersectionObserver || class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } };
  w.ResizeObserver = w.ResizeObserver || class { observe() {} unobserve() {} disconnect() {} };
  w.scrollTo = noop; w.scrollBy = noop; w.Element.prototype.scrollIntoView = noop; w.Element.prototype.scrollTo = noop;
  w.HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
  w.HTMLMediaElement.prototype.pause = noop; w.HTMLMediaElement.prototype.load = noop;
  w.alert = noop; w.confirm = () => false; w.prompt = () => null; w.print = noop; w.open = () => null;
  w.URL.createObjectURL = () => 'blob:qa'; w.URL.revokeObjectURL = noop;
  try { Object.defineProperty(w.navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.resolve(), readText: () => Promise.resolve('') } }); } catch (e) {}
}
/* Every way a script can reach the network: each try is reported, and none gets through. */
function trap(w, seen) {
  const say = (u) => { try { seen(typeof u === 'string' ? u : (u && u.url) || String(u)); } catch (e) {} };
  w.fetch = (u) => { say(u); return Promise.reject(new w.TypeError('Failed to fetch')); };
  w.XMLHttpRequest = class {
    constructor() { this.readyState = 0; this.status = 0; this.responseText = ''; this._on = {}; }
    open(m, u) { say(u); this.readyState = 1; }
    setRequestHeader() {} overrideMimeType() {} abort() {} getAllResponseHeaders() { return ''; } getResponseHeader() { return null; }
    addEventListener(t, f) { (this._on[t] = this._on[t] || []).push(f); } removeEventListener() {}
    send() { setTimeout(() => { this.readyState = 4; for (const t of ['readystatechange', 'error', 'loadend']) { const ev = { type: t, target: this }; (this._on[t] || []).forEach((f) => f(ev)); if (typeof this['on' + t] === 'function') this['on' + t](ev); } }, 0); }
  };
  try { Object.defineProperty(w.navigator, 'sendBeacon', { configurable: true, value: (u) => { say(u); return false; } }); } catch (e) {}
  w.WebSocket = function (u) { say(u); throw new w.DOMException('blocked', 'SecurityError'); };
  w.EventSource = function (u) { say(u); throw new w.DOMException('blocked', 'SecurityError'); };
}
/* The board's sandboxed frame: storage and cookies throw there. */
function sandbox(w) {
  for (const k of ['localStorage', 'sessionStorage']) Object.defineProperty(w, k, { configurable: true, get() { throw new w.DOMException('blocked', 'SecurityError'); } });
  try { Object.defineProperty(w.document, 'cookie', { configurable: true, get() { throw new w.DOMException('blocked', 'SecurityError'); }, set() { throw new w.DOMException('blocked', 'SecurityError'); } }); } catch (e) {}
}
function quiet(errs, tag) {
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => { const m = String((e && e.message) || e); if (!/Not implemented|Could not load/.test(m)) errs.push((tag ? tag + ': ' : '') + m.split('\n')[0].slice(0, 200)); });
  return vc;
}
/* The page the board builds: a <base> for the tool's folder and the replay data, as feedback/index.html does. */
function replayDoc(html, dir, data) {
  const json = JSON.stringify(data).split('<').join('\\u003c');
  const inject = '<base href="' + dir.replace(/[&"<>]/g, '') + '"><script>window.EPKitReplay=' + json + ';<\/script>';
  return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + inject) : inject + html;
}
function frame(p, data, errs, net, tag) {
  const dom = new JSDOM(replayDoc(p.html, p.dir, data), { url: 'about:srcdoc', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: quiet(errs, tag),
    beforeParse(w) { stubs(w); sandbox(w); trap(w, (u) => net.push((tag ? tag + ': ' : '') + u)); } });
  return dom.window;
}
async function ready(w) { await until(() => w.document.readyState === 'complete', 5000); }
function boot(w) { w.eval(KIT); w.eval(REPLAY); }
function tool(w) { try { return w.EPKit && w.EPKit.tool; } catch (e) { return null; } }
function screenOf(t) { try { return typeof t.screen === 'function' ? t.screen() : t.screen; } catch (e) { return undefined; } }
function print(w) {
  const c = w.document.documentElement.cloneNode(true);
  c.querySelectorAll('script, style, [data-epkit]').forEach((n) => n.remove());
  return crypto.createHash('sha1').update(c.outerHTML).digest('hex');
}
function staticId(html) { const m = /\.tool\s*=\s*\{[^}]*?\bid\s*:\s*["']([^"']*)["']/.exec(html); return m ? m[1] : null; }

/* ---------- a normal visit: what the page loads and calls on its own ---------- */
async function visit(p) {
  const tried = [], errs = [];
  const dom = new JSDOM(p.html, { url: p.url, runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: quiet(errs),
    beforeParse(w) { stubs(w); trap(w, (u) => tried.push(u)); } });
  const w = dom.window;
  await ready(w); await sleep(300);
  const live = fetchedBy(w.document);
  w.close();
  return { tried, live };
}

/* ---------- the board's rebuild: sections, then every screen ---------- */
async function rebuild(p) {
  const out = { id: undefined, hook: false, sections: null, screens: [], bad: [], errs: [], net: [], rowBad: [], same: [] };
  /* The board's map frame, which only reads sections; here it then opens every screen in a row. */
  let map = null;
  const w = frame(p, { map: true }, out.errs, out.net, 'in a row');
  w.addEventListener('message', (e) => { if (e.data && e.data.type === 'epkit-map') map = e.data; });
  await ready(w); boot(w);
  await until(() => map, 3000);
  const t = tool(w);
  out.hook = !!(t && typeof t === 'object');
  if (out.hook) { try { out.id = t.id; } catch (e) {} }
  out.sections = map && map.sections;
  if (!out.hook || typeof t.restore !== 'function' || !Array.isArray(out.sections)) { w.close(); return out; }
  out.screens = out.sections.reduce((a, s) => a.concat(s && Array.isArray(s.screens) ? s.screens : []), []);
  for (const sc of out.screens) {
    let ok = false; try { ok = t.restore({ screen: sc, settings: {} }); } catch (e) { out.errs.push('in a row: ' + sc + ': ' + e.message); }
    await sleep(40);
    if (!(ok === true && screenOf(t) === sc)) out.rowBad.push(sc);
  }
  w.close();
  /* One fresh frame per screen, the way the board opens a comment. */
  const prints = await pool(out.screens, 4, async (sc) => {
    let msg = null;
    const f = frame(p, { screen: sc, settings: {}, scroll: 0, focus: '', targets: [] }, out.errs, out.net, sc);
    f.addEventListener('message', (e) => { if (e.data && e.data.type === 'epkit-replay') msg = e.data; });
    await ready(f); boot(f);
    await until(() => msg, 9000);
    const ft = tool(f), ok = !!(msg && msg.ok === true) && !!ft && screenOf(ft) === sc;
    if (!ok) out.bad.push(sc + (msg ? (msg.ok ? ' (screen() says ' + JSON.stringify(screenOf(ft)) + ')' : ' (restore() said no)') : ' (no answer)'));
    const fp = print(f);
    f.close();
    return fp;
  });
  const by = {};
  prints.forEach((fp, i) => { (by[fp] = by[fp] || []).push(out.screens[i]); });
  out.same = Object.values(by).filter((g) => g.length > 1);
  return out;
}

/* ---------- the rules ---------- */
function notYetFor(rel) {
  const hit = NOT_YET.filter(([k]) => (k instanceof RegExp ? k.test(rel) : k === rel));
  return new Set(hit.flatMap(([, rules]) => rules.split(/\s+/)));
}

async function checkPage(p, ids) {
  const ex = EXEMPT[p.rel] || {}, skip = new Set(ex.skip || []), allow = ex.allow || [];
  const res = {};
  const doc = new JSDOM(p.html, { url: p.url }).window.document;

  if (!skip.has('noindex')) {
    const m = [...doc.querySelectorAll('meta[name="robots" i]')].map((e) => (e.getAttribute('content') || '').toLowerCase());
    res.noindex = m.some((c) => /\bnoindex\b/.test(c) && /\bnofollow\b/.test(c)) ? { ok: true } : { ok: false, why: m.length ? 'the robots tag says "' + m[0] + '"' : 'no robots tag' };
  }

  const v = await visit(p);

  /* Analytics are recorded, not judged, and what they load isn't counted as a request. */
  const text = p.html.toLowerCase(), seen = v.tried.concat(v.live), found = new Set();
  const hostIs = (u, h) => { try { const x = new URL(u, p.url).hostname; return x === h || x.endsWith('.' + h); } catch (e) { return false; } };
  for (const a of ANALYTICS) {
    if (a.host && (text.includes(a.host) || seen.some((u) => hostIs(u, a.host)))) found.add(a.name);
    if (a.re && a.re.test(p.html)) found.add(a.name);
  }
  res.analytics = [...found];

  if (!skip.has('requests')) {
    const offs = new Set(), tracking = ANALYTICS.filter((a) => a.host).map((a) => a.host);
    for (const u of fetchedBy(doc).concat(fetchedInScripts(p.html), v.live, v.tried)) { const o = offSite(u, p.url, allow.concat(tracking)); if (o) offs.add(o.length > 90 ? o.slice(0, 89) + '...' : o); }
    res.requests = offs.size ? { ok: false, why: [...offs].slice(0, 4).join(' | ') + (offs.size > 4 ? ' and ' + (offs.size - 4) + ' more' : '') } : { ok: true };
  }

  if (!skip.has('kit')) {
    const line = [...doc.querySelectorAll('script[src]')].some((s) => { try { const u = new URL(s.getAttribute('src'), p.url); return u.hostname === 'ep.github.io' && u.pathname === '/pt/assets/kit/feedback.js'; } catch (e) { return false; } });
    res.kit = line ? { ok: true } : { ok: false, why: 'no <script src="/pt/assets/kit/feedback.js" defer></script>' };
  }

  let r = null;
  if (!skip.has('id') || !skip.has('restore')) r = await rebuild(p);

  if (!skip.has('id')) {
    const id = r.id, quick = staticId(p.html);
    let why = '';
    if (!r.hook) why = 'no EPKit.tool hook';
    else if (typeof id !== 'string' || !id) why = 'the hook sets no id, so the kit would use the folder name';
    else if (!/^[a-z0-9-]{1,40}$/.test(id)) why = 'id "' + id + '" isn\'t lowercase letters, numbers and hyphens, at most 40';
    else if (quick !== id) why = 'write the id as a plain string in the hook (id: "' + id + '"), so a one-file run can compare it with other pages';
    else { const twin = Object.keys(ids).find((k) => k !== p.rel && ids[k] === id); if (twin) why = 'id "' + id + '" is already used by ' + twin; }
    res.id = why ? { ok: false, why } : { ok: true, note: id };
  }

  if (!skip.has('restore')) {
    let why = '';
    const secs = r.sections;
    if (!r.hook) why = 'no EPKit.tool hook';
    else if (!Array.isArray(secs) || !secs.length) why = 'sections() gives no list of parts';
    else if (secs.some((s) => !s || typeof s.name !== 'string' || !Array.isArray(s.screens))) why = 'each part in sections() needs a name and a list of screens';
    else if (!r.screens.length) why = 'sections() names no screens';
    else {
      const dup = r.screens.filter((s, i) => r.screens.indexOf(s) !== i);
      if (dup.length) why = 'in more than one part: ' + [...new Set(dup)].join(', ');
      else if (r.bad.length) why = 'these don\'t open: ' + r.bad.join(', ');
      else if (r.rowBad.length) why = 'these don\'t open one after another in one frame: ' + r.rowBad.join(', ');
      else if (r.net.length) why = 'it reaches for the network: ' + r.net.slice(0, 3).join(' | ');
      else if (r.errs.length) why = 'errors: ' + r.errs.slice(0, 3).join(' | ');
      else if (r.same.length) why = 'these open to the same page: ' + r.same.map((g) => g.join(' = ')).join('; ');
    }
    res.restore = why ? { ok: false, why } : { ok: true, note: r.screens.length + (r.screens.length === 1 ? ' screen' : ' screens') };
  }
  return res;
}

/* ---------- run ---------- */
let failures = 0;
function line(word, text) { console.log(word.padEnd(6) + text); if (word === 'FAIL') failures++; }
const keyOf = (k) => (k instanceof RegExp ? k.toString() : "'" + k + "'");
const matches = (k, rel) => (k instanceof RegExp ? k.test(rel) : k === rel);

/* The lists themselves: every NOT_YET entry names one page that exists, with known rules. */
const drop = new Map();                     /* NOT_YET entry -> rules that come off with --shrink */
const dropRule = (k, r) => { if (!drop.has(k)) drop.set(k, new Set()); drop.get(k).add(r); };
for (const [k, rules] of NOT_YET) {
  const n = all.filter((rel) => matches(k, rel)).length;
  if (n === 0) { if (shrinking) rules.split(/\s+/).forEach((r) => dropRule(k, r)); else line('FAIL', 'NOT_YET entry ' + keyOf(k) + ' matches no page: run with --shrink to take it off'); }
  if (n > 1) line('FAIL', 'NOT_YET entry ' + keyOf(k) + ' matches ' + n + ' pages; each entry names exactly one');
  for (const r of rules.split(/\s+/)) if (!RULES.includes(r)) line('FAIL', 'NOT_YET entry ' + keyOf(k) + ' names an unknown rule: ' + r);
}
for (const k of Object.keys(EXEMPT)) if (!all.includes(k)) line('FAIL', 'EXEMPT names ' + k + ', which isn\'t in the repo');

/* Every page's id, read from its text. Each checked page's hook must agree with this read, so it can be trusted. */
const ids = {};
for (const rel of all) { const id = staticId(fs.readFileSync(path.join(ROOT, rel), 'utf8')); if (id) ids[rel] = id; }
for (const p of pages) { delete ids[p.rel]; const id = staticId(p.html); if (id) ids[p.rel] = id; }

const t0 = Date.now();
console.log('qa-kit-coverage: ' + pages.length + (pages.length === 1 ? ' page' : ' pages') + '\n');
let pass = 0, todo = 0;
const tracked = {};
for (const p of pages) {
  const res = await checkPage(p, ids);
  res.analytics.forEach((name) => (tracked[name] = tracked[name] || []).push(p.rel));
  const later = notYetFor(p.rel), ok = [], wait = [];
  for (const rule of RULES) {
    const r = res[rule];
    if (!r) continue;
    if (r.ok) {
      ok.push(rule + (r.note ? ' (' + r.note + ')' : '')); pass++;
      if (later.has(rule)) {
        const k = NOT_YET.find(([key, rules]) => matches(key, p.rel) && rules.split(/\s+/).includes(rule))[0];
        if (shrinking) dropRule(k, rule);
        else line('FAIL', p.rel + ': ' + rule + ' now passes but is still on NOT_YET: run with --shrink to take it off');
      }
    } else if (later.has(rule)) { wait.push(rule + ' (' + r.why + ')'); todo++; }
    else line('FAIL', p.rel + ': ' + rule + ': ' + r.why);
  }
  if (ok.length) line('PASS', p.rel + ': ' + ok.join(', '));
  if (wait.length) line('TODO', p.rel + ': not yet: ' + wait.join('; '));
}

/* --shrink: take the entries that now pass (or whose page is gone) off NOT_YET, and lower its size. */
let size = NOT_YET.reduce((n, [, rules]) => n + rules.split(/\s+/).length, 0);
if (shrinking && drop.size) {
  let src = fs.readFileSync(SELF, 'utf8');
  const esc = (t) => t.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');
  for (const [k, gone] of drop) {
    const m = new RegExp('^  \\[' + esc(keyOf(k)) + ", '([a-z ]+)'\\],?([^\\n]*)\\n", 'm').exec(src);
    if (!m) { line('FAIL', '--shrink can\'t find the line for ' + keyOf(k) + '; edit NOT_YET by hand'); continue; }
    const left = m[1].split(' ').filter((r) => !gone.has(r));
    src = src.replace(m[0], left.length ? '  [' + keyOf(k) + ", '" + left.join(' ') + "']," + m[2] + '\n' : '');
    size -= m[1].split(' ').length - left.length;
    console.log('SHRUNK' + ' ' + keyOf(k) + ': ' + [...gone].join(', ') + (left.length ? '' : ' (entry removed)'));
  }
  src = src.replace(/^const NOT_YET_SIZE = \d+;/m, 'const NOT_YET_SIZE = ' + size + ';');
  fs.writeFileSync(SELF, src);
  console.log('SHRUNK NOT_YET is now ' + size + ' rules, and this file is rewritten. Package it with the change.');
}
if (size > NOT_YET_SIZE) line('FAIL', 'NOT_YET lists ' + size + ' rules but NOT_YET_SIZE says ' + NOT_YET_SIZE + ': the list only shrinks');
else if (size < NOT_YET_SIZE && !shrinking) line('FAIL', 'NOT_YET lists ' + size + ' rules but NOT_YET_SIZE says ' + NOT_YET_SIZE + ': run with --shrink to lower it');
else if (size < NOT_YET_SIZE && shrinking && !drop.size) {
  fs.writeFileSync(SELF, fs.readFileSync(SELF, 'utf8').replace(/^const NOT_YET_SIZE = \d+;/m, 'const NOT_YET_SIZE = ' + size + ';'));
  console.log('SHRUNK NOT_YET_SIZE lowered to ' + size + '. Package this file with the change.');
}

/* The analytics record: which pages carry what. Never a failure. */
const names = Object.keys(tracked).sort();
console.log('\nAnalytics on ' + (pages.length === 1 ? 'this page' : 'these pages') + (names.length ? ' (a record, not a failure):' : ': none'));
for (const n of names) console.log('NOTE  ' + n + ': ' + tracked[n].join(', '));
console.log('\n' + pass + ' rules pass, ' + todo + ' not yet, ' + failures + ' failed, in ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
process.exit(failures ? 1 : 0);
