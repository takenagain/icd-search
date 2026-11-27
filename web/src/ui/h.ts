// Tiny DOM builder. Text always goes through text nodes (never innerHTML),
// and styling only through classes or CSSOM, so a strict CSP holds.

export type Child = Node | string | number | null | undefined | false | Child[];
export type Props = Record<string, unknown> | null;

function append(el: Node, c: Child): void {
  if (c === null || c === undefined || c === false) return;
  if (Array.isArray(c)) c.forEach((x) => append(el, x));
  else el.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
}

function apply(el: Element, props: Props): void {
  if (!props) return;
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.setAttribute('class', String(v));
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k === 'dataset') Object.assign((el as HTMLElement).dataset, v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props?: Props, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  apply(el, props ?? null);
  append(el, children);
  return el;
}

const SVG = 'http://www.w3.org/2000/svg';
export function s<K extends keyof SVGElementTagNameMap>(tag: K, props?: Props, ...children: Child[]): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG, tag);
  apply(el, props ?? null);
  append(el, children);
  return el;
}

/** `[plain, match, plain, ...]` from the engine -> text with <b> around matches. */
export function marked(parts: string[], tag: 'b' | 'em' = 'b'): DocumentFragment {
  const f = document.createDocumentFragment();
  parts.forEach((p, i) => {
    if (!p) return;
    f.appendChild(i % 2 ? h(tag, null, p) : document.createTextNode(p));
  });
  return f;
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}
