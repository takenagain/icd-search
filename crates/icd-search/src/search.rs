//! Query side: code matching, BM25F retrieval, typo/prefix expansion,
//! phrase re-ranking, snippets, suggestions, and the code-page data model.

use std::collections::{HashMap, HashSet};

use serde::Serialize;
use serde_json::{Value, json};

use crate::data::{Entity, KIND_CATEGORY, kind_name, link_label, link_target};
use crate::index::{self, DocMeta, Index, K1, NONE};
use crate::text::{code_norm, is_stop, osa_within, stem, tokenize};

const RERANK_K: usize = 150;
const MAX_PREFIX_TERMS: usize = 80;
const MAX_FUZZY_TERMS: usize = 40;
const MAX_LIST: usize = 300;

#[derive(Default)]
pub struct Engine {
    shards: Vec<Vec<u8>>,
    index: Option<Index>,
    key_map: HashMap<String, u32>,
    id_map: HashMap<String, u32>,
    /// (normalised code, doc), sorted.
    codes: Vec<(String, u32)>,
    categories: Vec<u32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Brief {
    pub key: String,
    pub code: String,
    pub title: String,
    pub kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub def: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Crumb {
    pub key: String,
    pub code: String,
    pub title: String,
    pub kind: &'static str,
}

#[derive(Debug, Clone, Serialize)]
pub struct Snippet {
    pub label: &'static str,
    /// Alternating plain / matched text: `[plain, match, plain, match, ...]`.
    pub parts: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Hit {
    pub key: String,
    pub code: String,
    pub kind: &'static str,
    pub title: String,
    pub title_parts: Vec<String>,
    pub crumbs: Vec<Crumb>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub snippet: Option<Snippet>,
    pub score: f32,
    /// "code" for code matches, "text" otherwise.
    pub via: &'static str,
}

#[derive(Debug, Clone, Serialize)]
pub struct SearchResponse {
    pub query: String,
    pub total: usize,
    pub page: usize,
    pub per_page: usize,
    pub pages: usize,
    /// Query tokens that had no exact match and were matched by similar spelling.
    pub fuzzy: Vec<String>,
    pub hits: Vec<Hit>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Suggestion {
    pub text: String,
    pub key: String,
    /// "code" navigates, "term" searches.
    pub kind: &'static str,
    pub title: String,
}

struct QTok {
    raw: String,
    stem: String,
    stop: bool,
}

struct Cand {
    tid: usize,
    w: f32,
    /// Prefix expansions share one idf (that of their union) so a rare
    /// extension does not outrank a common one purely on rarity.
    idf: Option<f32>,
}

struct TextRun {
    ranked: Vec<(u32, f32)>,
    matched: HashSet<usize>,
    fuzzy: Vec<String>,
}

impl Engine {
    pub fn new() -> Engine {
        Engine::default()
    }

    pub fn add_shard(&mut self, bytes: Vec<u8>) -> usize {
        self.shards.push(bytes);
        self.index = None;
        self.shards.len() - 1
    }

    pub fn shard_count(&self) -> usize {
        self.shards.len()
    }

    pub fn is_ready(&self) -> bool {
        self.index.is_some()
    }

    pub fn build_index(&mut self, dataset_id: &str) -> Result<(), String> {
        let idx = index::build(&self.shards, dataset_id)?;
        self.install(idx);
        Ok(())
    }

    pub fn index_bytes(&self) -> Result<Vec<u8>, String> {
        self.index.as_ref().ok_or("no index")?.to_bytes()
    }

    /// Load a previously serialised index; fails if it does not belong to the
    /// shards currently held.
    pub fn load_index(&mut self, bytes: &[u8], dataset_id: &str) -> Result<(), String> {
        let idx = Index::from_bytes(bytes)?;
        if idx.dataset_id != dataset_id {
            return Err(format!("index is for dataset {}, not {}", idx.dataset_id, dataset_id));
        }
        for d in &idx.docs {
            let shard = self.shards.get(d.shard as usize).ok_or("index refers to a missing shard")?;
            if d.off as usize + d.len as usize > shard.len() {
                return Err("index does not match shard sizes".into());
            }
        }
        self.install(idx);
        Ok(())
    }

    fn install(&mut self, idx: Index) {
        self.key_map = idx.docs.iter().enumerate().map(|(i, d)| (d.key.clone(), i as u32)).collect();
        self.id_map = idx.docs.iter().enumerate().map(|(i, d)| (d.id.clone(), i as u32)).collect();
        self.codes = idx
            .docs
            .iter()
            .enumerate()
            .filter(|(_, d)| !d.code.is_empty())
            .map(|(i, d)| (code_norm(&d.code), i as u32))
            .collect();
        self.codes.sort_unstable();
        self.categories = idx
            .docs
            .iter()
            .enumerate()
            .filter(|(_, d)| d.kind == KIND_CATEGORY)
            .map(|(i, _)| i as u32)
            .collect();
        self.index = Some(idx);
    }

    fn idx(&self) -> &Index {
        self.index.as_ref().expect("index not built")
    }

    fn meta(&self, doc: u32) -> &DocMeta {
        &self.idx().docs[doc as usize]
    }

    pub fn raw(&self, doc: u32) -> &[u8] {
        let m = self.meta(doc);
        &self.shards[m.shard as usize][m.off as usize..(m.off + m.len) as usize]
    }

    pub fn raw_by_key(&self, key: &str) -> Option<&[u8]> {
        self.key_map.get(key).map(|&d| self.raw(d))
    }

    pub fn entity(&self, doc: u32) -> Entity {
        Entity::parse(self.raw(doc)).expect("indexed line must parse")
    }

    pub fn doc_by_key(&self, key: &str) -> Option<u32> {
        self.key_map.get(key).copied()
    }

    pub fn stats(&self) -> Value {
        let i = self.idx();
        json!({ "docs": i.docs.len(), "terms": i.terms.len(), "postings": i.post_docs.len() })
    }

    /// Key of a pseudo-random category; `r` in `[0, 1)`.
    pub fn random_key(&self, r: f64) -> Option<String> {
        if self.categories.is_empty() {
            return None;
        }
        let i = ((r.clamp(0.0, 0.999_999) * self.categories.len() as f64) as usize).min(self.categories.len() - 1);
        Some(self.meta(self.categories[i]).key.clone())
    }

    // ---------------------------------------------------------------- codes

    fn code_like(q: &str) -> Option<String> {
        let t = q.trim();
        if t.is_empty() || t.chars().any(|c| !(c.is_ascii_alphanumeric() || c == '.')) {
            return None;
        }
        let n = code_norm(t);
        (n.len() >= 2 && n.len() <= 8 && n.bytes().any(|b| b.is_ascii_digit())).then_some(n)
    }

    /// Exact code first, then codes the query is a prefix of, in code order.
    fn code_hits(&self, norm: &str) -> Vec<u32> {
        let start = self.codes.partition_point(|(c, _)| c.as_str() < norm);
        let mut exact = Vec::new();
        let mut rest = Vec::new();
        for (c, d) in &self.codes[start..] {
            if !c.starts_with(norm) {
                break;
            }
            if c == norm {
                exact.push(*d);
            } else {
                rest.push(*d);
            }
        }
        exact.extend(rest);
        exact
    }

    // ----------------------------------------------------------------- text

    fn analyze(q: &str) -> Vec<QTok> {
        let mut toks: Vec<QTok> = tokenize(q)
            .into_iter()
            .map(|t| QTok { stem: stem(&t.s), stop: is_stop(&t.s), raw: t.s })
            .collect();
        if toks.iter().all(|t| t.stop) {
            for t in &mut toks {
                t.stop = false;
            }
        }
        toks
    }

    fn expand(&self, qt: &QTok, is_last: bool, fuzzy: &mut Vec<String>) -> Vec<Cand> {
        let idx = self.idx();
        let mut out = Vec::new();
        let exact = idx.term_id(&qt.stem);
        if let Some(t) = exact {
            out.push(Cand { tid: t, w: 1.0, idf: None });
        }
        let nchars = qt.raw.chars().count();
        if is_last && nchars >= 2 {
            let start = idx.terms.partition_point(|t| t.as_str() < qt.raw.as_str());
            let mut c: Vec<(usize, usize)> = Vec::new();
            for t in start..idx.terms.len() {
                if !idx.terms[t].starts_with(&qt.raw) {
                    break;
                }
                if Some(t) != exact {
                    c.push((t, idx.df(t)));
                }
            }
            c.sort_unstable_by(|a, b| b.1.cmp(&a.1));
            c.truncate(MAX_PREFIX_TERMS);
            if let Some(&(_, df_max)) = c.first() {
                let n = idx.n_docs() as f32;
                let union = (c.iter().map(|x| x.1).sum::<usize>() as f32).min(n);
                let idf = (1.0 + (n - union + 0.5) / (union + 0.5)).ln();
                let top = (1.0 + df_max as f32).ln();
                out.extend(c.into_iter().map(|(tid, df)| Cand {
                    tid,
                    w: 0.55 + 0.25 * ((1.0 + df as f32).ln() / top),
                    idf: Some(idf),
                }));
            }
        }
        if out.is_empty() && nchars >= 4 && qt.stem.is_ascii() {
            let maxd = if nchars <= 7 { 1 } else { 2 };
            let q = qt.stem.as_bytes();
            let mut c: Vec<(usize, usize, usize)> = Vec::new(); // tid, dist, df
            for (t, term) in idx.terms.iter().enumerate() {
                if term.len().abs_diff(q.len()) > maxd || !term.is_ascii() {
                    continue;
                }
                if let Some(d) = osa_within(q, term.as_bytes(), maxd) {
                    c.push((t, d, idx.df(t)));
                }
            }
            c.sort_unstable_by(|a, b| a.1.cmp(&b.1).then(b.2.cmp(&a.2)));
            c.truncate(MAX_FUZZY_TERMS);
            if !c.is_empty() {
                fuzzy.push(qt.raw.clone());
            }
            out.extend(c.into_iter().map(|(tid, d, _)| Cand { tid, w: if d <= 1 { 0.6 } else { 0.4 }, idf: None }));
        }
        out
    }

    fn text_run(&self, q: &str, rerank_k: usize) -> TextRun {
        let idx = self.idx();
        let toks = Self::analyze(q);
        let last = toks.iter().rposition(|t| !t.stop);
        let n_docs = idx.n_docs();
        let mut total = vec![0f32; n_docs];
        let mut cnt = vec![0u8; n_docs];
        let mut best = vec![0f32; n_docs];
        let mut touched: Vec<u32> = Vec::new();
        let mut any: Vec<u32> = Vec::new();
        let mut matched: HashSet<usize> = HashSet::new();
        let mut fuzzy = Vec::new();
        let mut active = 0u8;

        for (i, qt) in toks.iter().enumerate() {
            if qt.stop {
                continue;
            }
            let cands = self.expand(qt, Some(i) == last, &mut fuzzy);
            if cands.is_empty() {
                continue;
            }
            active = active.saturating_add(1);
            touched.clear();
            for c in &cands {
                matched.insert(c.tid);
                let idf = c.idf.unwrap_or_else(|| idx.idf(c.tid));
                for (doc, tf) in idx.postings(c.tid) {
                    let s = c.w * idf * (tf * (K1 + 1.0)) / (tf + K1);
                    let b = &mut best[doc as usize];
                    if *b == 0.0 {
                        touched.push(doc);
                    }
                    if s > *b {
                        *b = s;
                    }
                }
            }
            for &d in &touched {
                let d = d as usize;
                if total[d] == 0.0 {
                    any.push(d as u32);
                }
                total[d] += best[d];
                cnt[d] = cnt[d].saturating_add(1);
                best[d] = 0.0;
            }
        }

        let mut ranked: Vec<(u32, f32)> = any
            .iter()
            .map(|&d| {
                let frac = f32::from(cnt[d as usize]) / f32::from(active.max(1));
                (d, total[d as usize] * frac * frac)
            })
            .collect();
        ranked.sort_unstable_by(|a, b| b.1.total_cmp(&a.1).then(a.0.cmp(&b.0)));

        // Phrase-aware re-rank of the head: exact / prefix / contiguous title
        // and index-term matches float up.
        let k = rerank_k.min(ranked.len());
        if k > 0 {
            let qstems: Vec<String> = toks.iter().filter(|t| !t.stop).map(|t| t.stem.clone()).collect();
            let last_raw = toks.iter().rev().find(|t| !t.stop).map(|t| t.raw.clone()).unwrap_or_default();
            let s_max = ranked[0].1;
            for r in ranked.iter_mut().take(k) {
                let e = self.entity(r.0);
                r.1 += s_max * phrase_bonus(&e, &qstems, &last_raw);
            }
            ranked[..k].sort_unstable_by(|a, b| b.1.total_cmp(&a.1).then(a.0.cmp(&b.0)));
        }
        TextRun { ranked, matched, fuzzy }
    }

    // ------------------------------------------------------------- snippets

    fn highlight(&self, text: &str, matched: &HashSet<usize>) -> Vec<String> {
        let idx = self.idx();
        let mut parts = vec![String::new()];
        let mut pos = 0usize;
        for tok in tokenize(text) {
            let hit = idx.term_id(&stem(&tok.s)).is_some_and(|t| matched.contains(&t));
            if hit {
                parts.last_mut().unwrap().push_str(&text[pos..tok.start]);
                parts.push(text[tok.start..tok.end].to_string());
                parts.push(String::new());
                pos = tok.end;
            }
        }
        parts.last_mut().unwrap().push_str(&text[pos..]);
        parts
    }

    fn matched_count(&self, text: &str, matched: &HashSet<usize>) -> usize {
        let idx = self.idx();
        let mut seen = HashSet::new();
        for tok in tokenize(text) {
            if let Some(t) = idx.term_id(&stem(&tok.s)).filter(|t| matched.contains(t)) {
                seen.insert(t);
            }
        }
        seen.len()
    }

    fn snippet(&self, e: &Entity, matched: &HashSet<usize>) -> Option<Snippet> {
        let def = e.d.as_deref().or(e.ld.as_deref());
        let mut cands: Vec<(&'static str, &str, u8)> = Vec::new();
        if let Some(d) = def {
            cands.push(("Definition", d, 3));
        }
        for t in e.ix.iter().filter(|t| t.as_str() != e.t) {
            cands.push(("Also known as", t, 2));
        }
        for l in &e.inc {
            cands.push(("Includes", link_label(l), 1));
        }
        let mut best: Option<(usize, u8, &'static str, &str)> = None;
        for (label, text, pri) in cands {
            let n = self.matched_count(text, matched);
            if n > 0 && best.is_none_or(|b| (n, pri) > (b.0, b.1)) {
                best = Some((n, pri, label, text));
            }
        }
        let (label, text) = match best {
            Some((_, _, l, t)) => (l, t),
            None => ("Definition", def?),
        };
        let (window, pre, post) = window_of(text, matched_start(self, text, matched));
        let mut parts = self.highlight(window, matched);
        if pre {
            parts[0].insert_str(0, "\u{2026} ");
        }
        if post {
            parts.last_mut().unwrap().push_str(" \u{2026}");
        }
        Some(Snippet { label, parts })
    }

    fn crumbs(&self, d: &DocMeta) -> Vec<Crumb> {
        [d.chap, d.blk]
            .into_iter()
            .filter(|&i| i != NONE)
            .map(|i| {
                let m = self.meta(i);
                Crumb { key: m.key.clone(), code: m.code.clone(), title: m.title.clone(), kind: kind_name(m.kind) }
            })
            .collect()
    }

    fn hit(&self, doc: u32, score: f32, via: &'static str, matched: &HashSet<usize>) -> Hit {
        let m = self.meta(doc);
        let e = self.entity(doc);
        Hit {
            key: m.key.clone(),
            code: m.code.clone(),
            kind: kind_name(m.kind),
            title: m.title.clone(),
            title_parts: self.highlight(&m.title, matched),
            crumbs: self.crumbs(m),
            snippet: self.snippet(&e, matched),
            score,
            via,
        }
    }

    // --------------------------------------------------------------- search

    pub fn search(&self, q: &str, page: usize, per_page: usize) -> SearchResponse {
        let page = page.max(1);
        let per_page = per_page.clamp(1, 100);
        let code = Self::code_like(q).map(|n| self.code_hits(&n)).filter(|h| !h.is_empty());
        let code_hits = code.unwrap_or_default();
        let need = page * per_page;
        let (ranked, matched, fuzzy) = if !code_hits.is_empty() || tokenize(q).is_empty() {
            (Vec::new(), HashSet::new(), Vec::new())
        } else {
            let run = self.text_run(q, RERANK_K.max(need));
            (run.ranked, run.matched, run.fuzzy)
        };
        let code_set: HashSet<u32> = code_hits.iter().copied().collect();
        let text: Vec<(u32, f32)> = ranked.into_iter().filter(|(d, _)| !code_set.contains(d)).collect();
        let total = code_hits.len() + text.len();
        let skip = (page - 1) * per_page;

        let mut hits = Vec::new();
        for i in skip..(skip + per_page).min(total) {
            if i < code_hits.len() {
                hits.push(self.hit(code_hits[i], 0.0, "code", &HashSet::new()));
            } else {
                let (d, s) = text[i - code_hits.len()];
                hits.push(self.hit(d, s, "text", &matched));
            }
        }
        SearchResponse { query: q.to_string(), total, page, per_page, pages: total.div_ceil(per_page), fuzzy, hits }
    }

    pub fn suggest(&self, q: &str, limit: usize) -> Vec<Suggestion> {
        let limit = limit.clamp(1, 20);
        if let Some(n) = Self::code_like(q) {
            let hits = self.code_hits(&n);
            if !hits.is_empty() {
                return hits
                    .into_iter()
                    .take(limit)
                    .map(|d| {
                        let m = self.meta(d);
                        Suggestion { text: m.code.clone(), key: m.key.clone(), kind: "code", title: m.title.clone() }
                    })
                    .collect();
            }
        }
        if tokenize(q).is_empty() {
            return Vec::new();
        }
        let run = self.text_run(q, 60);
        let toks = Self::analyze(q);
        let last = toks.iter().rev().find(|t| !t.stop).map(|t| t.raw.clone()).unwrap_or_default();
        let mut seen = HashSet::new();
        let mut out = Vec::new();
        for (d, _) in run.ranked.iter().take(60) {
            let m = self.meta(*d);
            let title_has_last = tokenize(&m.title).iter().any(|t| t.s.starts_with(&last) || stem(&t.s) == stem(&last));
            let mut text = m.title.clone();
            if !title_has_last {
                let e = self.entity(*d);
                if let Some(t) = e.ix.iter().find(|t| tokenize(t).iter().any(|k| k.s.starts_with(&last))) {
                    text = t.clone();
                }
            }
            if seen.insert(text.to_lowercase()) {
                out.push(Suggestion { text, key: m.key.clone(), kind: "term", title: m.title.clone() });
                if out.len() >= limit {
                    break;
                }
            }
        }
        out
    }

    // ----------------------------------------------------- code-page model

    pub fn brief(&self, doc: u32, with_def: bool) -> Brief {
        let m = self.meta(doc);
        let def = if with_def {
            let e = self.entity(doc);
            e.d.or(e.ld)
        } else {
            None
        };
        Brief { key: m.key.clone(), code: m.code.clone(), title: m.title.clone(), kind: kind_name(m.kind), def }
    }

    pub fn brief_by_key(&self, key: &str) -> Option<Brief> {
        self.doc_by_key(key).map(|d| self.brief(d, true))
    }

    fn briefs_of_ids<'a>(&self, ids: impl Iterator<Item = &'a String>, cap: usize) -> (Vec<Brief>, usize) {
        let docs: Vec<u32> = ids.filter_map(|i| self.id_map.get(i).copied()).collect();
        let total = docs.len();
        (docs.into_iter().take(cap).map(|d| self.brief(d, true)).collect(), total)
    }

    fn link_items(&self, links: &[Vec<String>]) -> Vec<Value> {
        links
            .iter()
            .map(|l| {
                let target = link_target(l).and_then(|t| self.id_map.get(t)).map(|&d| self.brief(d, true));
                json!({ "label": link_label(l), "target": target })
            })
            .collect()
    }

    /// Everything the code page renders, with relations resolved to briefs.
    pub fn detail(&self, key: &str) -> Option<Value> {
        let doc = self.doc_by_key(key)?;
        let m = self.meta(doc);
        let e = self.entity(doc);

        let mut path = Vec::new();
        let mut p = m.pa;
        while p != NONE && path.len() < 16 {
            path.push(self.brief(p, false));
            p = self.meta(p).pa;
        }
        path.reverse();

        let (children, n_children) = self.briefs_of_ids(e.kids.iter(), MAX_LIST);
        let (siblings, n_siblings) = if m.pa != NONE {
            let pe = self.entity(m.pa);
            self.briefs_of_ids(pe.kids.iter().filter(|k| **k != e.id), MAX_LIST)
        } else {
            (Vec::new(), 0)
        };
        let (see_also, _) = self.briefs_of_ids(e.see.iter(), MAX_LIST);
        let axes: Vec<Value> = e
            .pc
            .iter()
            .map(|a| {
                let (values, total) = self.briefs_of_ids(a.v.iter(), 40);
                json!({ "axis": a.a, "required": a.r, "multiple": a.m, "values": values, "total": total })
            })
            .collect();

        Some(json!({
            "key": m.key, "id": e.id, "code": e.c, "kind": kind_name(m.kind), "title": e.t,
            "definition": e.d, "longDefinition": e.ld, "fullySpecifiedName": e.fn_, "codingNote": e.cn,
            "blockId": e.bid, "codeRange": e.cr,
            "path": path,
            "parent": if m.pa != NONE { Some(self.brief(m.pa, true)) } else { None },
            "children": { "items": children, "total": n_children },
            "siblings": { "items": siblings, "total": n_siblings },
            "inclusions": self.link_items(&e.inc),
            "exclusions": self.link_items(&e.exc),
            "codedElsewhere": self.link_items(&e.ce),
            "seeAlso": see_also,
            "relatedImpairment": e.ri,
            "indexTerms": e.ix,
            "axes": axes,
        }))
    }

    /// One node's neighbourhood for the graph view.
    pub fn neighbors(&self, key: &str, max_children: usize) -> Option<Value> {
        let doc = self.doc_by_key(key)?;
        let m = self.meta(doc);
        let e = self.entity(doc);
        let kids: Vec<u32> = e.kids.iter().filter_map(|i| self.id_map.get(i).copied()).collect();
        let items: Vec<Brief> = kids.iter().take(max_children).map(|&d| self.brief(d, false)).collect();
        let mut refs = Vec::new();
        let mut push = |rel: &str, label: &str, d: u32| {
            refs.push(json!({ "rel": rel, "label": label, "node": self.brief(d, false) }));
        };
        for (rel, links) in [("exclusion", &e.exc), ("coded_elsewhere", &e.ce), ("inclusion", &e.inc)] {
            for l in links {
                if let Some(&d) = link_target(l).and_then(|t| self.id_map.get(t)) {
                    push(rel, link_label(l), d);
                }
            }
        }
        for id in &e.see {
            if let Some(&d) = self.id_map.get(id) {
                push("see_also", "", d);
            }
        }
        Some(json!({
            "center": self.brief(doc, false),
            "parent": if m.pa != NONE { Some(self.brief(m.pa, false)) } else { None },
            "children": { "items": items, "total": kids.len() },
            "refs": refs,
        }))
    }
}

fn nonstop_stems(text: &str) -> Vec<String> {
    tokenize(text).into_iter().filter(|t| !is_stop(&t.s)).map(|t| stem(&t.s)).collect()
}

/// Fraction of the top score granted for phrase-level agreement.
fn phrase_bonus(e: &Entity, q: &[String], last_raw: &str) -> f32 {
    if q.is_empty() {
        return 0.0;
    }
    // Leading-token agreement: the last query token must equal the title token
    // (full credit) or merely be a prefix of it (reduced credit).
    let starts = |toks: &[String], prefix_ok: bool| {
        let n = q.len();
        toks.len() >= n
            && toks[..n - 1] == q[..n - 1]
            && (toks[n - 1] == q[n - 1] || (prefix_ok && toks[n - 1].starts_with(last_raw)))
    };
    let contains = |toks: &[String]| toks.windows(q.len()).any(|w| w == q);
    let title = nonstop_stems(&e.t);
    let mut b = 0.0f32;
    if title == q {
        b = b.max(1.0);
    } else if starts(&title, false) {
        b = b.max(0.5);
    } else if starts(&title, true) {
        b = b.max(0.3);
    } else if contains(&title) {
        b = b.max(0.3);
    }
    for ix in &e.ix {
        let t = nonstop_stems(ix);
        if t == q {
            b = b.max(0.6);
        } else if starts(&t, false) {
            b = b.max(0.25);
        } else if starts(&t, true) {
            b = b.max(0.15);
        }
    }
    b
}

/// Byte offset of the first matching token, if any.
fn matched_start(eng: &Engine, text: &str, matched: &HashSet<usize>) -> Option<usize> {
    let idx = eng.idx();
    tokenize(text)
        .into_iter()
        .find(|t| idx.term_id(&stem(&t.s)).is_some_and(|i| matched.contains(&i)))
        .map(|t| t.start)
}

/// Cut a long text to a window around `at`, on word boundaries.
fn window_of(text: &str, at: Option<usize>) -> (&str, bool, bool) {
    const MAX: usize = 240;
    const LEAD: usize = 80;
    if text.len() <= MAX {
        return (text, false, false);
    }
    let mut start = at.map_or(0, |a| a.saturating_sub(LEAD));
    while !text.is_char_boundary(start) {
        start -= 1;
    }
    if start > 0 {
        if let Some(sp) = text[start..].find(' ') {
            start += sp + 1;
        }
    }
    let mut end = (start + MAX).min(text.len());
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    if end < text.len() {
        if let Some(sp) = text[start..end].rfind(' ') {
            end = start + sp;
        }
    }
    (&text[start..end], start > 0, end < text.len())
}
