//! `cargo run --release --example probe -- "query" [page]`: search the committed dataset.
use icd_search::Engine;
use std::time::Instant;

pub fn load() -> Engine {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data/icd11-mms-2026-01");
    let mut names: Vec<_> = std::fs::read_dir(&dir).unwrap().map(|e| e.unwrap().path()).filter(|p| p.extension().is_some_and(|x| x == "ndjson")).collect();
    names.sort();
    let mut e = Engine::new();
    for n in names {
        e.add_shard(std::fs::read(n).unwrap());
    }
    let t = Instant::now();
    e.build_index("probe").unwrap();
    eprintln!("index built in {:?}", t.elapsed());
    e
}

fn main() {
    let e = load();
    let args: Vec<String> = std::env::args().skip(1).collect();
    for q in args {
        let t = Instant::now();
        let r = e.search(&q, 1, 10);
        println!("== {q:?}: {} hits ({:?}) fuzzy={:?}", r.total, t.elapsed(), r.fuzzy);
        for h in r.hits {
            let sn = h.snippet.map(|s| format!(" | {}: {}", s.label, s.parts.join("|"))).unwrap_or_default();
            println!("  {:8} {:7.2} {}{}", h.code, h.score, h.title, &sn[..sn.len().min(150)]);
        }
    }
}
