# ICD-11 MMS extractor

Walks the whole ICD-11 MMS linearization from a WHO ICD-API and writes the
compact dataset in `data/icd11-mms-2026-01/`. Zero dependencies (Node >= 20).

```sh
podman start icd-codes-who-api            # local WHO container, http://127.0.0.1:8111, no auth
node tools/extract/extract.mjs            # ~8 min the first time; seconds with a warm cache
node tools/extract/extract.mjs --offline  # rebuild the dataset from the cache only
```

Options: `--api URL`, `--release 2026-01`, `--lang en`, `--out DIR`, `--cache DIR`,
`--concurrency 8`, `--max-rps 60`, `--shard-bytes 2500000`, `--offline`.

## Request rate and resume

* One GET per entity (`/icd/release/11/<release>/mms/<id>`), `API-Version: v2`,
  `Accept-Language: <lang>`, no auth (local container). About 37,200 requests.
* A global token bucket caps request starts at `--max-rps` (default 60/s) and at most
  `--concurrency` (default 8) are in flight. The local container sustains ~80 req/s;
  the 2026-01 run took about 8 minutes. Against WHO's cloud API use a lower rate
  and an OAuth token (not implemented: the local container is the supported source).
* Retries: network errors, HTTP 429 and 5xx back off exponentially (250 ms * 2^n,
  `Retry-After` honoured), 6 attempts. Any other non-200 aborts the run: a failed
  request is never treated as "code missing".
* Every raw response is cached as `.cache/who-api/<release>_<lang>/<id>.json`
  (written atomically, `/` in ids becomes `__`). **Resume = run it again**: cached
  entities are read from disk, only missing ones hit the network. Delete the
  cache directory to force a fresh crawl.

## Output

`dataset.json` (schema, release, counts, per-shard `sha256`/`bytes`/`lines`, key census,
unresolved-link counts) and `shard-NNN.ndjson`: one JSON record per line, depth-first
pre-order (chapters contiguous), ~2.5 MB per shard. Text fields are WHO's text verbatim.

| key | meaning |
| --- | --- |
| `id` | WHO entity id (`257068234`, residual categories `761947693/other`) |
| `c` | ICD-11 code (empty for blocks and windows) |
| `k` | `chapter`, `block`, `category` or `window` |
| `t`, `d`, `ld`, `fn` | title, definition, long definition, fully specified name (when it differs) |
| `inc`, `exc`, `ce` | inclusions, exclusions, coded elsewhere: `[label]` or `[label, targetEntityId]` |
| `ix` | index terms and synonyms |
| `see` | related entities in the maternal / perinatal chapters (ids) |
| `ri` | related impairment labels |
| `cn` | coding note |
| `pa`, `kids` | parent id, ordered child ids |
| `chap`, `blk` | chapter id and nearest block id |
| `bid`, `cr` | block id and code range |
| `pc` | postcoordination axes: `{a: axis, r: required, m: multiple, v: [value entity ids]}` |

Routing key of an entity = `c`, else `bid`, else `id` (the extractor asserts uniqueness).
The extractor also asserts that the API's `browserUrl` equals
`https://icd.who.int/browse/<release>/mms/<lang>#<id>`, so the app derives WHO links
instead of storing them, and that the API's `@id` equals `http://id.who.int/icd/release/11/<release>/mms/<id>`,
the URI the app derives from the manifest's `uriBase` and the record `id`.
