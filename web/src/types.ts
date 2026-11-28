// Shapes exchanged with the Rust engine (see crates/icd-search/src/search.rs) and the manifest.

export interface Manifest {
  schema: number;
  datasetId: string;
  release: string;
  releaseDate: string;
  language: string;
  linearization: string;
  entities: number;
  uriBase: string;
  browserBase: string;
  source: string;
  license: { name: string; url: string; terms: string };
  index: { strategy: string; format: number };
  totals: { bytes: number; br: number; gz: number; shards: number };
  shards: { file: string; sha256: string; bytes: number; lines: number; br: number; gz: number }[];
}

export type Kind = 'category' | 'chapter' | 'block' | 'window';

export interface Brief {
  key: string;
  code: string;
  title: string;
  kind: Kind;
  def?: string;
}

export interface BrowseEntry extends Brief {
  hasChildren: boolean;
  chapter?: string;
}

export interface BrowseMatches {
  items: BrowseEntry[];
  total: number;
}

export interface Crumb {
  key: string;
  code: string;
  title: string;
  kind: Kind;
}

export interface Hit {
  key: string;
  code: string;
  kind: Kind;
  title: string;
  titleParts: string[];
  crumbs: Crumb[];
  snippet?: { label: string; parts: string[] };
  score: number;
  via: 'code' | 'text';
}

export interface SearchResponse {
  query: string;
  total: number;
  page: number;
  per_page: number;
  pages: number;
  fuzzy: string[];
  hits: Hit[];
}

export interface Suggestion {
  text: string;
  key: string;
  kind: 'code' | 'term';
  title: string;
}

export interface LinkItem {
  label: string;
  target: Brief | null;
}

export interface Detail {
  key: string;
  id: string;
  code: string;
  kind: Kind;
  title: string;
  definition: string | null;
  longDefinition: string | null;
  fullySpecifiedName: string | null;
  codingNote: string | null;
  blockId: string | null;
  codeRange: string | null;
  path: Brief[];
  parent: Brief | null;
  children: { items: Brief[]; total: number };
  siblings: { items: Brief[]; total: number };
  inclusions: LinkItem[];
  exclusions: LinkItem[];
  codedElsewhere: LinkItem[];
  seeAlso: Brief[];
  relatedImpairment: string[];
  indexTerms: string[];
  axes: { axis: string; required: boolean; multiple: string; values: Brief[]; total: number }[];
}

export interface Neighbors {
  center: Brief;
  parent: Brief | null;
  children: { items: Brief[]; total: number };
  refs: { rel: 'exclusion' | 'coded_elsewhere' | 'inclusion' | 'see_also'; label: string; node: Brief }[];
}

// ---- setup flow ----

export type StepId = 'manifest' | 'storage' | 'download' | 'verify' | 'store' | 'index';

export interface StepEvent {
  step: StepId;
  status: 'active' | 'done' | 'error';
  done?: number;
  total?: number;
  note?: string;
}

export interface Status {
  stored: boolean;
  datasetId?: string;
  release?: string;
  releaseDate?: string;
  entities?: number;
  bytes?: number;
  completedAt?: string;
  manifest?: Manifest;
}

export interface StorageInfo {
  usage?: number;
  quota?: number;
  persisted?: boolean;
}
