# Technical Debt — graft-cli

> CLI/library audit for `@guayaba/graft-cli`. Covers GRAFT scaffold generation, validation, bundling, push, assets, sidecars, and OpenClaw workspace extraction.
>
> **Last updated:** October 22, 2026

> Items #7 and #11 were resolved and removed on October 12, 2026; #3 and #10 remain active. Previously: the four pre-existing items were re-verified against the codebase on October 12, 2026 (line refs refreshed for #7 and #11) and one new item (#12) was added — #12 was resolved and removed the same day; items #1, #2, #4, #5, #6, #8 and #9 were resolved and removed on October 1, 2026 (IDs are not renumbered); #3 and #7 remained active and two new items (#10, #11) were added on October 6, 2026.
>
> Re-verified again on October 16, 2026: #3 and #10 remain active (#10's text was widened — the category-slug client is a third copy of the plumbing, `8f65347`), and #13 (no HTTP timeouts; the awaited category pre-check can block despite its "never blocks" docblock) was added.
>
> Re-verified against the codebase on October 21, 2026 (code at `34d2f89`): all three items remain active; #3 and #10's line references were refreshed.
>
> Resolved and removed on October 22, 2026: #13 — all three API clients now pass `AbortSignal.timeout(...)` (5 s constants, 60 s validate, 300 s push), and the category pre-check uses a 2 s deadline so it cannot block `validate`/`push` on a stalled `/grafts/constants` call. #10 — the URL join, timeout signal, HTML guard, non-JSON guard and Laravel error flattening now live in `src/api/http.ts`; each client keeps only its status/body parsing.

## Summary

| Severity | Active | Main categories |
|---|---:|---|
| Medium | 1 | Memory use |
| Low | 0 | — |
| **Total** | **1** | |

## Medium

### 3. Bundle upload buffers the whole tarball

**File**: `src/api/pushClient.ts:116-122` (`streamToBuffer` drains chunks into `Buffer.concat`), consumed at `:289` and wrapped in a `Blob` at `:301`

The push client still drains `graft.tar.gz` to a `Buffer` because Node's global `fetch` cannot compute multipart `Content-Length` for a streaming body. This is acceptable under the current backend cap, but large bundles can still spike CLI memory. Keep this debt unless the HTTP client/backend upload path changes.

