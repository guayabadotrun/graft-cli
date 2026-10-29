# Technical Debt — graft-cli

> CLI/library audit for `@guayaba/graft-cli`. Covers GRAFT scaffold generation, validation, bundling, push, assets, sidecars, and OpenClaw workspace extraction.
>
> **Last updated:** October 29, 2026.

> IDs are stable: resolved items are removed and their numbers are never reused.

## Summary

| Severity | Active | Main categories |
|---|---:|---|
| Medium | 1 | Memory use |
| Low | 0 | — |
| **Total** | **1** | |

## Medium

### 3. Bundle upload buffers the whole tarball

**File**: `src/api/pushClient.ts:107-113` (`streamToBuffer` drains chunks into `Buffer.concat`), consumed at `:267` and wrapped in a `Blob` at `:279`

The push client still drains `graft.tar.gz` to a `Buffer` because Node's global `fetch` cannot compute multipart `Content-Length` for a streaming body. This is acceptable under the current backend cap, but large bundles can still spike CLI memory. Keep this debt unless the HTTP client/backend upload path changes.

