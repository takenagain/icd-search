// Search form with typeahead (ARIA combobox pattern).
import { h, clear } from './h';
import { client } from '../client';
import { href, navigate } from '../router';
import type { Suggestion } from '../types';

let uid = 0;

export function SearchBox(opts: { value?: string; big?: boolean; autofocus?: boolean }): HTMLElement {
  const id = `sb${++uid}`;
  const input = h('input', {
    id: `${id}-q`,
    class: 'q',
    type: 'search',
    name: 'q',
    value: opts.value ?? '',
    placeholder: 'Search diseases, symptoms, codes',
    autocomplete: 'off',
    autocapitalize: 'off',
    spellcheck: 'false',
    enterkeyhint: 'search',
    role: 'combobox',
    'aria-label': 'Search ICD-11',
    'aria-autocomplete': 'list',
    'aria-expanded': 'false',
    'aria-controls': `${id}-list`,
    autofocus: opts.autofocus,
  });
  const list = h('ul', { class: 'suggest', id: `${id}-list`, role: 'listbox', 'aria-label': 'Suggestions', hidden: true });
  const form = h(
    'form',
    { class: opts.big ? 'search big' : 'search', role: 'search', action: '/search', method: 'get' },
    h('div', { class: 'box' }, input, list),
    h('button', { class: 'btn go', type: 'submit' }, 'Search'),
  );

  let items: Suggestion[] = [];
  let active = -1;
  let seq = 0;
  let timer = 0;

  const close = () => {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    active = -1;
  };
  const choose = (s: Suggestion) => {
    close();
    if (s.kind === 'code') navigate(href.code(s.key));
    else {
      input.value = s.text;
      navigate(href.search(s.text));
    }
  };
  const mark = (i: number) => {
    active = i;
    [...list.children].forEach((li, n) => {
      li.setAttribute('aria-selected', String(n === i));
      li.classList.toggle('sel', n === i);
    });
    if (i >= 0) input.setAttribute('aria-activedescendant', `${id}-o${i}`);
    else input.removeAttribute('aria-activedescendant');
  };
  const show = (q: string) => {
    clear(list);
    if (!items.length) return close();
    items.forEach((s, i) => {
      const li = h(
        'li',
        { id: `${id}-o${i}`, role: 'option', 'aria-selected': 'false', onMousedown: (e: Event) => { e.preventDefault(); choose(s); } },
        s.kind === 'code' ? [h('span', { class: 'chip' }, s.text), h('span', { class: 'sub' }, s.title)] : [highlightPrefix(s.text, q)],
      );
      list.appendChild(li);
    });
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    active = -1;
  };

  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (!q) {
      items = [];
      return close();
    }
    timer = window.setTimeout(async () => {
      const mine = ++seq;
      try {
        const r = await client.suggest(q, 8);
        if (mine === seq && document.activeElement === input) {
          items = r;
          show(q);
        }
      } catch {
        close();
      }
    }, 70);
  });
  input.addEventListener('keydown', (e) => {
    if (list.hidden) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      mark((active + 1) % items.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      mark((active - 1 + items.length) % items.length);
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault();
      choose(items[active]);
    } else if (e.key === 'Escape') close();
  });
  input.addEventListener('blur', () => setTimeout(close, 100));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = input.value.trim();
    close();
    if (q) navigate(href.search(q));
  });
  return form;
}

/** Suggestion text with the part the user typed in normal weight and the rest bold. */
function highlightPrefix(text: string, q: string): DocumentFragment {
  const f = document.createDocumentFragment();
  if (text.toLowerCase().startsWith(q.toLowerCase())) {
    f.append(document.createTextNode(text.slice(0, q.length)), h('b', null, text.slice(q.length)));
  } else f.append(document.createTextNode(text));
  return f;
}
