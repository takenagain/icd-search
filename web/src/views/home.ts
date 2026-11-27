import { h } from '../ui/h';
import { SearchBox } from '../ui/searchbox';
import { footer, wordmark, page, fmt } from '../ui/shell';
import { client } from '../client';
import { href, navigate } from '../router';
import { state } from '../state';

export function homeView(): HTMLElement {
  const box = SearchBox({ big: true, autofocus: true });
  const random = h('button', {
    class: 'btn',
    type: 'button',
    onClick: async () => {
      const k = await client.randomKey();
      if (k) navigate(href.code(k));
    },
  }, 'Random code');
  box.appendChild(random);
  const m = state.manifest;
  return page(
    'home',
    h('header', { class: 'home-nav' }, h('nav', { 'aria-label': 'Site' }, h('a', { href: href.about() }, 'About'))),
    h(
      'main',
      { id: 'main', class: 'home-main' },
      wordmark(true),
      h('h1', { class: 'sr-only', tabindex: '-1' }, 'ICD-11 search'),
      box,
      h(
        'p',
        { class: 'tagline' },
        m ? `Search ${fmt(m.entities)} entries of ICD-11 MMS (${m.release}). It all runs on this device.` : 'Search ICD-11 MMS. It all runs on this device.',
      ),
    ),
    footer(m),
  );
}
