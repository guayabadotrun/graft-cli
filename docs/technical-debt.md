# Technical Debt — graft-cli

> CLI/library audit for `@guayaba/graft-cli`. Covers GRAFT scaffold generation, validation, bundling, push, assets, sidecars, and OpenClaw workspace extraction.
>
> **Last updated:** May 2026

## Summary

| Severity | Active | Main categories |
|---|---:|---|
| Medium | 4 | Materializers, auth typing, generated docs, memory use |
| Low | 3 | Comments, exports documentation, lint workaround |

## Medium

### 1. Mechanical materializer registry is empty

**File**: `src/graft/scaffoldFields.ts`

`augmentSchemaWithMechanicalFields()` is wired, but `KNOWN_MATERIALIZERS` is `{}`. The CLI will not auto-generate `materialize` blocks until recipes are added and verified against the launcher base image.

### 2. Generated README text can overstate materializer support

**File**: `src/graft/bundle.ts`

The bundled README describes materialize examples even though no recipes are registered today. Keep the example clearly framed as manual schema authoring until the registry is populated.

### 3. Programmatic validation client accepts missing API keys

**File**: `src/api/validateClient.ts`

`ValidateClientOptions.apiKey` is optional in the TypeScript interface, but the backend rejects unauthenticated validation requests. The CLI always passes a key. Either make the type required or document anonymous use as unsupported.

### 4. Bundle upload buffers the whole tarball

**File**: `src/api/pushClient.ts`

The push client drains `graft.tar.gz` to a `Buffer` because Node's global `fetch` cannot compute multipart `Content-Length` for a streaming body. This is acceptable under the current backend cap, but large bundles can still spike CLI memory.

## Low

### 5. `void appliedSidecars` is a lint workaround

**File**: `src/cli.ts`

The push command logs sidecars earlier and then keeps `void appliedSidecars` to silence unused-variable warnings in alternate build settings. Remove it when the logging/control flow is simplified.

### 6. `src/index.ts` package-surface comment is stale

**File**: `src/index.ts`

The top-level comment understates the exported API surface. The package now exports validation/push clients, bundle helpers, metadata types, and more than just version/workspace helpers.

### 7. Category list is statically duplicated

**File**: `src/graft/package.ts`

`KNOWN_CATEGORY_SLUGS` mirrors backend-seeded categories. The CLI tolerates unknown values, but a future `GET /grafts/categories` endpoint would remove this duplication.
