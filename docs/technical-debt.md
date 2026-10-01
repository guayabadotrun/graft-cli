# Technical Debt — graft-cli

> CLI/library audit for `@guayaba/graft-cli`. Covers GRAFT scaffold generation, validation, bundling, push, assets, sidecars, and OpenClaw workspace extraction.
>
> **Last updated:** September 2026

> Re-verified against the codebase on September 29, 2026. Items #1, #2, #4, #5, #6, #8 and #9 were resolved on October 1, 2026; the remaining items stay active.

## Summary

| Severity | Active | Main categories |
|---|---:|---|
| Medium | 1 | Memory use |
| Low | 1 | Category duplication |
| **Total** | **2** | |

## Medium

### 3. Bundle upload buffers the whole tarball

**File**: `src/api/pushClient.ts`

The push client still drains `graft.tar.gz` to a `Buffer` because Node's global `fetch` cannot compute multipart `Content-Length` for a streaming body. This is acceptable under the current backend cap, but large bundles can still spike CLI memory. Keep this debt unless the HTTP client/backend upload path changes.

## Low

### 7. Category list is statically duplicated

**File**: `src/graft/package.ts`

`KNOWN_CATEGORY_SLUGS` still mirrors backend-seeded categories. The CLI tolerates unknown values, but a future `GET /grafts/categories` endpoint would remove this duplication.

