// Compiles crates/icd-search to WebAssembly and generates the JS glue in src/wasm/.
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const run = (cmd, args) => execFileSync(cmd, args, { cwd: root, stdio: 'inherit' });

// The wasm-bindgen CLI must match the crate version pinned in Cargo.lock.
const lock = readFileSync(resolve(root, 'Cargo.lock'), 'utf8');
const want = /name = "wasm-bindgen"\nversion = "([^"]+)"/.exec(lock)?.[1];
const have = execFileSync('wasm-bindgen', ['--version'], { encoding: 'utf8' }).trim().split(' ')[1];
if (want !== have) {
  console.error(`wasm-bindgen CLI ${have} does not match Cargo.lock ${want}.\n  cargo install wasm-bindgen-cli --version ${want} --locked`);
  process.exit(1);
}

run('cargo', ['build', '--release', '--locked', '--target', 'wasm32-unknown-unknown', '-p', 'icd-search']);
const out = resolve(root, 'web/src/wasm');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
run('wasm-bindgen', [
  '--target', 'web', '--out-dir', out, '--out-name', 'icd_search',
  '--remove-name-section', '--remove-producers-section',
  'target/wasm32-unknown-unknown/release/icd_search.wasm',
]);
