import type { Manifest } from './types';

/** Shared, read-mostly app state. */
export const state: { manifest?: Manifest } = {};

export function whoUrl(id: string): string {
  const base = state.manifest?.browserBase ?? 'https://icd.who.int/browse/2026-01/mms/en';
  return `${base}#${id}`;
}

export function uri(id: string): string {
  const base = state.manifest?.uriBase ?? 'http://id.who.int/icd/release/11/2026-01/mms';
  return `${base}/${id}`;
}
