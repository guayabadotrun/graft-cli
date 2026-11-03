# Technical Debt — graft-cli

> CLI/library audit for `@guayaba/graft-cli`. Covers GRAFT scaffold generation, validation, bundling, push, assets, sidecars, and OpenClaw workspace extraction.
>
> **Last updated:** November 3, 2026.

> IDs are stable: resolved items are removed and their numbers are never reused.

## Summary

| Severity | Active | Main categories |
|---|---:|---|
| High | 1 | Release state |
| Medium | 2 | Memory use, wrong endpoint path |
| Low | 3 | Missing CI, validate/push schema drift, discarded `is_personal` |
| **Total** | **6** | |

## Medium

### 3. Bundle upload buffers the whole tarball

**File**: `src/api/pushClient.ts:107-113` (`streamToBuffer` drains chunks into `Buffer.concat`), consumed at `:267` and wrapped in a `Blob` at `:279`

The push client still drains `graft.tar.gz` to a `Buffer` because Node's global `fetch` cannot compute multipart `Content-Length` for a streaming body. This is acceptable under the current backend cap, but large bundles can still spike CLI memory. Keep this debt unless the HTTP client/backend upload path changes.

## Newly identified (2026-11-01)

### 4. Published npm `latest` lags the source

**File**: `package.json:3`, `package.json:21-26` (published files), `src/cli.ts:151-162` (constants pre-check), `src/graft/metadata.ts:54-55` (`tier`/`price_usd` defaults)
**Severity**: High

`npm view @guayaba/graft-cli version` reports `0.0.6` while the source tree is `0.1.2`. The published artifact predates the current CLI contract: 0.0.6 accepts `--framework` (no `--harness`) and contains neither `price_usd` nor the `GET /grafts/constants` lookup, so the behaviour the README documents for `validate`/`push` is missing from the installable package.

Fix: publish 0.1.x from the current tree, then delete the README release-state note.

### 5. `GET /grafts/constants` is called on a path the backend does not expose

**File**: `src/api/constantsClient.ts:75` (`joinApiUrl('/grafts/constants')`), `src/api/http.ts:28-31` (joins onto `API_BASE_URL`), `src/config.ts:9` (`API_BASE_URL` defaults to `https://api.guayaba.run/api/v1`); backend `convolution-api/routes/api.php:344`
**Severity**: Medium

The CLI requests `/api/v1/grafts/constants`, but the backend registers the endpoint only at `/api/grafts/constants`, inside the Sanctum-authenticated marketplace group (`routes/api.php:344`); the Public API v1 group (`routes/api.php:838-845`) exposes validate, push and assets only. The lookup therefore cannot succeed, and `resolveCategorySlugs` swallows the failure (`constantsClient.ts:145-157`), so the CLI silently falls back to `KNOWN_CATEGORY_SLUGS` and never uses the live whitelist.

Fix: point the client at a route that exists — either add the constants endpoint to the master-key v1 group or call `/api/grafts/constants` with the right auth — and surface a warning when the live list is unavailable instead of falling back silently.

## Newly identified (2026-11-03)

### 6. No CI despite the documented gate

**Files**: no `.github/` directory; `package.json:27-33` (scripts); `AGENTS.md:107-109` ("Done means")

**Severity**: Low

`AGENTS.md` declares `npm run typecheck && npm run test` as the completion gate, but the repository has no CI workflow, so nothing enforces it on push or PR.

Fix: add a `.github/workflows` job that runs `npm ci`, `npm run typecheck` and `npm test`.

### 7. `validate` skips the mechanical schema augmentation that `push` applies

**Files**: `src/api/validateClient.ts:64-84`, `src/api/pushClient.ts:248-251`, `src/graft/scaffoldFields.ts` (`augmentSchemaWithMechanicalFields`)

**Severity**: Low

`pushGraftPackage` derives mechanical fields and rebuilds the schema before bundling and POSTing (`pushClient.ts:248-251`). `validateGraftPackage` serializes the package as-is (`validateClient.ts:84`), so a package whose mechanical fields are derived only at push time can validate differently from what is actually pushed.

Fix: apply `augmentSchemaWithMechanicalFields` in `validateGraftPackage` before serializing.

### 8. `push` discards the backend's `is_personal`

**Files**: `convolution-api/app/Http/Controllers/API/Graft/PushGraftController.php:85-93`, `src/api/pushClient.ts:314-324`

**Severity**: Low

The backend returns `data.is_personal` on a successful push, but the CLI's `PushResult` only maps `id`, `slug`, `version`, `version_id`, `bundle_s3_key` and `assets`, so callers cannot tell a personal draft from a shared bundle.

Fix: add `isPersonal` to `PushResult` and populate it from `data.is_personal`.

