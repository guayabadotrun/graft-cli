# Technical Debt — graft-cli

> CLI/library audit for `@guayaba/graft-cli`. Covers GRAFT scaffold generation, validation, bundling, push, assets, sidecars, and OpenClaw workspace extraction.
>
> **Last updated:** October 2026

> Re-verified against the codebase on October 6, 2026. Items #1, #2, #4, #5, #6, #8 and #9 were resolved and removed on October 1, 2026 (IDs are not renumbered); #3 and #7 remain active and two new items (#10, #11) were added.

## Summary

| Severity | Active | Main categories |
|---|---:|---|
| Medium | 1 | Memory use |
| Low | 3 | Category duplication, duplicated HTTP plumbing, stale gene-seed refs |
| **Total** | **4** | |

## Medium

### 3. Bundle upload buffers the whole tarball

**File**: `src/api/pushClient.ts:116-122` (`streamToBuffer` drains chunks into `Buffer.concat`), consumed at `:282-289` and wrapped in a `Blob` at `:301`

The push client still drains `graft.tar.gz` to a `Buffer` because Node's global `fetch` cannot compute multipart `Content-Length` for a streaming body. This is acceptable under the current backend cap, but large bundles can still spike CLI memory. Keep this debt unless the HTTP client/backend upload path changes.

## Low

### 7. Category list is statically duplicated

**File**: `src/graft/package.ts:54-61` (`KNOWN_CATEGORY_SLUGS`), stale comment at `:46-48`

`KNOWN_CATEGORY_SLUGS` still mirrors backend-seeded categories, but the endpoint it was waiting for now exists: `GET /api/grafts/constants` returns live `category_slugs` (`convolution-api/app/Http/Controllers/API/Graft/ListGraftConstantsController.php:62`, route at `routes/api.php:223`). No file under `graft-cli/src` calls it, and the comment still says "before we have a `GET /grafts/categories` endpoint".

**Fix direction**: fetch the slugs from `/api/grafts/constants` at build/validate time (with the static list as offline fallback) and drop the stale comment.

---

## Newly identified (October 6, 2026)

### 10. Duplicated HTTP-client plumbing across the two API clients

**Files**: `src/api/validateClient.ts:55-58,64-75,105-124,146-150` vs `src/api/pushClient.ts:81-84,86-97,318-337,393-397` (asset-upload branch adds a third copy at `:173-190,206-210`)

`normaliseLaravelErrors`, `joinUrl`, the HTML-page guard, the non-JSON guard and the 401 handling are copy-pasted. Any change to backend error semantics must be made in two (three) places.

**Fix direction**: extract a shared `src/api/http.ts` (or a small client class) used by both clients.

### 11. Stale gene-seed references (moved docs and dead section numbers)

**Files**: `src/graft/bundle.ts:33`, `src/graft/build.ts:32` (both cite `gene-seed/internal/roadmap/grafts-marketplace.md` §0.3/§0.4), `src/graft/build.ts:41` (`§2.1`), `src/graft/package.ts:5` (`§2.1.1`), `src/openclaw/extract.ts:30` (`§1.1`)

The roadmap file was reorganized (its own header: "Last reorg: 2026-04-29") and no longer contains those sections; the shipped behavior lives in `gene-seed/internal/grafts/marketplace.md`, which uses no numbered scheme.

**Fix direction**: point the comments at the current doc (file, not section numbers).

