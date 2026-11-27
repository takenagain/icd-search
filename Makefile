# One command from the committed extractor output to a deployable site:   make build
# (needs: Rust stable + wasm32-unknown-unknown target, wasm-bindgen-cli at the Cargo.lock version, Node >= 22)

.PHONY: build test test-rust test-e2e image serve clean

build:                ## Rust -> WASM, dataset shards + manifest, site, br/gz precompression, image config -> ./dist
	cd web && npm ci && npm run build

test: test-rust test-e2e

test-rust:            ## engine unit + ranking tests (real dataset)
	cargo test --locked -p icd-search

test-e2e:             ## Playwright against ./dist (run `make build` first; first run: npx playwright install chromium)
	cd web && npx playwright test --project=desktop --project=mobile

image: build          ## runtime image from ./dist
	docker build -f docker/Dockerfile -t icd-search .

serve:                ## ./dist with the production headers on http://127.0.0.1:4173
	cd web && npm run serve

clean:
	rm -rf dist docker/sws.toml web/public/data web/public/wasm web/src/wasm target
