# Licensing and WHO terms

Summary of WHO's ICD-11 terms of use (https://icd.who.int/en/docs/icd11-license.pdf) as read while building this site
(November 2026). It is a working note, not legal advice. WHO can change the terms; re-read them before relying on this.

## What the data is

The ICD-11 (MMS) text shown here comes from the WHO ICD-API for release **2026-01**, English. It is licensed by WHO under
**Creative Commons Attribution-NoDerivatives 3.0 IGO (CC BY-ND 3.0 IGO)**, plus WHO's ICD-11 terms of use.

## How the site complies

| Requirement | How it is met |
|---|---|
| Attribution | Footer on every page and the setup page: "International Classification of Diseases, Eleventh Revision (ICD-11), World Health Organization (WHO) 2019 https://icd.who.int/browse11. Licensed under the Creative Commons Attribution-NoDerivatives 3.0 IGO licence (CC BY-ND 3.0 IGO)", with the release and "WHO text is shown unmodified" |
| No derivatives | WHO text is stored and shown **verbatim** (no rewriting, translating, abbreviating, re-coding). The index lowercases and stems text only for matching, never for display. Search snippets are literal excerpts with highlights. Our own additions (diagrams, graph, labels such as "Siblings") are visually and textually separate from WHO text |
| Code, title and URI stay together | Each entity carries its code and title; its WHO URI is derived from the entity id and the manifest's `uriBase` (`http://id.who.int/icd/release/11/2026-01/mms/<id>`) and is shown on the code page |
| Link to the source | Every code page links to the entry in the WHO ICD-11 browser (`https://icd.who.int/browse/2026-01/mms/en#<id>`) and the footer links WHO's terms of use |
| No endorsement | Footer: "This is an independent site. It is not affiliated with, and is not endorsed by, the World Health Organization." The WHO name and emblem are not used as branding |
| Third-party content | None loaded at runtime; images are own CC0 artwork (see [ANATOMY.md](ANATOMY.md)) |

## Constraints to keep in mind

* **Name.** WHO's terms do not allow applying for trademarks that contain "ICD". The site wordmark is "Icdex" (a play on
  index); it is fine as a label, but do not register it. Consider a name without "ICD" before any trademark step.
* **Hosting a copy.** Serving the dataset as static files (needed so the browser can build its index) is a redistribution of
  CC BY-ND material: allowed with attribution and without modification, which is why the shards are byte-for-byte WHO text
  plus structural fields from the API. The extractor only reshapes (JSON keys, ordering); it never edits strings.
* **Mappings and translations.** Mapping ICD-11 to other classifications (including ICD-10, SNOMED CT) and any translation
  need a separate agreement with WHO. Nothing like that is included.
* **Clinical use.** The site is a reference browser; it does not claim clinical accuracy beyond WHO's text.
* **Our own code.** No licence has been chosen for this repository's source yet (the crate manifest has no `license`);
  the owner should add one. The anatomy diagrams are CC0.
* **Open items for the owner.** Confirm that deriving the URI from `uriBase` + `id` satisfies "URI must travel with the
  data" for your use; if not, add a `uri` field per record in the extractor (it compresses well, so the download barely grows).
