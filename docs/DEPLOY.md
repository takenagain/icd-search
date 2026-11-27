# Deploying Icdex

The site is static files. The image serves them with [static-web-server](https://static-web-server.net)
(one Rust binary, no shell, nothing written to disk). All search work happens in the visitor's browser.

## Summary for the deploy

| Item | Value |
|---|---|
| Image | `ghcr.io/takenagain/icd-search` (private); built by `.github/workflows/ci.yml`, pushed on `main`, reported by digest |
| Container port | **8080** (HTTP, IPv4 + IPv6) |
| Health path | **`GET` / `HEAD /health`** → `200 ok` (liveness and readiness) |
| Routing mode | **History API clean URLs**, explicit route rewrites to `/index.html` (below). No hash routing |
| User / fs | uid/gid **10001**, `readOnlyRootFilesystem: true`, no volumes, no writable paths |
| Memory | ~20 MB RSS while serving the e2e suite; request 32 Mi, limit 64 Mi. CPU is negligible (precompressed files) |
| TLS | Terminate at the ingress. The container speaks plain HTTP and sets no HSTS: add `Strict-Transport-Security` at the ingress |
| Domain | `https://icd.francoisvw.com` |
| Third-party requests at runtime | none (CSP enforces it) |

Suggested pod security context:

```yaml
securityContext:
  runAsNonRoot: true
  runAsUser: 10001
  runAsGroup: 10001
  readOnlyRootFilesystem: true
  allowPrivilegeEscalation: false
  capabilities: { drop: [ALL] }
  seccompProfile: { type: RuntimeDefault }
```

Local run: `docker run --rm -p 8080:8080 --read-only --cap-drop ALL --security-opt no-new-privileges ghcr.io/takenagain/icd-search:<tag>`

## Routing

Pages are real paths: `/`, `/search?q=…&p=2`, `/code/8B88.0`, `/graph/BA00`, `/about`. The server answers these with
`index.html` and status 200 and the client router takes over (`docker/sws.base.toml`, `[[advanced.rewrites]]`):

| Request | Response |
|---|---|
| `/`, `/search`, `/about`, `/code/**`, `/graph/**` | `index.html`, 200 |
| files that exist (`/assets/*`, `/data/*`, `/favicon.svg`) | the file |
| anything else | **404** with `index.html` as body (the app shows its own "Page not found") |

Codes contain dots (`/code/8B88.0`), so routes match by prefix, never by file extension. A generic "SPA fallback to
index.html on 404" at the ingress is **not** needed and would hide 404s for missing hashed assets: if the ingress
has its own routing rules, forward every path to the container unchanged.

## Headers (exact)

Content-Security-Policy, sent on every response:

```
default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'
```

`'wasm-unsafe-eval'` is required to instantiate the search engine's WebAssembly. There is no `unsafe-inline`: the app
sets no inline scripts or `style` attributes. Also sent everywhere: `X-Content-Type-Options: nosniff`,
`Referrer-Policy: no-referrer`, `Cross-Origin-Opener-Policy: same-origin`,
`Permissions-Policy: camera=(), microphone=(), geolocation=()`.

Caching:

| Path | `Cache-Control` | Why |
|---|---|---|
| `/assets/*` (hashed JS, CSS, WASM, SVG) | `public, max-age=31536000, immutable` | file name carries the content hash |
| `/data/shard-NNN.<sha10>.ndjson` | `public, max-age=31536000, immutable` | content-hashed dataset shards |
| `/data/manifest.json` | `public, max-age=60, must-revalidate` | how clients notice a new release |
| `/`, `index.html`, routes, `/favicon.svg`, 404s | `no-cache` | always revalidate; entry point to the hashed files |

The immutable rules are generated per exact file by `web/scripts/sws-config.mjs`, so a 404 for a hashed file that is
not in this build is never cacheable. (This server version cannot restrict a header rule to 2xx responses.)

Compression: every text asset has `.br` and `.gz` siblings built in `dist/` (`web/scripts/precompress.mjs`); the server
picks one from `Accept-Encoding` and sends `Content-Encoding` with the original `Content-Type`
(`application/wasm`, `application/x-ndjson`, …). Do not re-compress or strip `Content-Encoding` at the ingress. The
app measures progress in decoded bytes, so it works with or without transport compression.

## Releasing a new dataset or app version

`make build` regenerates `dist/` and `docker/sws.toml`. All hashed files get new names, `manifest.json` changes.
Clients that already stored an older dataset see the new `datasetId` on their next visit (manifest max-age 60 s),
show an update notice and re-download only the shards whose SHA-256 changed. Old hashed files need not be kept.

## Checks after deploy

```sh
curl -si https://icd.francoisvw.com/health                          # 200
curl -sI -H 'Accept-Encoding: br' https://icd.francoisvw.com/data/manifest.json   # max-age=60, content-encoding: br
curl -sI https://icd.francoisvw.com/code/8B88.0                     # 200, content-security-policy present
curl -sI https://icd.francoisvw.com/assets/nope.js                  # 404, cache-control: no-cache
```
