//! Inverted index with BM25F scoring.
//!
//! Fields: title (+ fully specified name), index terms, inclusions, definition
//! (+ long definition). For each (term, document) we precompute one
//! length-normalised, field-weighted pseudo term frequency `tf'` (BM25F), so a
//! query only needs `idf * tf' * (k1 + 1) / (tf' + k1)` per posting.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::data::{Entity, kind_from_str};
use crate::text::{stem, tokenize};

pub const NF: usize = 4;
pub const F_TITLE: usize = 0;
pub const F_INDEX: usize = 1;
pub const F_INCL: usize = 2;
pub const F_DEF: usize = 3;

const FIELD_WEIGHT: [f32; NF] = [4.0, 2.0, 1.5, 1.0];
const FIELD_B: [f32; NF] = [0.4, 0.75, 0.75, 0.75];
pub const K1: f32 = 1.2;
/// `tf'` is stored as `round(tf' * TF_SCALE)` in a u16.
pub const TF_SCALE: f32 = 64.0;
pub const INDEX_VERSION: u32 = 1;
pub const NONE: u32 = u32::MAX;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocMeta {
    pub shard: u8,
    pub off: u32,
    pub len: u32,
    /// WHO entity id ("257068234", "761947693/other").
    pub id: String,
    /// Routing key: code, else block id, else entity id.
    pub key: String,
    pub code: String,
    pub title: String,
    pub kind: u8,
    pub pa: u32,
    pub chap: u32,
    pub blk: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Index {
    pub version: u32,
    /// Identifies the dataset this index was built from (set by the caller).
    pub dataset_id: String,
    pub docs: Vec<DocMeta>,
    /// Sorted, stemmed vocabulary.
    pub terms: Vec<String>,
    /// CSR offsets into the posting arrays; `terms.len() + 1` entries.
    pub term_start: Vec<u32>,
    /// Per-term delta-encoded document ids.
    pub post_docs: Vec<u32>,
    pub post_tf: Vec<u16>,
}

impl Index {
    pub fn n_docs(&self) -> usize {
        self.docs.len()
    }

    pub fn df(&self, t: usize) -> usize {
        (self.term_start[t + 1] - self.term_start[t]) as usize
    }

    pub fn idf(&self, t: usize) -> f32 {
        let n = self.n_docs() as f32;
        let df = self.df(t) as f32;
        (1.0 + (n - df + 0.5) / (df + 0.5)).ln()
    }

    pub fn term_id(&self, term: &str) -> Option<usize> {
        self.terms.binary_search_by(|t| t.as_str().cmp(term)).ok()
    }

    /// Postings of term `t` as `(doc, tf')`.
    pub fn postings(&self, t: usize) -> impl Iterator<Item = (u32, f32)> + '_ {
        let (s, e) = (self.term_start[t] as usize, self.term_start[t + 1] as usize);
        let mut doc = 0u32;
        (s..e).map(move |i| {
            doc += self.post_docs[i];
            (doc, f32::from(self.post_tf[i]) / TF_SCALE)
        })
    }

    pub fn to_bytes(&self) -> Result<Vec<u8>, String> {
        postcard::to_allocvec(self).map_err(|e| e.to_string())
    }

    pub fn from_bytes(b: &[u8]) -> Result<Index, String> {
        let idx: Index = postcard::from_bytes(b).map_err(|e| e.to_string())?;
        if idx.version != INDEX_VERSION {
            return Err(format!("index version {} != {}", idx.version, INDEX_VERSION));
        }
        if idx.term_start.len() != idx.terms.len() + 1 {
            return Err("corrupt index".into());
        }
        Ok(idx)
    }
}

type FieldTf = [u8; NF];

struct Pending {
    pa: String,
    chap: String,
    blk: String,
}

pub fn build(shards: &[Vec<u8>], dataset_id: &str) -> Result<Index, String> {
    let mut docs: Vec<DocMeta> = Vec::new();
    let mut pend: Vec<Pending> = Vec::new();
    let mut doc_len: Vec<[u32; NF]> = Vec::new();
    let mut acc: HashMap<String, Vec<(u32, FieldTf)>> = HashMap::new();
    let mut keys: HashMap<String, u32> = HashMap::new();

    for (si, shard) in shards.iter().enumerate() {
        if si > u8::MAX as usize {
            return Err("too many shards".into());
        }
        let mut off = 0usize;
        for line in shard.split(|&b| b == b'\n') {
            let len = line.len();
            if len > 0 {
                let e = Entity::parse(line).map_err(|e| format!("shard {si} @{off}: {e}"))?;
                let doc = docs.len() as u32;
                let key = e.key().to_string();
                if let Some(prev) = keys.insert(key.clone(), doc) {
                    return Err(format!("duplicate key {key} (docs {prev}, {doc})"));
                }

                let mut terms: HashMap<String, FieldTf> = HashMap::new();
                let mut lens = [0u32; NF];
                let mut add = |f: usize, text: &str| {
                    for tok in tokenize(text) {
                        lens[f] += 1;
                        let c = &mut terms.entry(stem(&tok.s)).or_insert([0; NF])[f];
                        *c = c.saturating_add(1);
                    }
                };
                add(F_TITLE, &e.t);
                if let Some(f) = &e.fn_ {
                    add(F_TITLE, f);
                }
                for ix in &e.ix {
                    add(F_INDEX, ix);
                }
                for inc in &e.inc {
                    add(F_INCL, inc.first().map(String::as_str).unwrap_or(""));
                }
                if let Some(d) = &e.d {
                    add(F_DEF, d);
                }
                if let Some(d) = &e.ld {
                    add(F_DEF, d);
                }
                for (t, tf) in terms {
                    acc.entry(t).or_default().push((doc, tf));
                }
                doc_len.push(lens);
                pend.push(Pending {
                    pa: e.pa.clone(),
                    chap: e.chap.clone().unwrap_or_default(),
                    blk: e.blk.clone().unwrap_or_default(),
                });
                docs.push(DocMeta {
                    shard: si as u8,
                    off: off as u32,
                    len: len as u32,
                    id: e.id,
                    key,
                    code: e.c,
                    title: e.t,
                    kind: kind_from_str(&e.k),
                    pa: NONE,
                    chap: NONE,
                    blk: NONE,
                });
            }
            off += len + 1;
        }
    }

    let by_id: HashMap<&str, u32> = docs.iter().enumerate().map(|(i, d)| (d.id.as_str(), i as u32)).collect();
    let resolve = |id: &str| if id.is_empty() { NONE } else { by_id.get(id).copied().unwrap_or(NONE) };
    let links: Vec<(u32, u32, u32)> = pend.iter().map(|p| (resolve(&p.pa), resolve(&p.chap), resolve(&p.blk))).collect();
    drop(by_id);
    for (d, (pa, chap, blk)) in docs.iter_mut().zip(links) {
        d.pa = pa;
        d.chap = chap;
        d.blk = blk;
    }

    let n = docs.len().max(1) as f32;
    let mut avg = [1.0f32; NF];
    for (f, a) in avg.iter_mut().enumerate() {
        let sum: u64 = doc_len.iter().map(|l| u64::from(l[f])).sum();
        *a = (sum as f32 / n).max(1.0);
    }

    let mut entries: Vec<(String, Vec<(u32, FieldTf)>)> = acc.into_iter().collect();
    entries.sort_unstable_by(|a, b| a.0.cmp(&b.0));

    let mut terms = Vec::with_capacity(entries.len());
    let mut term_start = Vec::with_capacity(entries.len() + 1);
    let mut post_docs = Vec::new();
    let mut post_tf = Vec::new();
    for (term, list) in entries {
        term_start.push(post_docs.len() as u32);
        terms.push(term);
        let mut prev = 0u32;
        for (doc, tf) in list {
            let lens = &doc_len[doc as usize];
            let mut w = 0.0f32;
            for f in 0..NF {
                if tf[f] > 0 {
                    let norm = 1.0 - FIELD_B[f] + FIELD_B[f] * (lens[f] as f32 / avg[f]);
                    w += FIELD_WEIGHT[f] * f32::from(tf[f]) / norm;
                }
            }
            post_docs.push(doc - prev);
            prev = doc;
            post_tf.push((w * TF_SCALE).round().clamp(1.0, f32::from(u16::MAX)) as u16);
        }
    }
    term_start.push(post_docs.len() as u32);

    Ok(Index {
        version: INDEX_VERSION,
        dataset_id: dataset_id.to_string(),
        docs,
        terms,
        term_start,
        post_docs,
        post_tf,
    })
}
