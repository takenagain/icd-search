//! wasm-bindgen surface. Results cross the boundary as JSON strings.

use wasm_bindgen::prelude::*;

use crate::search::Engine;

#[wasm_bindgen]
pub struct IcdEngine {
    inner: Engine,
}

fn js<E: ToString>(e: E) -> JsError {
    JsError::new(&e.to_string())
}

fn json<T: serde::Serialize>(v: &T) -> String {
    serde_json::to_string(v).unwrap_or_else(|_| "null".into())
}

#[wasm_bindgen]
impl IcdEngine {
    #[wasm_bindgen(constructor)]
    pub fn new() -> IcdEngine {
        IcdEngine { inner: Engine::new() }
    }

    /// Hand over one decoded dataset shard (NDJSON bytes); returns its index.
    pub fn add_shard(&mut self, bytes: Vec<u8>) -> usize {
        self.inner.add_shard(bytes)
    }

    pub fn build_index(&mut self, dataset_id: &str) -> Result<(), JsError> {
        self.inner.build_index(dataset_id).map_err(js)
    }

    pub fn index_bytes(&self) -> Result<Vec<u8>, JsError> {
        self.inner.index_bytes().map_err(js)
    }

    pub fn load_index(&mut self, bytes: &[u8], dataset_id: &str) -> Result<(), JsError> {
        self.inner.load_index(bytes, dataset_id).map_err(js)
    }

    pub fn search(&self, q: &str, page: u32, per_page: u32) -> String {
        json(&self.inner.search(q, page as usize, per_page as usize))
    }

    pub fn suggest(&self, q: &str, limit: u32) -> String {
        json(&self.inner.suggest(q, limit as usize))
    }

    pub fn detail(&self, key: &str) -> Option<String> {
        self.inner.detail(key).map(|v| json(&v))
    }

    pub fn brief(&self, key: &str) -> Option<String> {
        self.inner.brief_by_key(key).map(|b| json(&b))
    }

    pub fn browse_children(&self, parent: Option<String>) -> String {
        json(&self.inner.browse_children(parent.as_deref()))
    }

    pub fn filter_browse(&self, query: &str, folders_only: bool) -> String {
        json(&self.inner.filter_browse(query, folders_only))
    }

    pub fn neighbors(&self, key: &str, max_children: u32) -> Option<String> {
        self.inner.neighbors(key, max_children as usize).map(|v| json(&v))
    }

    pub fn random_key(&self, r: f64) -> Option<String> {
        self.inner.random_key(r)
    }

    pub fn stats(&self) -> String {
        json(&self.inner.stats())
    }
}

impl Default for IcdEngine {
    fn default() -> Self {
        Self::new()
    }
}
