// First-visit flow: real steps, real progress, clear errors, and the attribution.
import { h } from '../ui/h';
import { client } from '../client';
import { footer, wordmark, page } from '../ui/shell';
import type { StepEvent, StepId } from '../types';

const STEPS: { id: StepId; title: string; what: string }[] = [
  { id: 'manifest', title: 'Find the dataset', what: 'Read the manifest: release, file list and checksums' },
  { id: 'storage', title: 'Check storage', what: 'Make sure this browser has room for the data' },
  { id: 'download', title: 'Download', what: 'Fetch the compressed ICD-11 dataset' },
  { id: 'verify', title: 'Verify', what: 'Compare every file with its SHA-256 checksum' },
  { id: 'store', title: 'Store on this device', what: 'Save the files in IndexedDB' },
  { id: 'index', title: 'Build the search index', what: 'Index titles, synonyms, inclusions and definitions' },
];

// Download, verify and store run as a pipeline over the files, so they progress together:
// an event from one of them must not mark the others finished.
const PIPELINE = new Set<StepId>(['download', 'verify', 'store']);

export function setupView(opts: { title: string; intro: string; run: () => Promise<void>; onDone: () => void; autostart?: boolean }): HTMLElement {
  const rows = new Map<StepId, { li: HTMLElement; bar: HTMLElement; note: HTMLElement; track: HTMLElement }>();
  const list = h('ol', { class: 'steps' });
  for (const s of STEPS) {
    const bar = h('div', { class: 'bar-fill' });
    const track = h('div', { class: 'bar', role: 'progressbar', 'aria-label': s.title, 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0' }, bar);
    const note = h('div', { class: 'step-note' }, s.what);
    const li = h('li', { class: 'step pending', 'data-step': s.id }, h('div', { class: 'step-title' }, h('span', { class: 'dot', 'aria-hidden': 'true' }), h('strong', null, s.title)), track, note);
    list.appendChild(li);
    rows.set(s.id, { li, bar, note, track });
  }

  const error = h('div', { class: 'error', role: 'alert', hidden: true });
  const retry = h('button', { class: 'btn', type: 'button', hidden: true }, 'Try again');
  const status = h('p', { class: 'sr-only', 'aria-live': 'polite' });

  const apply = (e: StepEvent) => {
    const r = rows.get(e.step);
    if (!r) return;
    const idx = STEPS.findIndex((s) => s.id === e.step);
    STEPS.forEach((s, i) => {
      const row = rows.get(s.id)!;
      if (i < idx && !(PIPELINE.has(s.id) && PIPELINE.has(e.step)) && !row.li.classList.contains('error')) {
        row.li.className = 'step done';
        row.track.setAttribute('aria-valuenow', '100');
        row.bar.style.width = '100%';
      }
    });
    r.li.className = `step ${e.status}`;
    const total = e.total ?? 0;
    const pct = e.status === 'done' ? 100 : total > 0 ? Math.min(100, Math.round(((e.done ?? 0) / total) * 100)) : 0;
    r.bar.style.width = `${pct}%`;
    r.track.classList.toggle('indeterminate', e.status === 'active' && total === 0);
    r.track.setAttribute('aria-valuenow', String(pct));
    if (e.note) r.note.textContent = e.note;
    if (e.status === 'error') {
      error.hidden = false;
      error.textContent = e.note ?? 'Something went wrong.';
      retry.hidden = false;
    }
    if (e.status === 'done') status.textContent = `${STEPS[idx].title} finished`;
  };

  const start = async () => {
    error.hidden = true;
    retry.hidden = true;
    const off = client.onStep(apply);
    try {
      await opts.run();
      off();
      opts.onDone();
    } catch (e) {
      off();
      if (error.hidden) {
        error.hidden = false;
        error.textContent = e instanceof Error ? e.message : String(e);
        retry.hidden = false;
      }
    }
  };
  retry.addEventListener('click', start);
  if (opts.autostart !== false) queueMicrotask(start);

  return page(
    'setup-page',
    h(
      'main',
      { id: 'main', class: 'setup' },
      h('div', { class: 'center' }, wordmark(true)),
      h('h1', { tabindex: '-1' }, opts.title),
      h('p', { class: 'lead' }, opts.intro),
      list,
      error,
      h('div', { class: 'actions' }, retry),
      status,
      h(
        'section',
        { class: 'attribution', 'aria-label': 'Attribution and licence' },
        h('h2', null, 'Where the data comes from'),
        h(
          'p',
          null,
          'ICD-11 for Mortality and Morbidity Statistics is © World Health Organization and published under the ',
          h('a', { href: 'https://creativecommons.org/licenses/by-nd/3.0/igo/', target: '_blank', rel: 'noopener' }, 'CC BY-ND 3.0 IGO'),
          ' licence. Titles, definitions and other WHO text are shown exactly as WHO publishes them. Every code links to the official ',
          h('a', { href: 'https://icd.who.int/browse/2026-01/mms/en', target: '_blank', rel: 'noopener' }, 'WHO ICD-11 browser'),
          '.',
        ),
        h('p', null, 'The files are downloaded once, stored in this browser and searched on this device. Nothing you type is sent anywhere.'),
      ),
    ),
    footer(),
  );
}
