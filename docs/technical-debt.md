# Technical Debt — graft-cli

> CLI/library audit for `@guayaba/graft-cli`. Covers GRAFT scaffold generation, validation, bundling, push, assets, sidecars, and OpenClaw workspace extraction.
>
> **Last updated:** June 2026

## Summary

| Severity | Active | Main categories |
|---|---:|---|
| Medium | 4 | Auth typing, generated docs, memory use, stale generated push instructions |
| Low | 3 | Comments, exports documentation, lint workaround |

> Re-verified against the codebase on May 10, 2026. Resolved and accepted items have been removed from this debt list; items below are active.

## Medium

### 1. Generated README text can overstate materializer support

**File**: `src/graft/bundle.ts`

The bundled README still says the scaffold pre-fills mechanical entries such as skill/channel secret fields and a `GITHUB_TOKEN` materializer. Current code does not derive those fields, and the materializer registry is intentionally empty. Rewrite this generated README section so materializers are framed as manual schema authoring unless/until a recipe is registered.

### 2. Programmatic validation client accepts missing API keys

**File**: `src/api/validateClient.ts`

`ValidateClientOptions.apiKey` is optional in the TypeScript interface, and `validateGraftPackage()` simply omits the `Authorization` header when absent. The backend rejects anonymous validation with 401. The CLI always resolves and passes a key. Either make the type required in the next breaking library release or keep it optional but explicitly document that anonymous validation is unsupported and returns a request error.

### 3. Bundle upload buffers the whole tarball

**File**: `src/api/pushClient.ts`

The push client still drains `graft.tar.gz` to a `Buffer` because Node's global `fetch` cannot compute multipart `Content-Length` for a streaming body. This is acceptable under the current backend cap, but large bundles can still spike CLI memory. Keep this debt unless the HTTP client/backend upload path changes.

### 4. Generated README still documents an obsolete tarball push flow

**Files**: `src/graft/bundle.ts`, `src/cli.ts`, `gene-seed/internal/grafts/marketplace-features.md`

The generated README still says "Until the Upload bundle UI ships" and instructs `npx @guayaba/graft-cli push ./${slug}-${version}.tar.gz`. Current CLI `push` requires scaffold input (`--framework`, optional `--input`) and the manager UI upload flow already exists under `/grafts/mine`.

**Fix direction**: regenerate the README section to document the current scaffold-based push flow (`graft push --framework openclaw --input <scaffold_dir>`) and remove the stale "upload UI not shipped" wording.

## Low

### 5. `void appliedSidecars` is a lint workaround

**File**: `src/cli.ts`

The push command logs sidecars immediately before upload and still keeps `void appliedSidecars`. In current code this is redundant; remove it when the logging/control flow is simplified.

### 6. `src/index.ts` package-surface comment is stale

**File**: `src/index.ts`

The top-level comment still understates the exported API surface. The package now exports validation/push clients, bundle helpers, metadata types, and more than just version/workspace helpers.

### 7. Category list is statically duplicated

**File**: `src/graft/package.ts`

`KNOWN_CATEGORY_SLUGS` still mirrors backend-seeded categories. The CLI tolerates unknown values, but a future `GET /grafts/categories` endpoint would remove this duplication.
