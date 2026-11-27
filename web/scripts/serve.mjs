// Production-faithful static server for tests and local checks: the same headers the container
// image sends (CSP, cache policy, precompressed .br/.gz, application/wasm, SPA fallback, /health).
// usage: node scripts/serve.mjs [--port 4173] [--dir ../dist] [--kbps N] [--latency MS]
// --kbps / --latency pace responses (used by scripts/measure-setup.mjs to emulate a mobile network).
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { resolve, dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { Transform } from 'node:stream';

const here = dirname(fileURLToPath(import.meta.url));
const { values } = parseArgs({ options: { port: { type: 'string', default: '4173' }, kbps: { type: 'string', default: '0' }, latency: { type: 'string', default: '0' }, dir: { type: 'string', default: resolve(here, '../../dist') } } });
const root = resolve(values.dir);

export const CSP = [
  "default-src 'none'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self'",
  "img-src 'self'",
  "connect-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join('; ');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.ndjson': 'application/x-ndjson',
  '.txt': 'text/plain; charset=utf-8', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};

function cacheControl(path) {
  if (path.startsWith('/assets/')) return 'public, max-age=31536000, immutable';
  if (/^\/data\/shard-\d+\.[0-9a-f]{10}\.ndjson/.test(path)) return 'public, max-age=31536000, immutable';
  if (path === '/data/manifest.json') return 'public, max-age=60, must-revalidate';
  return 'no-cache';
}

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const common = {
    'Content-Security-Policy': CSP,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  };
  if (url.pathname === '/health') {
    res.writeHead(200, { ...common, 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
    return res.end('ok\n');
  }
  let path = normalize(decodeURIComponent(url.pathname));
  if (path.includes('..')) return (res.writeHead(400), res.end());
  // Same routing as docker/sws.base.toml: the app's own routes answer index.html with 200 (codes contain dots,
  // /code/8B88.0, so routes match by prefix); any other missing path is a 404 whose body is index.html.
  const isRoute = path === '/search' || path === '/about' || /^\/(code|graph)\/.+/.test(path);
  let file = join(root, path);
  let status = 200;
  if (isRoute || !existsSync(file) || statSync(file).isDirectory()) {
    if (!isRoute && path !== '/' ) status = 404;
    path = '/index.html';
    file = join(root, path);
  }
  const type = MIME[extname(file)] ?? 'application/octet-stream';
  const headers = { ...common, 'Content-Type': type, 'Cache-Control': status === 200 ? cacheControl(path) : 'no-cache', Vary: 'Accept-Encoding' };
  let send = file;
  const ae = String(req.headers['accept-encoding'] ?? '');
  if (/\bbr\b/.test(ae) && existsSync(`${file}.br`)) (send = `${file}.br`, (headers['Content-Encoding'] = 'br'));
  else if (/\bgzip\b/.test(ae) && existsSync(`${file}.gz`)) (send = `${file}.gz`, (headers['Content-Encoding'] = 'gzip'));
  headers['Content-Length'] = statSync(send).size;
  res.writeHead(status, headers);
  if (req.method === 'HEAD') return res.end();
  const body = createReadStream(send);
  const kbps = Number(values.kbps);
  const latency = Number(values.latency);
  const start = () => (kbps > 0 ? body.pipe(pace(kbps)).pipe(res) : body.pipe(res));
  latency > 0 ? setTimeout(start, latency) : start();
});

// Token-bucket pacing per response: `kbps` kilobits per second.
function pace(kbps) {
  const bytesPerMs = (kbps * 1000) / 8 / 1000;
  const t0 = Date.now();
  let sent = 0;
  return new Transform({
    transform(chunk, _enc, cb) {
      sent += chunk.length;
      const wait = sent / bytesPerMs - (Date.now() - t0);
      wait > 1 ? setTimeout(() => cb(null, chunk), wait) : cb(null, chunk);
    },
  });
}

server.listen(Number(values.port), '127.0.0.1', () => console.log(`serving ${root} on http://127.0.0.1:${values.port}`));
