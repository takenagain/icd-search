import { h } from './h';
import { href, navigate } from '../router';
import { client } from '../client';
import { SearchBox } from './searchbox';
import type { Manifest } from '../types';

export function wordmark(big = false): HTMLElement {
  const letters = [['I', 'w1'], ['c', 'w2'], ['d', 'w3'], ['e', 'w4'], ['x', 'w5']];
  return h(
    'a',
    { class: big ? 'wordmark big' : 'wordmark', href: href.home(), 'aria-label': 'Icdex, ICD-11 search: home' },
    letters.map(([c, k]) => h('span', { class: k, 'aria-hidden': 'true' }, c)),
  );
}

export function footer(manifest?: Manifest): HTMLElement {
  const rel = manifest?.release ?? '2026-01';
  return h(
    'footer',
    { class: 'foot' },
    h(
      'p',
      null,
      'International Classification of Diseases, Eleventh Revision (ICD-11), World Health Organization (WHO) 2019 ',
      h('a', { href: 'https://icd.who.int/browse11', rel: 'noopener', target: '_blank' }, 'https://icd.who.int/browse11'),
      '. Licensed under the Creative Commons Attribution-NoDerivatives 3.0 IGO licence (',
      h('a', { href: 'https://creativecommons.org/licenses/by-nd/3.0/igo/', rel: 'noopener', target: '_blank' }, 'CC BY-ND 3.0 IGO'),
      '). MMS release ' + rel + ', English. WHO text is shown unmodified.',
    ),
    h(
      'p',
      null,
      'This is an independent site. It is not affiliated with, and is not endorsed by, the World Health Organization. ',
      h('a', { href: href.about() }, 'About, data version and licence'),
      ' · ',
      h('a', { href: 'https://icd.who.int/en/docs/icd11-license.pdf', rel: 'noopener', target: '_blank' }, 'WHO terms of use'),
    ),
  );
}

/** Compact top bar used on every page except the home page. */
export function topBar(query = ''): HTMLElement {
  const box = SearchBox({ value: query });
  return h(
    'header',
    { class: 'top' },
    wordmark(),
    box,
    h(
      'nav',
      { class: 'toplinks', 'aria-label': 'Site' },
      h('a', {
        href: '#',
        onClick: async (e: Event) => {
          e.preventDefault();
          const k = await client.randomKey();
          if (k) navigate(href.code(k));
        },
      }, 'Random'),
      h('a', { href: href.about() }, 'About'),
    ),
  );
}

export function page(cls: string, ...children: (Node | null)[]): HTMLElement {
  return h('div', { class: `page ${cls}` }, h('a', { class: 'skip', href: '#main' }, 'Skip to results'), ...children);
}

export function fmt(n: number): string {
  return n.toLocaleString('en');
}

export function bytes(n: number): string {
  return n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.round(n / 1024)} kB`;
}
