import { client } from '../client';
import { href } from '../router';
import type { BrowseEntry } from '../types';
import { h } from './h';
import { fmt } from './shell';

/** One browser panel is kept across page navigations so the open folders stay in place. */
export function browseSidebar() {
  const el = h('aside', { class: 'browse', 'aria-label': 'Browse ICD-11' });
  const filter = h('input', {
    class: 'browse-filter', type: 'search', 'aria-label': 'Filter by title or code',
    placeholder: 'Filter by title or code', autocomplete: 'off', maxlength: '120',
  });
  const folders = h('input', { type: 'checkbox' });
  const tree = h('ul', { class: 'browse-list browse-tree', 'aria-label': 'Chapters' });
  const matches = h('ul', { class: 'browse-list browse-matches', 'aria-label': 'Filter results', hidden: true });
  const scroll = h('div', { class: 'browse-scroll' }, tree, matches);
  const status = h('p', { class: 'browse-status', role: 'status' }, 'Loading chapters…');
  const toggle = h(
    'button',
    { class: 'browse-toggle', type: 'button', 'aria-expanded': 'false', 'aria-controls': 'browse-body' },
    'Browse ICD-11', h('span', { class: 'browse-chevron', 'aria-hidden': 'true' }),
  );
  toggle.addEventListener('click', () => {
    toggle.setAttribute('aria-expanded', String(toggle.getAttribute('aria-expanded') !== 'true'));
  });
  el.append(
    h('h2', { class: 'browse-title' }, 'Browse ICD-11'),
    toggle,
    h('div', { id: 'browse-body', class: 'browse-body' },
      h('div', { class: 'browse-controls' }, filter, h('label', { class: 'browse-folders' }, folders, 'Folders only')),
      status,
      scroll,
    ),
  );

  let rootStatus = 'Loading chapters…';
  let currentPath: string | null = null;
  let branchId = 0;
  let filterSeq = 0;
  let filterTimer = 0;

  function entryLink(entry: BrowseEntry): HTMLAnchorElement {
    const path = href.code(entry.key);
    return h('a', { class: 'browse-entry', href: path, 'aria-current': path === currentPath ? 'page' : null },
      h('span', { class: 'browse-label' }, entry.code ? h('span', { class: 'browse-code' }, entry.code) : null, entry.code ? ' ' : null, entry.title),
    );
  }

  function treeRow(entry: BrowseEntry): HTMLLIElement {
    const link = entryLink(entry);
    if (!entry.hasChildren) {
      return h('li', { class: 'browse-leaf' }, h('div', { class: 'browse-row' }, h('span', { 'aria-hidden': 'true' }), link));
    }

    const children = h('ul', { class: 'browse-list browse-children', id: `browse-branch-${++branchId}`, hidden: true });
    const disclosure = h('button', {
      class: 'browse-disclosure', type: 'button', 'aria-label': `Expand ${entry.title}`,
      'aria-expanded': 'false', 'aria-controls': children.id,
    }, h('span', { class: 'browse-chevron', 'aria-hidden': 'true' }));
    let loaded = false;
    let loading = false;
    disclosure.addEventListener('click', async () => {
      const open = children.hidden;
      children.hidden = !open;
      disclosure.setAttribute('aria-expanded', String(open));
      disclosure.setAttribute('aria-label', `${open ? 'Collapse' : 'Expand'} ${entry.title}`);
      if (!open || loaded || loading) return;
      loading = true;
      children.setAttribute('aria-busy', 'true');
      children.replaceChildren(h('li', { class: 'browse-caption' }, 'Loading…'));
      try {
        const entries = await client.browseChildren(entry.key);
        children.replaceChildren(...entries.map(treeRow));
        loaded = true;
      } catch {
        children.replaceChildren(h('li', { class: 'browse-caption' }, 'Could not open this folder. Close it and try again.'));
      } finally {
        loading = false;
        children.removeAttribute('aria-busy');
      }
    });
    return h('li', null, h('div', { class: 'browse-row' }, disclosure, link), children);
  }

  function updateFilter() {
    const query = filter.value.trim();
    const foldersOnly = folders.checked;
    const seq = ++filterSeq;
    window.clearTimeout(filterTimer);
    el.classList.toggle('folders-only', foldersOnly);
    tree.hidden = Boolean(query);
    matches.hidden = !query;
    matches.replaceChildren();
    scroll.scrollTop = 0;
    status.textContent = query ? 'Filtering…' : rootStatus;
    if (!query) return;

    filterTimer = window.setTimeout(async () => {
      try {
        const { items, total } = await client.filterBrowse(query, foldersOnly);
        if (seq !== filterSeq) return;
        status.textContent = total === 0 ? 'No matching entries' : total > items.length
          ? `Showing ${fmt(items.length)} of ${fmt(total)} matches`
          : `${fmt(total)} ${total === 1 ? 'match' : 'matches'}`;
        matches.replaceChildren(...items.map((entry) => h('li', null, entryLink(entry),
          entry.chapter ? h('p', { class: 'browse-caption' }, entry.chapter) : null,
        )));
      } catch {
        if (seq === filterSeq) status.textContent = 'Could not filter the entries. Try again.';
      }
    }, 100);
  }

  filter.addEventListener('input', updateFilter);
  folders.addEventListener('change', updateFilter);
  void client.browseChildren().then((entries) => {
    tree.replaceChildren(...entries.map(treeRow));
    rootStatus = `${fmt(entries.length)} chapters`;
  }).catch(() => {
    rootStatus = 'Could not open the chapter list.';
  }).finally(() => {
    if (!tree.hidden) status.textContent = rootStatus;
  });

  return {
    el,
    scroll,
    select(key?: string) {
      currentPath = key === undefined ? null : href.code(key);
      if (key !== undefined) toggle.setAttribute('aria-expanded', 'false');
      for (const link of el.querySelectorAll('a')) {
        if (link.getAttribute('href') === currentPath) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
      }
    },
  };
}
