# Validation — 2026-10-14 (Asia/Bangkok)

## Live sites

Independent HTTP traversal downloaded 81 XML documents from the four prefilled roots with no failures. Replaying those documents through the browser's native DOMParser and the production Collector yielded the same 64,361 unique page URLs.

The installed extension then fetched the live sites directly and downloaded a simple CSV and a detailed CSV, both with **64,363 distinct rows**, all 81 files successful and 50 duplicate entries removed. Two series pages appeared between the independent snapshot and the extension run; comparison found those two additions and no removed URLs.

| Root | Files including index | Unique page URLs in extension CSV |
|---|---:|---:|
| devilbacklink.com | 6 | 212 |
| bydbdautogroup.com | 10 | 434 |
| short-series.com | 64 | 61,849 |
| new-like.com | 1 | 1,868 |
| Total | 81 | 64,363 |

Verified the simple CSV's UTF-8 BOM, header, row count, uniqueness, and successful Chrome download state. Verified the detailed CSV's six columns, row count, per-root counts, and nonempty source_sitemap values. Counts are a snapshot, not fixed acceptance expectations for changing sites.

## Browser checks

`tests.html`: **20 checks passed** using native DOMParser. Covers namespaced XML, media exclusion, entities, metadata, malformed XML, HTML responses, unknown namespaces, missing loc, non-HTTP schemes, CSV escaping and formula protection, recursive indexes, cycles, repeated files, concurrent deduplication, preserved queries/trailing slashes, partial results, retry, concurrency limit, and stopping.

Installed-extension UI smoke test on the final app.js: intercepted fixture index and children; one 404 produced a partial CSV with one row; retry recovered the failed child, retained the existing row, and downloaded a complete two-row CSV. A second extension page was prevented from starting a competing job. The 404 fixture explains the expected browser-console network error in this smoke test.

JavaScript syntax checks passed for background.js, app.js, core.js, and tests.js. Extension page inspected visually in Chromium.

## Limits of automated verification

Used installed Chrome for Testing / Chromium 155 with a persistent test profile. The integration copy differed only by pregranting the four host permissions in its manifest, avoiding the native permission prompt in headless automation. The distributed manifest retains optional, per-domain permission requests. Native human approval of Chrome's permission prompt was not automated. Tests and validation do not install the extension into the user's normal browser profile.

Live output and screenshots are under ignored `output/`; they are not bundled into the extension ZIP.
