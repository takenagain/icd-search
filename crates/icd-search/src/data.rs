//! The extractor's compact record (see tools/extract/README.md, schema 1).
//! Text is never altered: what the WHO API returned is what we hold.

use serde::{Deserialize, Serialize};

pub const KIND_CATEGORY: u8 = 0;
pub const KIND_CHAPTER: u8 = 1;
pub const KIND_BLOCK: u8 = 2;
pub const KIND_WINDOW: u8 = 3;

pub fn kind_from_str(s: &str) -> u8 {
    match s {
        "chapter" => KIND_CHAPTER,
        "block" => KIND_BLOCK,
        "window" => KIND_WINDOW,
        _ => KIND_CATEGORY,
    }
}

pub fn kind_name(k: u8) -> &'static str {
    match k {
        KIND_CHAPTER => "chapter",
        KIND_BLOCK => "block",
        KIND_WINDOW => "window",
        _ => "category",
    }
}

/// `[label]` or `[label, targetEntityId]`.
pub type Link = Vec<String>;

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub struct Axis {
    pub a: String,
    #[serde(default)]
    pub r: bool,
    #[serde(default)]
    pub m: String,
    #[serde(default)]
    pub v: Vec<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct Entity {
    pub id: String,
    #[serde(default)]
    pub c: String,
    #[serde(default)]
    pub k: String,
    pub t: String,
    #[serde(default)]
    pub d: Option<String>,
    #[serde(default)]
    pub ld: Option<String>,
    #[serde(default, rename = "fn")]
    pub fn_: Option<String>,
    #[serde(default)]
    pub cn: Option<String>,
    #[serde(default)]
    pub bid: Option<String>,
    #[serde(default)]
    pub cr: Option<String>,
    #[serde(default)]
    pub inc: Vec<Link>,
    #[serde(default)]
    pub exc: Vec<Link>,
    #[serde(default)]
    pub ce: Vec<Link>,
    #[serde(default)]
    pub ix: Vec<String>,
    #[serde(default)]
    pub see: Vec<String>,
    #[serde(default)]
    pub ri: Vec<String>,
    #[serde(default)]
    pub pa: String,
    #[serde(default)]
    pub kids: Vec<String>,
    #[serde(default)]
    pub pc: Vec<Axis>,
    #[serde(default)]
    pub chap: Option<String>,
    #[serde(default)]
    pub blk: Option<String>,
}

impl Entity {
    /// Stable routing key: code, else block id, else entity id.
    pub fn key(&self) -> &str {
        if !self.c.is_empty() {
            &self.c
        } else if let Some(b) = self.bid.as_deref().filter(|b| !b.is_empty()) {
            b
        } else {
            &self.id
        }
    }

    pub fn parse(line: &[u8]) -> Result<Entity, String> {
        serde_json::from_slice(line).map_err(|e| e.to_string())
    }
}

pub fn link_label(l: &Link) -> &str {
    l.first().map(String::as_str).unwrap_or("")
}

pub fn link_target(l: &Link) -> Option<&str> {
    l.get(1).map(String::as_str)
}
