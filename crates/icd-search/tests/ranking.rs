//! Ranking tests against the real committed ICD-11 MMS 2026-01 dataset.

use std::path::PathBuf;
use std::sync::OnceLock;

use icd_search::Engine;

fn data_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../data/icd11-mms-2026-01")
}

fn shards() -> Vec<Vec<u8>> {
    let mut names: Vec<PathBuf> = std::fs::read_dir(data_dir())
        .unwrap()
        .map(|e| e.unwrap().path())
        .filter(|p| p.extension().is_some_and(|x| x == "ndjson"))
        .collect();
    names.sort();
    names.iter().map(|p| std::fs::read(p).unwrap()).collect()
}

fn engine() -> &'static Engine {
    static E: OnceLock<Engine> = OnceLock::new();
    E.get_or_init(|| {
        let mut e = Engine::new();
        for s in shards() {
            e.add_shard(s);
        }
        e.build_index("test").unwrap();
        e
    })
}

fn keys(q: &str, n: usize) -> Vec<String> {
    engine().search(q, 1, n).hits.into_iter().map(|h| h.key).collect()
}

#[test]
fn exact_code_ranks_first_in_any_case_and_with_or_without_dot() {
    assert_eq!(keys("8B88", 1), ["8B88"]);
    assert_eq!(keys("8b88", 1), ["8B88"]);
    assert_eq!(keys("8b88.0", 10), ["8B88.0"]);
    assert_eq!(keys("8B880", 1), ["8B88.0"]);
    assert_eq!(keys("BA00.Y", 1), ["BA00.Y"]);
}

#[test]
fn partial_code_lists_the_exact_code_then_its_descendants() {
    let k = keys("8B88", 10);
    assert_eq!(k[0], "8B88");
    assert!(k[1..].iter().all(|c| c.starts_with("8B88.")), "{k:?}");
    let p = keys("8B8", 3);
    assert!(p.iter().all(|c| c.starts_with("8B8")), "{p:?}");
}

#[test]
fn exact_title_beats_looser_matches() {
    assert_eq!(keys("bell palsy", 1), ["8B88.0"]);
    assert_eq!(keys("cholera", 1), ["1A00"]);
    assert_eq!(keys("Crohn disease", 1), ["DD70"]);
    assert_eq!(keys("type 2 diabetes mellitus", 1), ["5A11"]);
    assert_eq!(keys("alzheimer disease", 1), ["8A20"]);
}

#[test]
fn possessives_and_plurals_fold() {
    assert_eq!(keys("Crohn's disease", 1), ["DD70"]);
    assert_eq!(keys("Alzheimers", 1), ["8A20"]);
    assert!(keys("cholera vaccine", 3).iter().any(|k| k == "XM29K4"));
}

#[test]
fn typos_are_tolerated() {
    let r = engine().search("hypertensoin", 1, 10);
    assert_eq!(r.fuzzy, ["hypertensoin"]);
    assert!(r.hits.iter().all(|h| h.title.to_lowercase().contains("hypertension")
        || h.snippet.as_ref().is_some_and(|s| s.parts.join("").to_lowercase().contains("hypertension"))));
    let d = keys("diabtes mellitus", 10);
    assert!(d.contains(&"5A11".to_string()) && d.contains(&"5A10".to_string()), "{d:?}");
    // transposition
    assert_eq!(keys("palsy bell", 1), ["8B88.0"]);
    assert_eq!(keys("bell plasy", 1), ["8B88.0"]);
}

#[test]
fn prefixes_match_the_last_word() {
    assert_eq!(keys("alzheim", 1), ["8A20"]);
    assert_eq!(keys("bell pal", 1), ["8B88.0"]);
    assert_eq!(keys("type 2 diabetes mell", 1), ["5A11"]);
}

#[test]
fn exact_word_outranks_a_longer_prefix_neighbour() {
    // "covid" must not be won by the one-word title "Covidful".
    let k = keys("covid", 3);
    assert!(k[0].starts_with("RA01"), "{k:?}");
}

#[test]
fn highlights_follow_the_verbatim_text() {
    let r = engine().search("bell palsy", 1, 1);
    let h = &r.hits[0];
    assert_eq!(h.title_parts, ["", "Bell", " ", "palsy", ""]);
    assert_eq!(h.title_parts.concat(), h.title);
    let s = h.snippet.as_ref().unwrap();
    assert_eq!(s.label, "Also known as");
    assert!(s.parts.iter().skip(1).step_by(2).any(|p| p == "palsy"));
}

#[test]
fn snippets_window_long_definitions_around_the_match() {
    let r = engine().search("Bartonella quintana", 1, 3);
    let s = r.hits.iter().find_map(|h| h.snippet.as_ref()).unwrap();
    let text = s.parts.concat();
    assert!(text.len() < 300, "{text}");
    assert!(s.parts.iter().skip(1).step_by(2).any(|p| p.eq_ignore_ascii_case("bartonella")));
}

#[test]
fn pagination_is_stable_and_disjoint() {
    let e = engine();
    let p1 = e.search("diabetes", 1, 10);
    let p2 = e.search("diabetes", 2, 10);
    assert_eq!(p1.hits.len(), 10);
    assert_eq!(p2.hits.len(), 10);
    assert!(p1.total > 100 && p1.pages == p1.total.div_ceil(10));
    assert!(p1.hits.iter().all(|a| p2.hits.iter().all(|b| a.key != b.key)));
    // 10 per page also for a code prefix listing
    assert_eq!(e.search("1A", 1, 10).hits.len(), 10);
    assert!(e.search("zzqqxx", 1, 10).hits.is_empty());
}

#[test]
fn suggestions() {
    let e = engine();
    let s = e.suggest("bell pal", 5);
    assert_eq!(s[0].text, "Bell palsy");
    let c = e.suggest("8b88", 4);
    assert_eq!(c[0].kind, "code");
    assert_eq!(c[0].text, "8B88");
    assert!(e.suggest("", 5).is_empty());
}

#[test]
fn index_survives_serialisation_and_rejects_foreign_data() {
    let e = engine();
    let bytes = e.index_bytes().unwrap();
    let mut e2 = Engine::new();
    for s in shards() {
        e2.add_shard(s);
    }
    assert!(e2.load_index(&bytes, "other").is_err());
    e2.load_index(&bytes, "test").unwrap();
    let a = serde_json::to_string(&e.search("bell palsy", 1, 10)).unwrap();
    let b = serde_json::to_string(&e2.search("bell palsy", 1, 10)).unwrap();
    assert_eq!(a, b);
    // index for a different shard set must not load
    let mut e3 = Engine::new();
    e3.add_shard(b"{}\n".to_vec());
    assert!(e3.load_index(&bytes, "test").is_err());
}

#[test]
fn code_page_model_resolves_relations() {
    let e = engine();
    let d = e.detail("8B88.0").unwrap();
    assert_eq!(d["parent"]["key"], "8B88");
    assert_eq!(d["path"][0]["code"], "08");
    assert!(d["siblings"]["items"].as_array().unwrap().iter().any(|b| b["key"] == "8B88.1"));
    let ba = e.detail("BA00").unwrap();
    let exc = ba["exclusions"].as_array().unwrap();
    assert_eq!(exc.len(), 2);
    assert!(exc.iter().all(|x| x["target"].is_object()));
    assert!(ba["axes"].as_array().unwrap().iter().any(|a| a["axis"] == "hasSeverity"));
    assert!(e.detail("nope").is_none());
    let n = e.neighbors("BA00", 3).unwrap();
    assert_eq!(n["children"]["items"].as_array().unwrap().len(), 3);
    assert!(n["children"]["total"].as_u64().unwrap() >= 5);
}

#[test]
fn every_entity_is_reachable_by_its_key() {
    let e = engine();
    let stats = e.stats();
    assert!(stats["docs"].as_u64().unwrap() > 37_000);
    for key in ["01", "BlockL1-BA0", "XA6H07", "8B88.0"] {
        assert!(e.raw_by_key(key).is_some(), "{key}");
    }
}
