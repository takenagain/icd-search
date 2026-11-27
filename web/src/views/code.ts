import { h } from '../ui/h';
import { client } from '../client';
import { footer, page, topBar, fmt } from '../ui/shell';
import { href } from '../router';
import { attachPreview } from '../ui/preview';
import { state, uri, whoUrl } from '../state';
import { anatomyFor, anatomyFigure } from '../anatomy/anatomy';
import type { Brief, Detail, LinkItem } from '../types';

const kindLabel = (d: { kind: string; code: string }) => (d.kind === 'chapter' ? `Chapter ${d.code}` : d.kind === 'block' ? 'Block' : d.kind === 'window' ? 'Grouping' : 'Code');

export async function codeView(key: string): Promise<{ el: HTMLElement; title: string }> {
  const d = await client.detail(key);
  if (!d) {
    const el = page(
      'code-page',
      topBar(),
      h('main', { id: 'main', class: 'code-main' }, h('h1', { tabindex: '-1' }, 'Code not found'), h('p', null, h('code', null, key), ' is not in ICD-11 MMS ', state.manifest?.release ?? '', '.'), h('p', null, h('a', { href: href.home() }, 'Back to search'))),
      footer(state.manifest),
    );
    return { el, title: 'Not found - Icdex' };
  }
  client.seedBriefs([...d.children.items, ...d.siblings.items, ...d.seeAlso, ...(d.parent ? [d.parent] : [])]);

  const head = h(
    'div',
    { class: 'code-head' },
    h('div', { class: 'kindline' }, h('span', { class: d.code ? 'chip big' : 'chip alt big' }, d.code || kindLabel(d)), d.code ? null : null, d.kind === 'category' ? null : h('span', { class: 'kind' }, d.kind === 'chapter' ? '' : d.codeRange ?? d.blockId ?? '')),
    h('h1', { tabindex: '-1' }, d.title),
    d.fullySpecifiedName ? h('p', { class: 'fsn' }, h('span', { class: 'lbl' }, 'Fully specified name'), ' ', d.fullySpecifiedName) : null,
    h(
      'p',
      { class: 'links' },
      h('a', { href: whoUrl(d.id), target: '_blank', rel: 'noopener' }, 'Open in the WHO ICD-11 browser'),
      ' · ',
      h('a', { href: href.graph(d.key) }, 'Explore as a graph'),
    ),
  );

  const crumbs = h(
    'nav',
    { class: 'crumbs', 'aria-label': 'Classification path' },
    h('ol', null, d.path.map((b) => h('li', null, h('a', { href: href.code(b.key) }, b.code && b.kind === 'chapter' ? `${b.code} ${b.title}` : b.title)))),
  );

  const main = h('div', { class: 'col-main' });
  if (d.definition) main.append(h('section', { class: 'def' }, h('h2', null, 'Definition'), h('p', null, d.definition)));
  if (d.longDefinition) main.append(h('section', { class: 'def' }, h('details', null, h('summary', null, 'Long definition'), h('p', { class: 'pre' }, d.longDefinition))));
  if (d.codingNote) main.append(h('section', { class: 'note' }, h('h2', null, 'Coding note'), h('p', { class: 'pre' }, d.codingNote)));
  if (d.inclusions.length) main.append(linkSection('Inclusions', d.inclusions));
  if (d.exclusions.length) main.append(linkSection('Exclusions', d.exclusions, 'These conditions are classified elsewhere.'));
  if (d.indexTerms.length) main.append(h('section', null, h('h2', null, `Index terms (${d.indexTerms.length})`), terms(d.indexTerms)));
  if (d.codedElsewhere.length) main.append(linkSection('Coded elsewhere', d.codedElsewhere, 'Conditions that belong here in the foundation but are coded in another place.'));
  if (d.axes.length) main.append(axesSection(d));
  if (d.seeAlso.length) main.append(relSection('See also', d.seeAlso, d.seeAlso.length, 'Related entries in the maternal and perinatal chapters.'));
  if (d.relatedImpairment.length) main.append(h('section', null, h('h2', null, 'Related impairments'), terms(d.relatedImpairment)));
  if (d.parent) main.append(relSection('Parent', [d.parent], 1));
  if (d.children.total) main.append(relSection('Children', d.children.items, d.children.total, undefined, 12));
  if (d.siblings.total) main.append(relSection('Siblings', d.siblings.items, d.siblings.total, 'Other entries under the same parent.', 8));

  const side = h('aside', { class: 'col-side', 'aria-label': 'Visual explorers' });
  const ana = anatomyFor(d);
  if (ana) side.append(anatomyFigure(ana));
  side.append(
    h(
      'section',
      { class: 'card' },
      h('h2', null, 'Identifiers'),
      h('dl', null, h('dt', null, 'Code'), h('dd', null, d.code || 'none (grouping)'), h('dt', null, 'Title'), h('dd', null, d.title), h('dt', null, 'URI'), h('dd', null, h('code', { class: 'uri' }, uri(d.id)))),
    ),
  );

  const el = page('code-page', topBar(), h('main', { id: 'main', class: 'code-main' }, crumbs, head, h('div', { class: 'cols' }, main, side)), footer(state.manifest));
  return { el, title: `${d.code ? d.code + ' ' : ''}${d.title} - Icdex` };
}

function terms(list: string[]): HTMLElement {
  return h('ul', { class: 'terms' }, list.map((t) => h('li', null, t)));
}

function row(b: Brief, label?: string): HTMLElement {
  const a = h('a', { class: 'rel-link', href: href.code(b.key) }, b.code ? h('span', { class: 'chip' }, b.code) : h('span', { class: 'chip alt' }, b.kind === 'chapter' ? 'Chapter' : b.kind === 'block' ? 'Block' : 'Group'), ' ', label ?? b.title);
  attachPreview(a, b.key);
  return h('li', { class: 'rel' }, a, b.def ? h('div', { class: 'desc' }, b.def) : null);
}

function relSection(title: string, items: Brief[], total: number, hint?: string, initial = 1000): HTMLElement {
  const ul = h('ul', { class: 'rels' }, items.map((b, i) => {
    const li = row(b);
    if (i >= initial) li.hidden = true;
    return li;
  }));
  const sec = h('section', { class: 'related', 'data-section': title.toLowerCase() }, h('h2', null, `${title} `, h('span', { class: 'count' }, fmt(total))), hint ? h('p', { class: 'hint' }, hint) : null, ul);
  if (items.length > initial) {
    const btn = h('button', { class: 'btn small', type: 'button', 'aria-expanded': 'false' }, `Show all ${fmt(items.length)}`);
    btn.addEventListener('click', () => {
      [...ul.children].forEach((li) => ((li as HTMLElement).hidden = false));
      btn.remove();
    });
    sec.append(btn);
  }
  if (total > items.length) sec.append(h('p', { class: 'hint' }, `Showing the first ${fmt(items.length)} of ${fmt(total)}.`));
  return sec;
}

function linkSection(title: string, items: LinkItem[], hint?: string): HTMLElement {
  return h(
    'section',
    { class: 'related', 'data-section': title.toLowerCase() },
    h('h2', null, `${title} `, h('span', { class: 'count' }, String(items.length))),
    hint ? h('p', { class: 'hint' }, hint) : null,
    h('ul', { class: 'rels' }, items.map((i) => (i.target ? row(i.target, i.label) : h('li', { class: 'rel plain' }, i.label)))),
  );
}

function axesSection(d: Detail): HTMLElement {
  return h(
    'section',
    { class: 'axes' },
    h('h2', null, 'Postcoordination'),
    h('p', { class: 'hint' }, 'Axes along which this code can be combined with extension codes.'),
    h(
      'table',
      null,
      h('thead', null, h('tr', null, h('th', null, 'Axis'), h('th', null, 'Required'), h('th', null, 'Multiple values'), h('th', null, 'Values'))),
      h(
        'tbody',
        null,
        d.axes.map((a) =>
          h(
            'tr',
            null,
            h('th', { scope: 'row' }, a.axis),
            h('td', null, a.required ? 'yes' : 'no'),
            h('td', null, a.multiple === 'NotAllowed' ? 'no' : 'yes'),
            h('td', null, h('ul', { class: 'inline' }, a.values.slice(0, 8).map((v) => {
              const l = h('a', { href: href.code(v.key) }, v.code ? `${v.code} ${v.title}` : v.title);
              attachPreview(l, v.key);
              return h('li', null, l);
            }), a.total > 8 ? h('li', { class: 'more' }, `+${a.total - 8} more`) : null)),
          ),
        ),
      ),
    ),
  );
}
