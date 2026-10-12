# Technical Debt — graft-cli

> CLI/library audit for `@guayaba/graft-cli`. Covers GRAFT scaffold generation, validation, bundling, push, assets, sidecars, and OpenClaw workspace extraction.
>
> **Last updated:** October 12, 2026

> Items #7 and #11 were resolved and removed on October 12, 2026; #3 and #10 remain active. Previously: the four pre-existing items were re-verified against the codebase on October 12, 2026 (line refs refreshed for #7 and #11) and one new item (#12) was added — #12 was resolved and removed the same day; items #1, #2, #4, #5, #6, #8 and #9 were resolved and removed on October 1, 2026 (IDs are not renumbered); #3 and #7 remained active and two new items (#10, #11) were added on October 6, 2026.

## Summary

| Severity | Active | Main categories |
|---|---:|---|
| Medium | 1 | Memory use |
| Low | 1 | Duplicated HTTP plumbing |
| **Total** | **2** | |

## Medium

### 3. Bundle upload buffers the whole tarball

**File**: `src/api/pushClient.ts:116-122` (`streamToBuffer` drains chunks into `Buffer.concat`), consumed at `:282-289` and wrapped in a `Blob` at `:301`

The push client still drains `graft.tar.gz` to a `Buffer` because Node's global `fetch` cannot compute multipart `Content-Length` for a streaming body. This is acceptable under the current backend cap, but large bundles can still spike CLI memory. Keep this debt unless the HTTP client/backend upload path changes.

---

## Newly identified (October 6, 2026)

### 10. Duplicated HTTP-client plumbing across the two API clients

**Files**: `src/api/validateClient.ts:55-58,64-75,105-124,146-150` vs `src/api/pushClient.ts:81-84,86-97,318-337,393-397` (asset-upload branch adds a third copy at `:173-190,206-210`)

`normaliseLaravelErrors`, `joinUrl`, the HTML-page guard, the non-JSON guard and the 401 handling are copy-pasted. Any change to backend error semantics must be made in two (three) places.

**Fix direction**: extract a shared `src/api/http.ts` (or a small client class) used by both clients.

