# @guayaba/graft-cli

> **RETIRED — see ADR-054.** GRAFT and this CLI were retired on 2026-11-15. The
> backend GRAFT routes return 404, so every published version is incompatible
> with the current Guayaba API. This repository is archived for reference.

CLI and programmatic toolkit to scaffold, validate, pack, and publish
**GRAFTs** (Guayaba Runtime Agent Harness Templates) from existing
agent workspaces.

A GRAFT is a reusable, declarative agent template that captures
everything needed to reproduce an agent — its system prompt, skills,
model settings, and metadata — so it can be shared and reinstalled from
the Guayaba marketplace.

> **Release state:** npm `latest` is `0.0.6`, while this source tree is
> `0.2.0`. 0.0.6 emits `framework_constraints`, `framework_slugs`,
> `price_credits` and `defaults.channels`, and cannot pass the current backend
> validator, which requires `metadata.harness_slugs` and
> `metadata.price_usd` (`convolution-api/app/Http/Requests/Graft/PushGraftRequest.php:123,128`).
> It also predates the `--harness` flag (it still takes `--framework`) and the
> `GET /grafts/constants` lookup. Every command below requires 0.2.x built
> from this repository until 0.2.x is published — do not treat the global
> install as the working path.
>
> The v1 constants route (`/api/v1/grafts/constants`) is not exposed by the
> backend today, so `resolveCategorySlugs` always falls back to
> `KNOWN_CATEGORY_SLUGS` (#5 in `docs/technical-debt.md`).

## Install

```bash
npm i -g @guayaba/graft-cli
```

Or run on demand:

```bash
npx @guayaba/graft-cli --help
```

Until 0.2.x is published, use a checkout of this repository
(`npm install && npm run build`) instead of the published package.

## Workflow at a glance

The CLI generates a self-contained **scaffold directory** from your
agent's workspace. The scaffold contains:

- `graft.json` — declarative schema + marketplace metadata.
- Markdown sidecar stubs named after their wizard field (e.g.
  `personality.md`, `vibe.md`, `extra_instructions.md` for openclaw).
  Each stub contains only an instructional comment; the author fills in
  the template content by hand. The CLI inlines them into the schema's
  `defaults` at validate / pack / push time.
- A copy of the workspace's `skills/` directory (and `TOOLS.md` when
  present), so the scaffold is the only input the rest of the
  pipeline needs.
- A legacy `install.sh` at the scaffold root, copied byte-for-byte from the
  workspace if present (`src/harness/sidecars.ts:217-218`). Current launchers
  ignore it — binary/runtime setup is no longer a GRAFT hook. See
  [Legacy `install.sh`](#legacy-installsh) below.

`graft.json`'s `metadata` also carries two marketplace fields that `init`
writes with defaults and never prompts for:

- `tier` — `free` or `premium` (default `free`).
- `price_usd` — price in decimal USD, `>= 0` (default `0`).

Both are required by the backend's validate and push endpoints; edit
`graft.json` to change them.

```bash
# 1. Generate the scaffold from an existing agent workspace.
graft init --harness openclaw -w ./my-agent -o ./graft

# 2. Fill in the sidecar stubs with your template content.
$EDITOR ./graft/personality.md

# 3. Validate against the Guayaba backend.
graft validate --harness openclaw -i ./graft

# 4. (optional) Pack a tarball locally without uploading.
graft pack --harness openclaw -i ./graft -o ./graft.tar.gz

# 5. Push to your tenant-scoped personal storage on the Guayaba backend.
graft push --harness openclaw -i ./graft
```

Every command requires `--harness <slug>`. Supported today:
`openclaw`. The flag drives the sidecar → schema field mapping (see
[harness mapping](#harness-mapping) below).

Global flags available on the root `graft` command:

```
  -v, --version   Print the installed version and exit.
  -h, --help      Print help.
```

## Commands

### `graft init`

Create a scaffold directory: `graft.json`, blank markdown sidecar stubs
for you to fill in, and a copy of the workspace's skills.

```
Required:
  --harness <slug>       Source harness. Today: openclaw.

Options:
  -w, --workspace <path>   Workspace root to inspect. Defaults to cwd.
  -o, --out <path>         Scaffold dir to create. Defaults to ./graft.
```

Behaviour:

- Reads the workspace, builds the structural schema (model, thinking) via the
  harness-specific extractor.
- Asks for marketplace metadata interactively (name, slug, short_description,
  description, version, tags, categories, author).
- Creates a sidecar stub for each mapped field (`personality.md`,
  `vibe.md`, `extra_instructions.md` for openclaw). Each stub contains
  only an instructional HTML comment; the author writes the template
  content themselves. Workspace content is intentionally not copied — the
  stubs are the template, not the live agent text.
- Copies the workspace's installed skills into `<scaffold>/skills/`,
  flattening `<workspace>/skills/` and `<workspace>/.agents/skills/`
  into a single tree. Also copies `TOOLS.md` if present. The scaffold
  is then self-contained — `pack` and `push` consume only the scaffold.
- Writes `graft.json` last so the scaffold is consistent on Ctrl-C.
- If the scaffold dir already exists, it asks for confirmation and then
  wipes it (re-init regenerates from scratch — sidecars and skills are
  overwritten). Refuses non-interactively.

### `graft validate`

Inline the sidecars into the schema and POST the envelope to the
Guayaba backend, which is the authoritative validator.

```
Required:
  --harness <slug>

Options:
  -i, --input <path>       Scaffold dir. Defaults to cwd.
```

The CLI does not pre-validate field caps locally — it defers to the
backend's 422 response.

Authentication: requires a tenant-bound **master** API key (`g_master_*`).
Read from `$GUAYABA_API_KEY` or prompted in a TTY. Agent-scoped keys
(`g_agent_*`) are rejected with `403`.

### `graft pack`

Inline the sidecars and build a `graft.tar.gz` locally without
uploading. Useful for inspection and CI artefacts.

```
Required:
  --harness <slug>

Options:
  -i, --input <path>       Scaffold dir. Defaults to cwd.
  -o, --out <path>         Output tarball. Defaults to ./graft.tar.gz.
  -f, --force              Overwrite the output if it exists.
```

Skills (and `TOOLS.md`) are read straight from the scaffold —
`init` already copied them there.

### `graft push`

Same as `pack`, but uploads to tenant-scoped personal storage on the
Guayaba backend instead of writing locally. Pushes stay personal drafts;
promotion to the public catalog is an admin-only action
(`POST /grafts/{slug}/publish`).

```
Required:
  --harness <slug>

Options:
  -i, --input <path>       Scaffold dir. Defaults to cwd.
      --icon  <path>       Optional icon image  (PNG/JPG/WebP, ≤ 1 MB).
      --cover <path>       Optional cover image (PNG/JPG/WebP, ≤ 4 MB).
```

Authentication: requires a tenant-bound **master** API key (`g_master_*`).
Read from `$GUAYABA_API_KEY` or prompted in a TTY. Agent-scoped keys
(`g_agent_*`) are rejected with `403`.

The CLI does not accept a tenant selector and does not send a tenant header.
The backend derives ownership from the master API key and stores bundles under
the corresponding `personal/{tenant_id}/...` prefix.

> **Immutable versions:** pushing the same `(slug, version)` pair twice
> returns `409 Conflict`. Bump `metadata.version` in `graft.json` to
> push a new revision.

## Harness mapping

Each harness defines a fixed registry of scaffold sidecar → schema
field entries. The CLI uses it to create stubs on `init` and to inline
content on `validate`/`pack`/`push`.

| Harness | Scaffold sidecar          | Maps to (workspace file) | Schema field                           |
|-----------|---------------------------|--------------------------|----------------------------------------|
| openclaw  | `personality.md`          | `SOUL.md`                | `defaults.personality`                 |
| openclaw  | `vibe.md`                 | `IDENTITY.md`            | `defaults.vibe`                        |
| openclaw  | `extra_instructions.md`   | `AGENTS.md`              | `defaults.settings.extra_instructions` |

Empty / whitespace-only sidecars are treated as absent — the
corresponding field stays out of `defaults`.

The registry lives in
[`src/harness/mapping.ts`](src/harness/mapping.ts); the inlining
logic lives in [`src/harness/sidecars.ts`](src/harness/sidecars.ts).

## Legacy `install.sh`

Older bundles may still carry an `install.sh`, but current launchers ignore
it. Binary/runtime setup is no longer a GRAFT hook: apt packages are replayed
from `.deps/apt-packages.txt` by the container entrypoint on the next start,
and the agent installs user-space tools under its workspace/HOME. The agent
runs as the non-root runtime user, so `apt-get` is not available at runtime
(`openclaw-launcher/src/openclaw/generator.ts:1369-1373,1473-1474`;
`gene-seed/internal/grafts/marketplace.md:119-124`).

Do not rely on `install.sh` for anything. Per-user secrets belong in a
`secret` field's `materialize` block; binaries the agent needs at runtime
should be installed by the agent under its workspace/HOME.

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `GUAYABA_API_KEY` | Yes (for `validate` / `push`) | Tenant-bound master API key (`g_master_*`). Prompted interactively when missing and stdin is a TTY. |
| `GUAYABA_API_BASE_URL` | No | Override the API base URL. Defaults to `https://api.guayaba.run/api/v1`. |

## Programmatic API

```ts
import {
  readOpenclawWorkspace,
  extractOpenclawSummary,
  buildGraftFromOpenclaw,
  defaultMetadataFor,
  buildGraftBundle,
  validateGraftPackage,
  pushGraftPackage,
} from '@guayaba/graft-cli';
```

The package's public surface is the full export list in
[`src/index.ts:19-89`](src/index.ts); the block above is a subset.
`src/harness/` is not reachable from `node_modules` because
`package.json` ships `dist/` only. To use the sidecar machinery outside
the CLI shell, work from a repository checkout and import
[`src/harness/mapping.ts`](src/harness/mapping.ts) /
[`src/harness/sidecars.ts`](src/harness/sidecars.ts) directly.

## Development

```bash
npm install
npm run build      # tsup → dist/
npm run test       # vitest
npm run typecheck  # tsc --noEmit
```

Node ≥ 18 (uses `globalThis.fetch`, `FormData`, `Blob`).
