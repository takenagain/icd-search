// Hover / focus preview cards for code links. One shared card, keyboard accessible:
// it opens on focus, Escape closes it, and it stays open while the pointer is over it.
import { h, clear } from './h';
import { client } from '../client';
import type { Brief } from '../types';

let card: HTMLElement | null = null;
let anchor: HTMLElement | null = null;
let showTimer = 0;
let hideTimer = 0;
let token = 0;

function ensureCard(): HTMLElement {
  if (card) return card;
  card = h('div', { class: 'preview', id: 'code-preview', role: 'tooltip', hidden: true });
  card.addEventListener('mouseenter', () => clearTimeout(hideTimer));
  card.addEventListener('mouseleave', () => scheduleHide());
  document.body.appendChild(card);
  document.addEventListener('keydown', (e) => e.key === 'Escape' && hide());
  return card;
}

function hide() {
  clearTimeout(showTimer);
  clearTimeout(hideTimer);
  token++;
  if (card) card.hidden = true;
  anchor?.removeAttribute('aria-describedby');
  anchor = null;
}

function scheduleHide() {
  clearTimeout(showTimer);
  clearTimeout(hideTimer);
  hideTimer = window.setTimeout(hide, 180);
}

function fill(el: HTMLElement, b: Brief) {
  clear(el);
  const kind = b.kind === 'category' ? '' : b.kind === 'chapter' ? 'Chapter' : b.kind === 'block' ? 'Block' : 'Grouping';
  el.append(
    h('div', { class: 'pv-head' }, b.code ? h('span', { class: 'chip' }, b.code) : kind ? h('span', { class: 'chip alt' }, kind) : null, h('strong', null, b.title)),
    b.def ? h('p', { class: 'pv-def' }, b.def) : h('p', { class: 'pv-none' }, 'No description is given for this entry in the classification.'),
  );
}

function place(el: HTMLElement, a: HTMLElement) {
  const r = a.getBoundingClientRect();
  const w = Math.min(380, window.innerWidth - 16);
  el.style.width = `${w}px`;
  el.hidden = false;
  const hgt = el.offsetHeight;
  let left = Math.min(Math.max(8, r.left), window.innerWidth - w - 8);
  let top = r.bottom + 6;
  if (top + hgt > window.innerHeight - 8 && r.top - hgt - 6 > 8) top = r.top - hgt - 6;
  el.style.left = `${left + window.scrollX}px`;
  el.style.top = `${top + window.scrollY}px`;
}

async function show(a: HTMLElement, key: string) {
  const mine = ++token;
  const b = await client.brief(key);
  if (!b || mine !== token) return;
  const el = ensureCard();
  fill(el, b);
  anchor = a;
  a.setAttribute('aria-describedby', el.id);
  place(el, a);
}

export function attachPreview(a: HTMLElement, key: string): void {
  const open = () => {
    clearTimeout(hideTimer);
    clearTimeout(showTimer);
    showTimer = window.setTimeout(() => show(a, key), 220);
  };
  a.addEventListener('mouseenter', open);
  a.addEventListener('focus', open);
  a.addEventListener('mouseleave', scheduleHide);
  a.addEventListener('blur', () => scheduleHide());
}
