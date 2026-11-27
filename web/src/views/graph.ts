// Force-directed neighbourhood graph of a code. Hierarchy edges are solid; cross-references use
// distinct dash styles. Click a node to re-centre on it; the "+" handle (or the E key) expands in place.
import { h, s, clear } from '../ui/h';
import { client } from '../client';
import { footer, page, topBar } from '../ui/shell';
import { href, navigate } from '../router';
import { state } from '../state';
import type { Brief, Neighbors } from '../types';

type EdgeType = 'hier' | 'exclusion' | 'coded_elsewhere' | 'inclusion' | 'see_also';

interface GNode {
  key: string;
  code: string;
  title: string;
  kind: Brief['kind'] | 'more';
  x: number;
  y: number;
  vx: number;
  vy: number;
  w: number;
  shown: number; // children already added
  total: number; // children in the data
  more?: string; // for "+N more": key of the node it extends
  g?: SVGGElement;
}
interface GEdge {
  a: string;
  b: string;
  type: EdgeType;
  line?: SVGLineElement;
}

const PAGE = 24;
const MAX_NODES = 320;
const REST: Record<EdgeType, number> = { hier: 95, exclusion: 170, coded_elsewhere: 170, inclusion: 150, see_also: 170 };
const LEGEND: [EdgeType, string][] = [
  ['hier', 'Hierarchy (parent to child)'],
  ['exclusion', 'Exclusion'],
  ['coded_elsewhere', 'Coded elsewhere'],
  ['see_also', 'See also'],
  ['inclusion', 'Inclusion'],
];

export async function graphView(centerKey: string): Promise<{ el: HTMLElement; title: string; cleanup: () => void }> {
  const firstOrNull = await client.neighbors(centerKey, PAGE);
  if (!firstOrNull) {
    const el = page('code-page', topBar(), h('main', { id: 'main', class: 'code-main' }, h('h1', { tabindex: '-1' }, 'Code not found'), h('p', null, h('a', { href: href.home() }, 'Back to search'))), footer(state.manifest));
    return { el, title: 'Not found - Icdex', cleanup: () => {} };
  }
  const first: Neighbors = firstOrNull;

  const nodes = new Map<string, GNode>();
  const edges: GEdge[] = [];
  const edgeKey = new Set<string>();
  let raf = 0;
  let alpha = 1;
  let selected: string | null = null;

  const svg = s('svg', { class: 'graph', role: 'group', 'aria-label': `Graph around ${first.center.title}`, preserveAspectRatio: 'xMidYMid meet' });
  const marker = s('defs', null, s('marker', { id: 'arrow', viewBox: '0 0 10 10', refX: '9', refY: '5', markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse' }, s('path', { d: 'M0 0L10 5L0 10z', class: 'arrowhead' })));
  const vp = s('g', { class: 'viewport' });
  const edgeLayer = s('g', { class: 'edges' });
  const nodeLayer = s('g', { class: 'nodes' });
  vp.append(edgeLayer, nodeLayer);
  svg.append(marker, vp);

  const info = h('div', { class: 'ginfo', 'aria-live': 'polite' });
  const status = h('p', { class: 'hint', role: 'status' });

  let W = 900;
  let H = 560;
  let tx = 0;
  let ty = 0;
  let k = 1;
  const applyView = () => vp.setAttribute('transform', `translate(${W / 2 + tx} ${H / 2 + ty}) scale(${k})`);
  const setSize = () => {
    const r = svg.getBoundingClientRect();
    if (r.width) {
      W = r.width;
      H = r.height;
      svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
      applyView();
    }
  };

  const label = (n: GNode) => (n.kind === 'more' ? n.title : n.title.length > 30 ? `${n.title.slice(0, 29)}…` : n.title);

  const addNode = (b: Brief, near: GNode | null, angle: number, dist: number): GNode => {
    const have = nodes.get(b.key);
    if (have) return have;
    const n: GNode = {
      key: b.key,
      code: b.code,
      title: b.title,
      kind: b.kind,
      x: (near?.x ?? 0) + Math.cos(angle) * dist,
      y: (near?.y ?? 0) + Math.sin(angle) * dist,
      vx: 0,
      vy: 0,
      w: 0,
      shown: 0,
      total: 0,
    };
    n.w = Math.max(84, Math.min(210, 6.4 * Math.max(label(n).length, n.code.length + 2) + 22));
    nodes.set(n.key, n);
    drawNode(n);
    return n;
  };

  const addEdge = (a: string, b: string, type: EdgeType) => {
    const id = `${type}|${a}|${b}`;
    if (edgeKey.has(id) || a === b) return;
    edgeKey.add(id);
    const e: GEdge = { a, b, type };
    e.line = s('line', { class: `edge ${type}`, 'marker-end': type === 'hier' ? 'url(#arrow)' : null });
    edgeLayer.appendChild(e.line);
    edges.push(e);
  };

  function drawNode(n: GNode) {
    const g = s('g', {
      class: `gnode k-${n.kind}`,
      tabindex: '0',
      role: 'link',
      'data-key': n.key,
      'aria-label': n.kind === 'more' ? `Show more: ${n.title}` : `${n.code || n.kind} ${n.title}. Enter opens its graph, E expands it.`,
    });
    const rect = s('rect', { x: String(-n.w / 2), y: '-16', width: String(n.w), height: '32', rx: '6' });
    const t1 = s('text', { class: 'c', y: n.code ? '-3' : '4', 'text-anchor': 'middle' }, n.kind === 'more' ? '' : n.code);
    const t2 = s('text', { class: 't', y: n.code ? '10' : '4', 'text-anchor': 'middle' }, label(n));
    g.append(s('title', null, n.kind === 'more' ? n.title : `${n.code ? n.code + ' ' : ''}${n.title}`), rect, t1, t2);
    if (n.kind !== 'more') {
      const ex = s('g', { class: 'exp', role: 'button', tabindex: '-1', 'aria-label': `Expand neighbours of ${n.title}`, transform: `translate(${n.w / 2 - 2} -16)` }, s('circle', { r: '9' }), s('path', { d: 'M-4 0H4M0 -4V4' }));
      ex.addEventListener('click', (e) => {
        e.stopPropagation();
        void expand(n.key);
      });
      g.append(ex);
    }
    g.addEventListener('click', () => (n.kind === 'more' ? void expand(n.more!) : navigate(href.graph(n.key))));
    g.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') (e.preventDefault(), n.kind === 'more' ? void expand(n.more!) : navigate(href.graph(n.key)));
      else if ((e.key === 'e' || e.key === '+') && n.kind !== 'more') void expand(n.key);
    });
    const select = () => void describe(n);
    g.addEventListener('mouseenter', select);
    g.addEventListener('focus', select);
    n.g = g;
    nodeLayer.appendChild(g);
  }

  async function describe(n: GNode) {
    if (n.kind === 'more') return;
    selected = n.key;
    const b = await client.brief(n.key);
    if (selected !== n.key || !b) return;
    clear(info);
    info.append(
      h('div', { class: 'pv-head' }, b.code ? h('span', { class: 'chip' }, b.code) : null, h('strong', null, b.title)),
      b.def ? h('p', null, b.def) : h('p', { class: 'hint' }, 'No description is given for this entry.'),
      h('p', null, h('a', { href: href.code(b.key) }, 'Open code page'), ' · ', h('a', { href: href.graph(b.key) }, 'Centre graph here')),
    );
  }

  async function expand(key: string) {
    const n = nodes.get(key);
    if (!n) return;
    if (nodes.size >= MAX_NODES) {
      status.textContent = `Showing ${nodes.size} nodes, the most this view draws. Open a node to start from there.`;
      return;
    }
    const want = n.shown + PAGE;
    const nb = key === first.center.key && n.shown === 0 ? first : await client.neighbors(key, want);
    if (nb) merge(n, nb);
  }

  function merge(n: GNode, nb: Neighbors) {
    // Deterministic starting layout (parent above, children in a grid below, cross-references
    // left and right); the force simulation then only relaxes overlaps.
    if (nb.parent && !nodes.has(nb.parent.key)) {
      const p = addNode(nb.parent, n, 0, 0);
      p.x = n.x;
      p.y = n.y - 105;
      addEdge(p.key, n.key, 'hier');
    } else if (nb.parent) addEdge(nb.parent.key, n.key, 'hier');
    const fresh = nb.children.items.slice(n.shown);
    const cols = Math.min(fresh.length || 1, nb.children.items.length > 8 ? 4 : 3);
    fresh.forEach((c, j) => {
      const node = addNode(c, n, 0, 0);
      const col = j % cols;
      const row = Math.floor(j / cols);
      node.x = n.x + (col - (cols - 1) / 2) * 232;
      node.y = n.y + 105 + (n.shown ? Math.ceil(n.shown / cols) * 52 : 0) + row * 52;
      addEdge(n.key, node.key, 'hier');
    });
    n.shown = nb.children.items.length;
    n.total = nb.children.total;
    const moreKey = `more:${n.key}`;
    const old = nodes.get(moreKey);
    if (old) {
      old.g?.remove();
      nodes.delete(moreKey);
      for (let e = edges.length - 1; e >= 0; e--) if (edges[e].b === moreKey || edges[e].a === moreKey) (edges[e].line?.remove(), edges.splice(e, 1));
    }
    if (n.total > n.shown) {
      const m = addNode({ key: moreKey, code: '', title: `+${n.total - n.shown} more`, kind: 'category' }, n, 0, 0);
      m.kind = 'more';
      m.more = n.key;
      m.g?.setAttribute('class', 'gnode k-more');
      m.x = n.x;
      m.y = n.y + 105 + Math.ceil(n.shown / cols) * 52;
      addEdge(n.key, moreKey, 'hier');
    }
    let side = 0;
    nb.refs.forEach((r) => {
      const had = nodes.has(r.node.key);
      const node = addNode(r.node, n, 0, 0);
      if (!had) {
        const left = side % 2 === 0;
        node.x = n.x + (left ? -1 : 1) * (cols * 116 + 150);
        node.y = n.y - 70 + Math.floor(side / 2) * 54;
        side++;
      }
      addEdge(n.key, node.key, r.rel);
    });
    status.textContent = `${nodes.size} nodes`;
    alpha = 0.6;
    kick();
  }

  // ---- force simulation ----
  function tick() {
    const list = [...nodes.values()];
    const cx = nodes.get(first.center.key);
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 0.01) (dx = Math.random() - 0.5, dy = Math.random() - 0.5, d2 = 0.5);
        // boxes must not overlap: separate along the axis of least penetration
        const ox = (a.w + b.w) / 2 + 14 - Math.abs(dx);
        const oy = 32 + 12 - Math.abs(dy);
        if (ox > 0 && oy > 0) {
          if (ox < oy) {
            const m = (dx >= 0 ? 1 : -1) * ox * 0.5;
            a.x += m;
            b.x -= m;
          } else {
            const m = (dy >= 0 ? 1 : -1) * oy * 0.5;
            a.y += m;
            b.y -= m;
          }
          continue;
        }
        if (d2 > 90000) continue;
        const d = Math.sqrt(d2);
        const f = (1800 * alpha) / d2;
        const fx = (dx / d) * f;
        const fy = (dy / d) * f;
        a.vx += fx;
        a.vy += fy;
        b.vx -= fx;
        b.vy -= fy;
      }
    }
    for (const e of edges) {
      const a = nodes.get(e.a);
      const b = nodes.get(e.b);
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.hypot(dx, dy) || 1;
      const f = (d - REST[e.type]) * 0.012 * alpha;
      const fx = (dx / d) * f;
      const fy = (dy / d) * f;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    }
    let energy = 0;
    for (const n of list) {
      n.vx -= n.x * 0.0008 * alpha;
      n.vy -= n.y * 0.0008 * alpha;
      n.vx *= 0.82;
      n.vy *= 0.82;
      if (n === cx) (n.vx *= 0.2, n.vy *= 0.2);
      n.x += Math.max(-30, Math.min(30, n.vx));
      n.y += Math.max(-30, Math.min(30, n.vy));
      energy += n.vx * n.vx + n.vy * n.vy;
    }
    alpha = Math.max(0.02, alpha * 0.985);
    paint();
    return energy / Math.max(1, list.length);
  }

  function paint() {
    for (const n of nodes.values()) n.g?.setAttribute('transform', `translate(${n.x.toFixed(1)} ${n.y.toFixed(1)})`);
    for (const e of edges) {
      const a = nodes.get(e.a);
      const b = nodes.get(e.b);
      if (!a || !b || !e.line) continue;
      // stop the line at the node's box edge so arrowheads are visible
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const clip = (n: GNode) => {
        const tx2 = Math.abs(dx) > 0.001 ? n.w / 2 / Math.abs(dx) : Infinity;
        const ty2 = Math.abs(dy) > 0.001 ? 16 / Math.abs(dy) : Infinity;
        return Math.min(tx2, ty2, 1);
      };
      const ta = clip(a);
      const tb = clip(b);
      e.line.setAttribute('x1', (a.x + dx * ta).toFixed(1));
      e.line.setAttribute('y1', (a.y + dy * ta).toFixed(1));
      e.line.setAttribute('x2', (b.x - dx * tb).toFixed(1));
      e.line.setAttribute('y2', (b.y - dy * tb).toFixed(1));
    }
  }

  let ticks = 0;
  function loop() {
    raf = 0;
    const e = tick();
    ticks++;
    if (ticks === 90) fit();
    if (e > 0.02 && ticks < 500) raf = requestAnimationFrame(loop);
    else if (ticks <= 500) fit();
  }
  function kick() {
    ticks = Math.min(ticks, 300);
    if (!raf) raf = requestAnimationFrame(loop);
  }

  function fit() {
    if (!nodes.size) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of nodes.values()) {
      x0 = Math.min(x0, n.x - n.w / 2);
      x1 = Math.max(x1, n.x + n.w / 2);
      y0 = Math.min(y0, n.y - 20);
      y1 = Math.max(y1, n.y + 20);
    }
    k = Math.min(1.4, Math.max(0.25, Math.min((W - 40) / (x1 - x0), (H - 40) / (y1 - y0))));
    tx = -((x0 + x1) / 2) * k;
    ty = -((y0 + y1) / 2) * k;
    applyView();
  }

  // ---- pan / zoom ----
  let drag: { x: number; y: number; tx: number; ty: number } | null = null;
  svg.addEventListener('pointerdown', (e) => {
    if ((e.target as Element).closest('.gnode')) return;
    drag = { x: e.clientX, y: e.clientY, tx, ty };
    svg.setPointerCapture(e.pointerId);
  });
  svg.addEventListener('pointermove', (e) => {
    if (!drag) return;
    tx = drag.tx + e.clientX - drag.x;
    ty = drag.ty + e.clientY - drag.y;
    applyView();
  });
  svg.addEventListener('pointerup', () => (drag = null));
  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    k = Math.max(0.2, Math.min(3, k * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
    applyView();
  }, { passive: false });

  const zoomBtn = (txt: string, lbl: string, fn: () => void) => h('button', { class: 'btn small', type: 'button', 'aria-label': lbl, onClick: fn }, txt);
  const legend = h(
    'ul',
    { class: 'legend', 'aria-label': 'Edge styles' },
    LEGEND.map(([t, text]) => h('li', null, (() => { const sw = s('svg', { width: '36', height: '10', 'aria-hidden': 'true' }, s('line', { x1: '0', y1: '5', x2: '36', y2: '5', class: `edge ${t}` })); return sw; })(), ` ${text}`)),
  );

  const centerBrief = first.center;
  const el = page(
    'graph-page',
    topBar(),
    h(
      'main',
      { id: 'main', class: 'graph-main' },
      h('nav', { class: 'crumbs', 'aria-label': 'Back' }, h('ol', null, h('li', null, h('a', { href: href.code(centerBrief.key) }, '‹ Code page')), h('li', null, 'Graph'))),
      h('h1', { tabindex: '-1' }, centerBrief.code ? `${centerBrief.code} ` : '', centerBrief.title),
      h('p', { class: 'hint' }, 'Click a node to centre the graph on it. Use the + handle (or press E on a focused node) to expand its neighbours. Drag to pan, scroll to zoom.'),
      h('div', { class: 'graph-tools' }, zoomBtn('+', 'Zoom in', () => ((k = Math.min(3, k * 1.25)), applyView())), zoomBtn('−', 'Zoom out', () => ((k = Math.max(0.2, k / 1.25)), applyView())), zoomBtn('Fit', 'Fit graph to view', fit), status),
      h('div', { class: 'graph-wrap' }, svg, info),
      legend,
    ),
    footer(state.manifest),
  );

  // Build after layout so the SVG has a size.
  const start = () => {
    setSize();
    const c = addNode(first.center, null, 0, 0);
    c.g?.classList.add('center');
    merge(c, first);
    void describe(c);
  };
  const ro = new ResizeObserver(() => setSize());
  queueMicrotask(() => {
    ro.observe(svg);
    requestAnimationFrame(start);
  });

  return {
    el,
    title: `Graph: ${centerBrief.code ? centerBrief.code + ' ' : ''}${centerBrief.title} - Icdex`,
    cleanup: () => {
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
    },
  };
}
