import { h } from '../ui/h';
import { client } from '../client';
import { footer, page, topBar, bytes, fmt } from '../ui/shell';
import { state } from '../state';
import { ANATOMY_CREDITS } from '../anatomy/anatomy';

export async function aboutView(update: { available: boolean } | null, applyUpdate: () => void): Promise<{ el: HTMLElement; title: string }> {
  const st = await client.status();
  const stats = await client.stats().catch(() => null);
  const storage = await client.storageInfo().catch(() => ({}) as { usage?: number; quota?: number; persisted?: boolean });
  const m = state.manifest;
  const status = h('p', { role: 'status', class: 'hint' });

  const clearBtn = h('button', { class: 'btn danger', type: 'button' }, 'Clear local data');
  clearBtn.addEventListener('click', async () => {
    if (!confirm('Delete the downloaded ICD-11 data and the search index from this browser? You can download them again.')) return;
    clearBtn.disabled = true;
    status.textContent = 'Clearing…';
    try {
      await client.clear();
      location.assign('/');
    } catch (e) {
      status.textContent = e instanceof Error ? e.message : String(e);
      clearBtn.disabled = false;
    }
  });

  const el = page(
    'about-page',
    topBar(),
    h(
      'main',
      { id: 'main', class: 'about' },
      h('h1', { tabindex: '-1' }, 'About'),
      h('p', null, 'Icdex is a static, client-side search site for the WHO ICD-11 MMS classification. The server only hands out files; the search engine (Rust compiled to WebAssembly) runs in your browser and nothing you type leaves it.'),
      h(
        'section',
        { class: 'card wide', 'aria-labelledby': 'dv' },
        h('h2', { id: 'dv' }, 'Data version'),
        h(
          'dl',
          null,
          h('dt', null, 'Classification'),
          h('dd', null, 'ICD-11 for Mortality and Morbidity Statistics (MMS), English'),
          h('dt', null, 'Release'),
          h('dd', null, st.stored ? `${st.release} (${st.releaseDate})` : 'not stored'),
          h('dt', null, 'Entries'),
          h('dd', null, st.entities ? fmt(st.entities) : '-'),
          h('dt', null, 'Dataset id'),
          h('dd', null, h('code', null, st.datasetId ? st.datasetId.slice(0, 16) : '-')),
          h('dt', null, 'Stored data'),
          h('dd', null, st.bytes ? `${bytes(st.bytes)} (about ${bytes(m?.totals.br ?? 0)} downloaded)` : '-'),
          h('dt', null, 'Search index'),
          h('dd', null, stats ? `${fmt(stats.terms)} terms, ${fmt(stats.postings)} postings` : '-'),
          h('dt', null, 'Browser storage'),
          h('dd', null, storage.quota ? `${bytes(storage.usage ?? 0)} used of ${bytes(storage.quota)} · ${storage.persisted ? 'persistent' : 'best-effort'}` : 'unknown'),
          h('dt', null, 'Saved'),
          h('dd', null, st.completedAt ? new Date(st.completedAt).toLocaleString('en') : '-'),
        ),
        update?.available ? h('p', { class: 'banner' }, 'A newer dataset is available. ', h('button', { class: 'btn small', type: 'button', onClick: applyUpdate }, 'Update now')) : h('p', { class: 'hint' }, 'This is the newest dataset on the server.'),
        h('div', { class: 'actions' }, clearBtn),
        status,
      ),
      h(
        'section',
        { class: 'card wide' },
        h('h2', null, 'Licence and attribution'),
        h('p', null, 'International Classification of Diseases, Eleventh Revision (ICD-11), World Health Organization (WHO) 2019 ', h('a', { href: 'https://icd.who.int/browse11', target: '_blank', rel: 'noopener' }, 'https://icd.who.int/browse11'), '. Licensed under the Creative Commons Attribution-NoDerivatives 3.0 IGO licence (', h('a', { href: 'https://creativecommons.org/licenses/by-nd/3.0/igo/', target: '_blank', rel: 'noopener' }, 'CC BY-ND 3.0 IGO'), ').'),
        h('p', null, 'WHO text (titles, definitions, inclusions, exclusions, index terms) is displayed verbatim. Each entry carries its code, title and WHO URI (shown on the code page) and links to the official browser. The graph view, the anatomy highlights, the search index and the grouping of results are additions that do not originate from WHO. This site is not affiliated with and not endorsed by WHO. It is not a medical device and does not replace professional coding or clinical judgement.'),
        h('p', null, h('a', { href: 'https://icd.who.int/en/docs/icd11-license.pdf', target: '_blank', rel: 'noopener' }, 'WHO terms of use and licence agreement')),
      ),
      h(
        'section',
        { class: 'card wide' },
        h('h2', null, 'Anatomy diagram credits'),
        h('ul', { class: 'credits' }, ANATOMY_CREDITS.map((c) => h('li', null, h('a', { href: c.page, target: '_blank', rel: 'noopener' }, c.title), ` — ${c.author}, ${c.license}. `, c.note ?? ''))),
      ),
    ),
    footer(m),
  );
  return { el, title: 'About - Icdex' };
}
