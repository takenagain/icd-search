import './style.css';
import { h, clear } from './ui/h';
import { client } from './client';
import { onNavigate, parse, navigate } from './router';
import { state } from './state';
import { homeView } from './views/home';
import { resultsView } from './views/results';
import { codeView } from './views/code';
import { graphView } from './views/graph';
import { aboutView } from './views/about';
import { setupView } from './views/setup';
import { footer, topBar, page, wordmark } from './ui/shell';
import type { StepEvent } from './types';

const app = document.getElementById('app')!;
const banner = document.getElementById('banner')!;
let cleanup: (() => void) | null = null;
let seq = 0;
let ready = false;
let update: { available: boolean } | null = null;

function mount(el: HTMLElement, title: string, focusHeading = true, onCleanup?: () => void) {
  cleanup?.();
  cleanup = onCleanup ?? null;
  clear(app);
  app.appendChild(el);
  document.title = title;
  window.scrollTo(0, 0);
  if (focusHeading) (el.querySelector('h1') as HTMLElement | null)?.focus({ preventScroll: true });
}

async function render() {
  if (!ready) return;
  const mine = ++seq;
  const route = parse(location);
  try {
    let out: { el: HTMLElement; title: string; cleanup?: () => void };
    switch (route.name) {
      case 'home':
        out = { el: homeView(), title: 'Icdex - ICD-11 search' };
        break;
      case 'search':
        out = await resultsView(route.q, route.p);
        break;
      case 'code':
        out = await codeView(route.key);
        break;
      case 'graph':
        out = await graphView(route.key);
        break;
      case 'about':
        out = await aboutView(update, () => void runUpdate());
        break;
      default:
        out = {
          el: page('code-page', topBar(), h('main', { id: 'main', class: 'code-main' }, h('h1', { tabindex: '-1' }, 'Page not found'), h('p', null, h('code', null, route.path), ' does not exist.'), h('p', null, h('a', { href: '/' }, 'Back to search'))), footer(state.manifest)),
          title: 'Not found - Icdex',
        };
    }
    if (mine !== seq) return out.cleanup?.();
    mount(out.el, out.title, route.name !== 'home', out.cleanup);
  } catch (e) {
    if (mine !== seq) return;
    mount(page('code-page', topBar(), h('main', { id: 'main', class: 'code-main' }, h('h1', { tabindex: '-1' }, 'Something went wrong'), h('p', { role: 'alert' }, e instanceof Error ? e.message : String(e))), footer(state.manifest)), 'Error - Icdex');
  }
}

function showBanner() {
  clear(banner);
  if (!update?.available) return;
  banner.append(
    h('div', { class: 'update-banner', role: 'status' }, 'A newer ICD-11 dataset is available. ', h('button', { class: 'btn small', type: 'button', onClick: () => void runUpdate() }, 'Update'), h('button', { class: 'btn small', type: 'button', onClick: () => clear(banner) }, 'Later')),
  );
}

function runSetup(title: string, intro: string, onDone: () => void) {
  ready = false;
  const t0 = performance.now();
  mount(
    setupView({
      title,
      intro,
      run: () => client.setup(),
      onDone: async () => {
        const secs = (performance.now() - t0) / 1000;
        try {
          localStorage.setItem('icd-setup-seconds', secs.toFixed(1));
        } catch {
          /* private mode */
        }
        (window as unknown as { __icdSetupSeconds: number }).__icdSetupSeconds = secs;
        onDone();
      },
    }),
    `${title} - Icdex`,
  );
}

async function afterReady() {
  const st = await client.status();
  state.manifest = st.manifest;
  ready = true;
  clear(banner);
  await render();
  const u = await client.checkUpdate();
  update = u.available ? { available: true } : null;
  showBanner();
}

async function runUpdate() {
  runSetup('Updating the ICD-11 data', 'A newer release is available. Downloading it now; the old data stays until the new files are verified.', () => void afterReady());
}

function loadingView(): HTMLElement {
  const fill = h('div', { class: 'bar-fill' });
  const note = h('p', { class: 'hint' }, 'Opening the saved data');
  const track = h('div', { class: 'bar', role: 'progressbar', 'aria-label': 'Loading search index', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0' }, fill);
  client.onStep((e: StepEvent) => {
    if (e.step !== 'index' && e.step !== 'store') return;
    const pct = e.total ? Math.round(((e.done ?? 0) / e.total) * 100) : 0;
    fill.style.width = `${pct}%`;
    track.setAttribute('aria-valuenow', String(pct));
    if (e.note) note.textContent = e.note;
  });
  return page('setup-page', h('main', { id: 'main', class: 'setup loading' }, h('div', { class: 'center' }, wordmark(true)), h('h1', { class: 'sr-only', tabindex: '-1' }, 'Opening ICD-11'), track, note), footer());
}

async function boot() {
  onNavigate(() => void render());
  let st: Awaited<ReturnType<typeof client.status>> = { stored: false };
  try {
    st = await client.status();
  } catch {
    /* no IndexedDB: setup will report it */
  }
  const first = () =>
    runSetup('Setting up ICD-11 search', 'The first visit downloads the classification once, checks it, stores it in this browser and builds a search index. After that, everything opens instantly and works on this device.', () => void afterReady());
  if (!st.stored) return first();
  state.manifest = st.manifest;
  mount(loadingView(), 'Icdex', false);
  const r = await client.load().catch((e) => ({ ok: false, reason: String(e) }));
  if (r.ok) return void afterReady();
  runSetup('Restoring the ICD-11 data', 'The saved copy is missing or damaged (browsers may clear storage under pressure). Downloading it again.', () => void afterReady());
}

void boot();
export { navigate };
