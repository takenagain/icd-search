//! Client-side search over the ICD-11 MMS dataset. The same code runs natively
//! (tests, benchmarks) and as WebAssembly inside a Web Worker.

pub mod data;
pub mod index;
pub mod search;
pub mod text;

pub use search::{Engine, SearchResponse};

#[cfg(target_arch = "wasm32")]
mod wasm;
