# Technical Debt — graft-cli

> CLI/library audit for `@guayaba/graft-cli`. Covers GRAFT scaffold generation, validation, bundling, push, assets, sidecars, and OpenClaw workspace extraction.
>
> **Last updated:** October 21, 2026

> Items #7 and #11 were resolved and removed on October 12, 2026; #3 and #10 remain active. Previously: the four pre-existing items were re-verified against the codebase on October 12, 2026 (line refs refreshed for #7 and #11) and one new item (#12) was added — #12 was resolved and removed the same day; items #1, #2, #4, #5, #6, #8 and #9 were resolved and removed on October 1, 2026 (IDs are not renumbered); #3 and #7 remained active and two new items (#10, #11) were added on October 6, 2026.
>
> Re-verified again on October 16, 2026: #3 and #10 remain active (#10's text was widened — the category-slug client is a third copy of the plumbing, `8f65347`), and #13 (no HTTP timeouts; the awaited category pre-check can block despite its "never blocks" docblock) was added.
>
> Re-verified against the codebase on October 21, 2026 (code at `34d2f89`): all three items remain active; #3 and #10's line references were refreshed.

## Summary

| Severity | Active | Main categories |
|---|---:|---|
| Medium | 1 | Memory use |
| Low | 2 | Duplicated HTTP plumbing, missing request timeouts |
| **Total** | **3** | |

## Medium

### 3. Bundle upload buffers the whole tarball

**File**: `src/api/pushClient.ts:116-122` (`streamToBuffer` drains chunks into `Buffer.concat`), consumed at `:289` and wrapped in a `Blob` at `:301`

The push client still drains `graft.tar.gz` to a `Buffer` because Node's global `fetch` cannot compute multipart `Content-Length` for a streaming body. This is acceptable under the current backend cap, but large bundles can still spike CLI memory. Keep this debt unless the HTTP client/backend upload path changes.

---

## Newly identified (October 6, 2026)

### 10. Duplicated HTTP-client plumbing across three API clients

**Files**: `src/api/validateClient.ts:55-58,64-75,105-124,146-150` vs `src/api/pushClient.ts:81-84,86-97,318-338,393-397` (asset-upload branch adds another copy at `:174-191,207-211`) vs `src/api/constantsClient.ts:56-58,98-104,110-113,116-119` (added with the live-constants fetch, `8f65347`)

`normaliseLaravelErrors`, `joinUrl`, the HTML-page guard, the non-JSON guard and the 401 handling are copy-pasted across all three clients. Any change to backend error semantics must be made in three places (four counting the asset branch).

**Fix direction**: extract a shared `src/api/http.ts` (or a small client class) used by all three clients.

---

## Newly identified (October 16, 2026)

### 13. No HTTP request timeouts; the awaited category pre-check can block the command

**Files**: `src/api/validateClient.ts`, `src/api/pushClient.ts`, `src/api/constantsClient.ts` (no `signal` / `AbortController` / timeout anywhere — grep), `src/cli.ts:145-162` (`warnUnknownCategorySlugs` awaits `resolveCategorySlugs` before validate/push)

**Current behavior**: none of the three API clients sets a request timeout, so a stalled connection hangs the CLI indefinitely. The category pre-check introduced by `8f65347` is awaited before `validate` and `push` despite its docblock saying "Never blocks the command" (`src/cli.ts:149`) — when `/grafts/constants` hangs, the command hangs with it instead of falling back to the compiled-in slug list.

**Fix direction**: give the shared HTTP helper (#10) a configurable timeout (`AbortSignal.timeout(...)`) and make the pre-check truly best-effort (race it against a short deadline, or drop the await).

