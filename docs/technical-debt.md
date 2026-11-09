# Technical Debt — graft-cli

> CLI/library audit for `@guayaba/graft-cli`. Covers GRAFT scaffold generation, validation, bundling, push, assets, sidecars, and OpenClaw workspace extraction.
>
> **Last updated:** November 8, 2026 (re-verified against `56a5465`).

> IDs are stable: resolved items are removed and their numbers are never reused.

## Summary

| Severity | Active | Main categories |
|---|---:|---|
| High | 1 | Release state |
| Medium | 2 | Memory use, wrong endpoint path |
| Low | 6 | Missing CI, validate/push schema drift, discarded `is_personal`, malformed `graft.json` raw error (#9), optional-file copy swallows errors (#10), generated doc points at the wrong path (#11) |
| **Total** | **9** | |

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

**File**: `src/api/constantsClient.ts:75` (`joinApiUrl('/grafts/constants')`), `src/api/http.ts:28-31` (joins onto `API_BASE_URL`), `src/config.ts:8` (`API_BASE_URL` defaults to `https://api.guayaba.run/api/v1`); backend `convolution-api/routes/api.php:364`
**Severity**: Medium

The CLI requests `/api/v1/grafts/constants`, but the backend registers the endpoint only at `/api/grafts/constants`, inside the Sanctum-authenticated marketplace group (`routes/api.php:364`); the Public API v1 group (`routes/api.php:900-907`) exposes validate, push and assets only. The lookup therefore cannot succeed, and `resolveCategorySlugs` swallows the failure (`constantsClient.ts:145-157`), so the CLI silently falls back to `KNOWN_CATEGORY_SLUGS` and never uses the live whitelist.

Fix: point the client at a route that exists — either add the constants endpoint to the master-key v1 group or call `/api/grafts/constants` with the right auth — and surface a warning when the live list is unavailable instead of falling back silently.

## Newly identified (2026-11-03)

### 6. No CI despite the documented gate

**Files**: no `.github/` directory; `package.json:27-33` (scripts); `AGENTS.md:110-113` ("Done means")

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

## Newly identified (2026-11-08)

### 9. A malformed `graft.json` surfaces a raw `TypeError`

**Files**: `src/cli.ts:59,75-86,492`, `src/harness/sidecars.ts:33,43,49`

**Severity**: Low

`readGraftEnvelope()` only checks that `metadata` and `schema` keys exist (`cli.ts:75-86`). `inlineSidecars()` then spreads `schema.harness_constraints` and maps `schema.fields` (`sidecars.ts:43,49`) without checking that they are arrays, so a hand-edited envelope missing either key throws a `TypeError`. The top-level `cli.ts:492` `.catch` turns it into `console.error(err.message); process.exit(1)`, so it is not an unhandled crash, but the user sees a raw TypeError instead of a clear validation error.

Fix: validate the envelope shape (`metadata`/`schema` objects, `harness_constraints`/`fields` arrays) before any sidecar work and fail with a `graft.json is not a valid GRAFT envelope` message.

### 10. Optional-file copies swallow every error

**Files**: `src/harness/sidecars.ts:200-222`

**Severity**: Low

`TOOLS.md` and `install.sh` are copied with bare `catch {}` blocks (`sidecars.ts:207,220`). A permission or I/O failure is reported as "absent" instead of surfacing, so a scaffold can silently omit a file the author expected to ship.

Fix: only treat `ENOENT` as absent; rethrow (or warn) on other errors.

### 11. The generated bundle README names the wrong push path

**Files**: `src/graft/bundle.ts:468`, `src/api/pushClient.ts:275`, `src/config.ts:8`

**Severity**: Low

The scaffold README renders "This calls `POST /api/grafts` with your master API key" (`bundle.ts:468`), while the CLI actually posts to `${API_BASE_URL}/grafts` (`pushClient.ts:275`) with the default base `https://api.guayaba.run/api/v1` (`config.ts:8`). Authors following the generated README hit the Sanctum route instead of the public v1 route.

Fix: render the actual v1 path (or derive it from `API_BASE_URL`).

