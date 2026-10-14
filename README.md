# sitemap dump by cybersafe

Chrome Manifest V3 extension. Collect all page URLs declared in XML sitemaps and their child files into one CSV. Enter one or more sitemap URLs, one per line.

## Install

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select this repository folder (the folder containing `manifest.json`).
4. Click the sitemap dump by cybersafe extension icon to open its working tab.
5. Paste your sitemap URLs, one per line, then click **รวบรวมและดาวน์โหลด CSV** and allow access to the selected sites.

No build step or runtime dependencies. Keep the working tab open until collection and download finish. The toolbar icon focuses an existing working tab; competing tabs are blocked because they share the local results database.

## Behavior

- Multiple root URLs; XML `urlset` / `sitemapindex`, nested indexes, redirects, namespaces, XML entities, split sitemaps.
- Three concurrent requests at most; 30-second timeout per attempt; up to three attempts for transient errors, bounded Retry-After delay for 429/5xx.
- Follows child files explicitly listed in indexes; does not guess pagination filenames or crawl web pages.
- Uses only the direct sitemap `url/loc` field. Media URLs and index-file URLs are not exported.
- Deduplicates page URLs across all roots; preserves query strings, paths, and trailing slashes. First occurrence supplies metadata.
- Results stored in IndexedDB in the extension. A new run replaces the previous results. Reopening the tab does not resume or expose the previous run in this release.
- UTF-8 BOM CSV with CRLF, quoted cells, and spreadsheet formula protection. Simple mode: `url`. Detail mode: `url,lastmod,changefreq,priority,source_sitemap,root_sitemap`.
- Completed runs trigger one CSV download. Failed or stopped runs export available results with `-partial` in the filename. Retry keeps successful results and processes failed and pending files.
- Access to root domains requested at start. Cross-domain child files without permissions appear in the failure list; Retry requests their permissions.
- No server or analytics. Requests omit cookies. Sites requiring login or bot challenges may fail and remain visible in the error list.

Phase 1 supports XML only. Gzip files, text feeds, RSS/Atom, discovery through robots.txt, restart recovery, and media exports are deferred.

## Validation

Open `tests.html` using a local HTTP server to run browser-based parser, queue, deduplication, retry, and CSV checks. This uses the browser's actual XML parser. `tests.html` is not loaded by the extension's UI.

```sh
python3 -m http.server 8765
```

Visit `http://localhost:8765/tests.html`. See `VALIDATION.md` for recorded live-site validation and its limits.
