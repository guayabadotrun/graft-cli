# AGENTS.md — graft-cli

## What this is

`@guayaba/graft-cli` is the CLI tool (`graft` binary) for authoring Guayaba GRAFT templates from running agent workspaces. It reads an OpenClaw (or future framework) workspace, scaffolds a `graft.json` + sidecar files, validates/bundles them, and pushes the result to the Guayaba backend API.

## How to run / develop

| Script | Command |
|---|---|
| Build (once) | `npm run build` → `tsup` → `dist/` |
| Dev (watch) | `npm run dev` → `tsup --watch` |
| Tests | `npm test` → `vitest run` |
| Tests (watch) | `npm run test:watch` → `vitest` |
| Type-check | `npm run typecheck` → `tsc --noEmit` |

- **Node ≥ 18 required** (uses global `fetch`, `FormData`, `Blob`).
- Binary entrypoint: `dist/cli.js` (wired in `package.json` `bin.graft`).
- ESM package (`"type": "module"`); CJS build also emitted for library consumers.

## Key files

| File | What it does |
|---|---|
| `src/cli.ts` | Commander program, all four commands (`init`, `validate`, `pack`, `push`), shared helpers (`resolveApiKey`, `loadScaffold`, `reportValidation`) |
| `src/index.ts` | Programmatic entry point; re-exports safe, side-effect-free APIs; reads `VERSION` from `package.json` at load |
| `src/config.ts` | Exports `API_BASE_URL` — defaults to `https://api.guayaba.run/api/v1`, overridable via `$GUAYABA_API_BASE_URL` |
| `src/framework/mapping.ts` | Static registry: `FrameworkSlug` (`'openclaw'`), `FRAMEWORK_MAPPINGS`, sidecar filename → `defaults` dot-path table |
| `src/framework/sidecars.ts` | `inlineSidecars` (reads sidecars → inlines into schema), `copyWorkspaceSidecars`, `copyWorkspaceSkills` (also copies `TOOLS.md` and `install.sh`) |
| `src/graft/build.ts` | Pure builder: OpenClaw summary → `GraftDocument` (`schema_version: 2`); defines `ALLOWED_GRAFT_CHANNELS` |
| `src/graft/bundle.ts` | Assembles `graft.tar.gz` via `tar` child process; stages files in a `os.tmpdir()` tempdir; writes `metadata.json`, `schema.json`, `README.md`, optional `TOOLS.md`, optional `install.sh`, and per-skill `<name>.tar.gz` + `<name>.manifest.json` |
| `src/graft/scaffoldFields.ts` | `augmentSchemaWithMechanicalFields` — attaches `materialize` blocks to `secret` fields whose `binding` env key has a known recipe; `KNOWN_MATERIALIZERS` is currently empty `{}` |
| `src/graft/package.ts` | `GraftMetadata`, `GraftPackage` interfaces; `KNOWN_CATEGORY_SLUGS` constant |
| `src/api/validateClient.ts` | `POST /grafts/validate` — auth-gated; returns `{ ok, warnings }` or `{ ok: false, issues }` |
| `src/api/pushClient.ts` | `POST /grafts` (multipart: `bundle`, `metadata`, `schema`) + `POST /grafts/{slug}/assets/{type}` (method-spoofed `_method=PUT`); uploads icon/cover first, then bundle |
| `src/prompts/clack.ts` | Interactive metadata prompts (Clack-based); only called in TTY context during `init` |
| `src/prompts/types.ts` | `Prompter` and `MetadataResult` interfaces |
| `src/openclaw/workspace.ts` | Reads an OpenClaw workspace from disk; exports `WorkspaceNotFoundError`, `InvalidOpenclawConfigError` |
| `src/openclaw/extract.ts` | `extractOpenclawSummary` — produces `OpenclawAgentSummary` (channels, model, thinking, agent name/id) |
| `src/openclaw/skills.ts` | `listInstalledSkills`, `parseSkillFrontmatter`, `tarSkillBundle`, `buildSkillManifest`; skill roots: workspace `skills/` and `.agents/skills/` |

## CLI commands

| Command | What it does | API key required? | API endpoints called |
|---|---|---|---|
| `graft init --framework <slug> [-w <workspace>] [-o <out>]` | Read workspace, build `graft.json` + copy sidecars/skills into scaffold dir. Interactive in TTY (prompts for metadata, stub creation). | No | None |
| `graft validate --framework <slug> [-i <scaffold>]` | Inline sidecars into schema, POST to backend for validation. | **Yes** (`$GUAYABA_API_KEY` or TTY prompt) | `POST /grafts/validate` |
| `graft pack --framework <slug> [-i <scaffold>] [-o <out>] [-f]` | Inline sidecars, build `graft.tar.gz` locally. No upload. | No | None |
| `graft push --framework <slug> [-i <scaffold>] [--icon <path>] [--cover <path>]` | Inline sidecars, upload icon/cover (if provided), build and POST bundle to backend. | **Yes** | `POST /grafts/{slug}/assets/icon`, `POST /grafts/{slug}/assets/cover`, `POST /grafts` |

All four commands require `--framework` (currently only `openclaw` is supported).

## Key constraints

- **`validate` requires an API key** — the endpoint is auth-gated even though it's read-only (by backend design). The `apiKey` field in `ValidateClientOptions` is typed as optional (`apiKey?`) but the CLI always passes one.
- **`ALLOWED_GRAFT_CHANNELS = ['telegram']`** — defined in `src/graft/build.ts`. `chat` is NOT a channel; it is the always-on transport. Adding any other channel here requires pairing with launcher support and a backend PHP constant update.
- **Schema file is `graft.json`, not `schema.json`** — the scaffold file on disk is `graft.json` (contains both `{ metadata, schema }`). The bundle writes `schema.json` and `metadata.json` separately inside the tarball.
- **`bundle.ts` force-chmods `install.sh` to 0o755** — `(srcStat.mode & 0o777) | 0o755` so the launcher can exec it even if the author forgot `chmod +x`.
- **`$GUAYABA_API_BASE_URL`** — overrides the hardcoded `https://api.guayaba.run/api/v1` for local dev or staging. Do not add a CLI flag for this; it's intentional that it's env-only.
- **Slave keys are rejected** — the backend returns HTTP 403 for slave keys on both `POST /grafts` and the asset endpoints. Only master API keys work.
- **`augmentSchemaWithMechanicalFields` is called in `pushClient.ts` before POSTing** — the form-field `schema` must match the bundle's `schema.json` exactly; the augmentation runs on both code paths.
- **`KNOWN_MATERIALIZERS` is currently empty** — the scaffolded `materialize` enrichment is wired but no env-key recipes are registered yet. The block in the README doc example (`gh auth login`) was deliberately removed from the registry because the launcher base image doesn't ship `gh`.
- **Asset uploads use method-spoofing** — Laravel can't parse multipart bodies on native `PUT`; the CLI sends `POST` with `_method=PUT` form field. Do not change to a real `PUT`.
- **Bundle is drained to a `Buffer` in `pushClient.ts`** — Node's global `fetch` can't compute multipart `Content-Length` from a streaming body; the whole bundle is buffered in memory (backend cap: 200 MB).
- **Non-interactive re-init is blocked** — `graft init` refuses to overwrite an existing scaffold dir when not in a TTY (`process.stdin.isTTY`).
- **`schema_version: 2` only** — the backend validator only accepts `schema_version: 2`. The builder always emits it; never change to another value without a backend migration.

## API surface (what this calls)

All requests go to `API_BASE_URL` (default `https://api.guayaba.run/api/v1`).

| Endpoint | Method | Auth | Content-Type | Used by |
|---|---|---|---|---|
| `/grafts/validate` | POST | `Authorization: Bearer <master_key>` | `application/json` | `validate` command |
| `/grafts` | POST | `Authorization: Bearer <master_key>` | `multipart/form-data` (fields: `metadata` JSON, `schema` JSON, `bundle` tar.gz) | `push` command |
| `/grafts/{slug}/assets/icon` | POST + `_method=PUT` | `Authorization: Bearer <master_key>` | `multipart/form-data` (fields: `_method=PUT`, `file` Blob) | `push --icon` |
| `/grafts/{slug}/assets/cover` | POST + `_method=PUT` | `Authorization: Bearer <master_key>` | `multipart/form-data` (fields: `_method=PUT`, `file` Blob) | `push --cover` |

HTTP outcomes:
- `validate`: 200 → ok+warnings, 422 → validation issues, 401 → bad key
- `push /grafts`: 201 → success (returns `id`, `version_id`, `bundle_s3_key`), 422 → structured field issues, 409 → conflict (version already exists or slug taken — message includes a fix hint: "Bump metadata.version" or "Choose a different slug"), 401 → bad key, 403 → slave key
- `push assets`: 200 → ok+path, 422 → issues, 401 → bad key, 403 → slave key

## Non-obvious rules (continued)

- **`graft init` output** — the "Next steps" section names `graft.json` explicitly as the main file to edit, then lists sidecars. Earlier it only mentioned sidecars, leading authors to miss metadata/schema changes needed in `graft.json`.
- **Slug validation in `init` prompt** — `clack.ts` validates slug format client-side (`/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/`, max 100 chars) to give immediate feedback before hitting the network. The backend remains the authoritative validator — this is UX, not a gate.
- **409 vs 422 in push** — `pushClient.ts` handles 409 separately from 422. If the 409 body contains `errors.metadata.version` (version already exists for slug), the message gets a ` → Bump metadata.version in graft.json and push again.` hint. If there are no structured errors (slug owned by another author), the fallback hint suggests choosing a different slug.

## Current known debt / stale comments

- **`src/graft/scaffoldFields.ts` `KNOWN_MATERIALIZERS` is empty** — the comment in `bundle.ts`'s README template still shows `gh auth login` and `materialize` examples as _already templated_, but the registry generates nothing. The README in the tarball describes a feature that doesn't auto-fire yet.
- **`src/graft/package.ts` `icon_path`/`cover_image_path` comment** — says "CLI doesn't upload assets today", but `push` does support `--icon`/`--cover`. Comment is stale.
- **`validateClient.ts` JSDoc says `apiKey?` is optional** — this is technically true in the interface, but the backend rejects unauthenticated requests (401). The CLI always passes a key; callers relying on the optional signature for anonymous validation will get a 401.
- **`src/cli.ts` line 498** — `void appliedSidecars` comment says "Avoid unused-variable warning in environments where sidecar list isn't logged elsewhere" — this is a lint workaround; the sidecars are in fact logged above in the push handler.
- **`src/index.ts` comment** — "Right now we expose the package version and the OpenClaw workspace reader" — understates what's actually exported (validate/push clients, bundle builder, metadata helpers, etc.).
