import { h, marked } from '../ui/h';
import { client } from '../client';
import { footer, page, topBar, fmt } from '../ui/shell';
import { href } from '../router';
import { attachPreview } from '../ui/preview';
import { state } from '../state';
import type { Hit, SearchResponse } from '../types';

export async function resultsView(q: string, p: number): Promise<{ el: HTMLElement; title: string }> {
  const t0 = performance.now();
  const r: SearchResponse | null = q.trim() ? await client.search(q, p, 10) : null;
  const secs = ((performance.now() - t0) / 1000).toFixed(2);

  let body: HTMLElement;
  if (!r) {
    body = h('p', { class: 'none' }, 'Type something to search.');
  } else if (r.total === 0) {
    body = h(
      'div',
      { class: 'none' },
      h('p', null, 'No results for ', h('strong', null, q), '.'),
      h('ul', null, h('li', null, 'Check the spelling, or try fewer words.'), h('li', null, 'Codes work too: try 8B88 or BA00.1.')),
    );
  } else {
    body = h(
      'div',
      null,
      h('p', { class: 'stats', 'aria-live': 'polite' }, `${fmt(r.total)} result${r.total === 1 ? '' : 's'} (${secs} seconds)`),
      r.fuzzy.length
        ? h('p', { class: 'fuzzy' }, `No exact match for ${r.fuzzy.map((f) => `“${f}”`).join(', ')}: showing similar spellings.`)
        : null,
      h('div', { class: 'results' }, r.hits.map(result)),
      pager(r),
    );
  }
  const el = page('results-page', topBar(q), h('main', { id: 'main', class: 'res-main' }, h('h1', { class: 'sr-only', tabindex: '-1' }, r ? `Results for ${q}` : 'Search'), body), footer(state.manifest));
  return { el, title: q ? `${q} - Icdex` : 'Icdex' };
}

function result(hit: Hit): HTMLElement {
  const title = h('a', { href: href.code(hit.key) }, hit.title);
  attachPreview(title, hit.key);
  const crumbs = hit.crumbs.map((c) => h('a', { href: href.code(c.key) }, c.kind === 'chapter' ? `${c.code} ${c.title}` : c.title));
  const chipText = hit.code || (hit.kind === 'chapter' ? 'Chapter' : hit.kind === 'block' ? 'Block' : 'Group');
  return h(
    'article',
    { class: 'result', 'data-key': hit.key },
    h('h3', null, title),
    h(
      'div',
      { class: 'url' },
      h('span', { class: hit.code ? 'chip' : 'chip alt' }, chipText),
      crumbs.length ? crumbs.flatMap((c, i) => (i ? [h('span', { class: 'sep', 'aria-hidden': 'true' }, ' › '), c] : [c])) : null,
    ),
    hit.snippet ? h('p', { class: 'snip' }, h('span', { class: 'lbl' }, hit.snippet.label), ' ', marked(hit.snippet.parts)) : null,
  );
}

/** Playful pagination: Icd + one "e" per page + x, with the page numbers underneath. */
function pager(r: SearchResponse): HTMLElement | string {
  if (r.pages <= 1) return '';
  const first = Math.max(1, Math.min(r.page - 4, r.pages - 9));
  const last = Math.min(r.pages, first + 9);
  const link = (p: number) => href.search(r.query, p);
  const items: HTMLElement[] = [h('li', { class: 'cap', 'aria-hidden': 'true' }, 'Icd')];
  for (let p = first; p <= last; p++) {
    const glyph = [h('span', { class: `e e${(p - first) % 5}` }, 'e'), h('span', { class: 'n' }, String(p))];
    items.push(
      p === r.page
        ? h('li', null, h('span', { class: 'pg cur', 'aria-current': 'page', 'aria-label': `Page ${p}, current page` }, glyph))
        : h('li', null, h('a', { class: 'pg', href: link(p), 'aria-label': `Page ${p}` }, glyph)),
    );
  }
  items.push(h('li', { class: 'cap', 'aria-hidden': 'true' }, 'x'));
  return h(
    'nav',
    { class: 'pager', 'aria-label': 'Pagination' },
    r.page > 1 ? h('a', { class: 'pn', href: link(r.page - 1), rel: 'prev' }, '‹ Previous') : h('span', { class: 'pn off' }, ''),
    h('ol', null, items),
    r.page < r.pages ? h('a', { class: 'pn', href: link(r.page + 1), rel: 'next' }, 'Next ›') : h('span', { class: 'pn off' }, ''),
  );
}
