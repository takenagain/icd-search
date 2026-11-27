// History-API routing with clean URLs. The static server must answer unknown paths
// with index.html (404 fallback); see docs/DEPLOY.md.

export type Route =
  | { name: 'home' }
  | { name: 'search'; q: string; p: number }
  | { name: 'code'; key: string }
  | { name: 'graph'; key: string }
  | { name: 'about' }
  | { name: 'missing'; path: string };

export function parse(loc: { pathname: string; search: string }): Route {
  const path = loc.pathname.replace(/\/+$/, '') || '/';
  const qs = new URLSearchParams(loc.search);
  if (path === '/') return { name: 'home' };
  if (path === '/search') return { name: 'search', q: qs.get('q') ?? '', p: Math.max(1, parseInt(qs.get('p') ?? '1', 10) || 1) };
  if (path === '/about') return { name: 'about' };
  const m = /^\/(code|graph)\/(.+)$/.exec(path);
  if (m) return { name: m[1] as 'code' | 'graph', key: decodeURIComponent(m[2]) };
  return { name: 'missing', path };
}

export const href = {
  home: () => '/',
  search: (q: string, p = 1) => `/search?q=${encodeURIComponent(q)}${p > 1 ? `&p=${p}` : ''}`,
  code: (key: string) => `/code/${encodeURIComponent(key)}`,
  graph: (key: string) => `/graph/${encodeURIComponent(key)}`,
  about: () => '/about',
};

let handler: () => void = () => {};

export function onNavigate(fn: () => void): void {
  handler = fn;
  window.addEventListener('popstate', () => handler());
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as Element | null)?.closest?.('a');
    if (!a || a.target || a.hasAttribute('download') || a.origin !== location.origin) return;
    e.preventDefault();
    navigate(a.pathname + a.search + a.hash);
  });
}

export function navigate(url: string, replace = false): void {
  if (replace) history.replaceState(null, '', url);
  else history.pushState(null, '', url);
  handler();
}
