# AGENTS.md — graft-cli

## Quick Reference

**Stack:** Node.js / TypeScript, ESM + CJS dual build, `tsup` — binary: `dist/cli.js` (`graft`)

**Critical foot-guns:**
- **Scaffold file is `graft.json`**, not `schema.json`. The bundle writes `schema.json` + `metadata.json` separately inside the tar.
- **`validate` requires an API key** — the endpoint is auth-gated even though it's read-only.
- **Only master API keys work** — slave keys get HTTP 403 on `POST /grafts` and asset endpoints.
- **`augmentSchemaWithMechanicalFields` must be called before POSTing** — the form-field `schema` must match the bundle's `schema.json` exactly.
- **`install.sh` is force-chmod'd to `0755`** in the bundle regardless of source file mode.
- **`ALLOWED_GRAFT_CHANNELS = ['telegram']`** — `chat` is NOT a channel.
- **`schema_version: 2` only** — any other value (including the string `"2"`) is rejected by the backend.
- **`$GUAYABA_API_BASE_URL`** overrides the default API URL — env-only, intentionally no CLI flag.

**Key files:** `src/cli.ts`, `src/graft/build.ts`, `src/graft/bundle.ts`, `src/api/pushClient.ts`, `src/api/validateClient.ts`, `src/framework/mapping.ts`

> Platform map and inter-service auth: `gene-seed/AGENTS.md`

---

## Full Reference

### What this is

`@guayaba/graft-cli` is the CLI tool (`graft` binary) for authoring Guayaba GRAFT templates from running agent workspaces. It reads an OpenClaw workspace, scaffolds a `graft.json` + sidecar files, validates/bundles them, and pushes the result to the Guayaba backend API.

### How to run / develop

| Script | Command |
|---|---|
| Build (once) | `npm run build` → `tsup` → `dist/` |
| Dev (watch) | `npm run dev` → `tsup --watch` |
| Tests | `npm test` → `vitest run` |
| Type-check | `npm run typecheck` → `tsc --noEmit` |

Node ≥ 18 required (uses global `fetch`, `FormData`, `Blob`).

### CLI commands

| Command | What it does | API key required? | API endpoints called |
|---|---|---|---|
| `graft init --framework <slug> [-w <workspace>] [-o <out>]` | Read workspace, build `graft.json` + blank sidecar stubs + copy skills | No | None |
| `graft validate --framework <slug> [-i <scaffold>]` | Inline sidecars into schema, POST to backend for validation | **Yes** | `POST /grafts/validate` |
| `graft pack --framework <slug> [-i <scaffold>] [-o <out>] [-f]` | Inline sidecars, build `graft.tar.gz` locally | No | None |
| `graft push --framework <slug> [-i <scaffold>] [--icon <path>] [--cover <path>]` | Inline sidecars, upload assets, build and POST bundle | **Yes** | `POST /grafts/{slug}/assets/{type}`, `POST /grafts` |

All commands require `--framework` (currently only `openclaw` is supported).

### Key files

| File | What it does |
|---|---|
| `src/cli.ts` | Commander program, all four commands, shared helpers (`resolveApiKey`, `loadScaffold`, `reportValidation`) |
| `src/index.ts` | Programmatic entry point; re-exports safe, side-effect-free APIs |
| `src/config.ts` | Exports `API_BASE_URL` — defaults to `https://api.guayaba.run/api/v1`, overridable via `$GUAYABA_API_BASE_URL` |
| `src/framework/mapping.ts` | Static registry: `FrameworkSlug`, `FRAMEWORK_MAPPINGS`, scaffold filename ↔ workspace filename → `defaults` dot-path table |
| `src/framework/sidecars.ts` | `inlineSidecars`, `copyWorkspaceSidecars`, `copyWorkspaceSkills` |
| `src/graft/build.ts` | Pure builder: OpenClaw summary → `GraftDocument` (`schema_version: 2`); defines `ALLOWED_GRAFT_CHANNELS` |
| `src/graft/bundle.ts` | Assembles `graft.tar.gz` via `tar` child process; stages in `os.tmpdir()` |
| `src/graft/scaffoldFields.ts` | `augmentSchemaWithMechanicalFields` — attaches `materialize` blocks to `secret` fields; `KNOWN_MATERIALIZERS` is currently empty `{}` |
| `src/api/validateClient.ts` | `POST /grafts/validate` — auth-gated |
| `src/api/pushClient.ts` | `POST /grafts` (multipart: `bundle`, `metadata`, `schema`) + `POST /grafts/{slug}/assets/{type}` (plain `POST`) |
| `src/openclaw/workspace.ts` | Reads an OpenClaw workspace from disk |
| `src/openclaw/extract.ts` | `extractOpenclawSummary` — produces `OpenclawAgentSummary` |
| `src/openclaw/skills.ts` | `listInstalledSkills`, `parseSkillFrontmatter`, `tarSkillBundle`, `buildSkillManifest` |

### API surface

| Endpoint | Method | Auth | Content-Type |
|---|---|---|---|
| `/grafts/validate` | POST | `Authorization: Bearer <master_key>` | `application/json` |
| `/grafts` | POST | `Authorization: Bearer <master_key>` | `multipart/form-data` (fields: `metadata` JSON string, `schema` JSON string, `bundle` tar.gz) |
| `/grafts/{slug}/assets/icon` | POST | `Authorization: Bearer <master_key>` | `multipart/form-data` (field: `file` Blob) |
| `/grafts/{slug}/assets/cover` | POST | `Authorization: Bearer <master_key>` | `multipart/form-data` (field: `file` Blob) |

HTTP outcomes:
- `validate`: 200 → ok+warnings, 422 → validation issues, 401 → bad key
- `push /grafts`: 201 → success (`id`, `version_id`, `bundle_s3_key`), 409 → conflict (version already exists — bump `metadata.version`; or slug owned by another tenant), 401 → bad key, 403 → slave key
- `push assets`: 200 → ok+path, 401 → bad key, 403 → slave key

### Non-obvious rules

- **Bundle is drained to a `Buffer` in `pushClient.ts`** — Node's global `fetch` can't compute multipart `Content-Length` from a streaming body; the whole bundle is buffered in memory (backend cap: 200 MB).
- **Asset uploads use plain `POST`** — the backend route accepts both `POST` and `PUT`. Do not send method-spoofing fields.
- **Non-interactive re-init is blocked** — `graft init` refuses to overwrite an existing scaffold dir when not in a TTY.
- **`KNOWN_MATERIALIZERS` is currently empty** — the `materialize` enrichment is wired but no env-key recipes are registered yet.
- **Slug validation in `init` prompt** — `clack.ts` validates slug format client-side for UX; backend remains the authoritative validator.

### Current known debt

From `docs/technical-debt.md` (May 2026, 6 active items):

| Severity | File | Issue |
|---|---|---|
| 🟠 Medium | `src/graft/bundle.ts` | Bundled README still says the scaffold pre-fills `fields[]` mechanically (skill/channel secrets, `GITHUB_TOKEN` materializer). `KNOWN_MATERIALIZERS` is intentionally empty in `scaffoldFields.ts`. |
| 🟠 Medium | `src/api/validateClient.ts` | `ValidateClientOptions.apiKey` is optional in the type, but the backend rejects anonymous validation with 401. CLI always passes a key — make this explicit in the next breaking release. |
| 🟠 Medium | `src/api/pushClient.ts` | Bundle drained to `Buffer` because Node `fetch` cannot compute multipart `Content-Length` for streams. Acceptable under current backend cap. |
| 🟡 Low | `src/cli.ts` | `void appliedSidecars` lint workaround is redundant; remove when logging/control flow is simplified. |
| 🟡 Low | `src/index.ts` | Top-level package-surface comment understates the exported API surface. |
| 🟡 Low | `src/graft/package.ts` | `KNOWN_CATEGORY_SLUGS` mirrors backend-seeded categories; future `GET /grafts/categories` would remove the duplication. |
