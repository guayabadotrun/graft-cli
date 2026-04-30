# @guayaba/graft-cli

CLI and programmatic toolkit to scaffold, validate, pack, and publish
**GRAFTs** (Guayaba Runtime Agent Framework Templates) from existing
agent workspaces.

A GRAFT is a reusable, declarative agent template that captures
everything needed to reproduce an agent — its system prompt, skills,
model settings, and metadata — so it can be shared and reinstalled from
the Guayaba marketplace.

## Install

```bash
npm i -g @guayaba/graft-cli
```

Or run on demand:

```bash
npx @guayaba/graft-cli --help
```

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
- An optional `install.sh` at the scaffold root, copied verbatim from
  the workspace if present. The launcher runs it once on the agent's
  first boot to install any binary your bundled skills depend on
  (e.g. `gh`, `aws`). See [Optional `install.sh`
  hook](#optional-installsh-hook) below.

```bash
# 1. Generate the scaffold from an existing agent workspace.
graft init --framework openclaw -w ./my-agent -o ./graft

# 2. Fill in the sidecar stubs with your template content.
$EDITOR ./graft/personality.md

# 3. Validate against the Guayaba backend.
graft validate --framework openclaw -i ./graft

# 4. (optional) Pack a tarball locally without uploading.
graft pack --framework openclaw -i ./graft -o ./graft.tar.gz

# 5. Push to your personal storage on the Guayaba backend.
graft push --framework openclaw -i ./graft
```

Every command requires `--framework <slug>`. Supported today:
`openclaw`. The flag drives the sidecar → schema field mapping (see
[framework mapping](#framework-mapping) below).

Global flags available on the root `graft` command:

```
  -v, --version   Print the installed version and exit.
      --help      Print help.
```

## Commands

### `graft init`

Create a scaffold directory: `graft.json`, blank markdown sidecar stubs
for you to fill in, and a copy of the workspace's skills.

```
Required:
  --framework <slug>       Source framework. Today: openclaw.

Options:
  -w, --workspace <path>   Workspace root to inspect. Defaults to cwd.
  -o, --out <path>         Scaffold dir to create. Defaults to ./graft.
```

Behaviour:

- Reads the workspace, builds the structural schema (channels, model,
  thinking) via the framework-specific extractor. **Channel constraint
  (openclaw):** only `telegram` is supported in `defaults.channels`.
  Specifying any other channel will cause `init` to exit with an error.
- Asks for marketplace metadata interactively (slug, name, description,
  version, tags, categories, author).
- Creates a sidecar stub for each mapped field (`personality.md`,
  `vibe.md`, `extra_instructions.md` for openclaw). Each stub contains
  only an instructional HTML comment; the author writes the template
  content themselves. Workspace content is intentionally not copied —
  copying verbatim would duplicate the text when the GRAFT is applied,
  because the framework combines personality and extra_instructions.
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
  --framework <slug>

Options:
  -i, --input <path>       Scaffold dir. Defaults to cwd.
```

The CLI does not pre-validate field caps locally — it defers to the
backend's 422 response.

Authentication: requires an account **master** API key (`g_master_*`).
Read from `$GUAYABA_API_KEY` or prompted in a TTY. Agent-scoped keys
(`g_agent_*`) are rejected with `403`.

### `graft pack`

Inline the sidecars and build a `graft.tar.gz` locally without
uploading. Useful for inspection and CI artefacts.

```
Required:
  --framework <slug>

Options:
  -i, --input <path>       Scaffold dir. Defaults to cwd.
  -o, --out <path>         Output tarball. Defaults to ./graft.tar.gz.
  -f, --force              Overwrite the output if it exists.
```

Skills (and `TOOLS.md`) are read straight from the scaffold —
`init` already copied them there.

### `graft push`

Same as `pack`, but uploads to the user's personal storage on the
Guayaba backend instead of writing locally. Drafts are private until
explicitly submitted for review.

```
Required:
  --framework <slug>

Options:
  -i, --input <path>       Scaffold dir. Defaults to cwd.
      --icon  <path>       Optional icon image  (PNG/JPG/WebP, ≤ 1 MB).
      --cover <path>       Optional cover image (PNG/JPG/WebP, ≤ 4 MB).
```

Authentication: requires an account **master** API key (`g_master_*`).
Read from `$GUAYABA_API_KEY` or prompted in a TTY. Agent-scoped keys
(`g_agent_*`) are rejected with `403`.

> **Immutable versions:** pushing the same `(slug, version)` pair twice
> returns `409 Conflict`. Bump `metadata.version` in `graft.json` to
> push a new revision.

## Framework mapping

Each framework defines a fixed registry of scaffold sidecar → schema
field entries. The CLI uses it to create stubs on `init` and to inline
content on `validate`/`pack`/`push`.

| Framework | Scaffold sidecar          | Maps to (workspace file) | Schema field                           |
|-----------|---------------------------|--------------------------|----------------------------------------|
| openclaw  | `personality.md`          | `SOUL.md`                | `defaults.personality`                 |
| openclaw  | `vibe.md`                 | `IDENTITY.md`            | `defaults.vibe`                        |
| openclaw  | `extra_instructions.md`   | `AGENTS.md`              | `defaults.settings.extra_instructions` |

Empty / whitespace-only sidecars are treated as absent — the
corresponding field stays out of `defaults`.

The registry lives in
[`src/framework/mapping.ts`](src/framework/mapping.ts); the inlining
logic lives in [`src/framework/sidecars.ts`](src/framework/sidecars.ts).

## Optional `install.sh` hook

If the source workspace has an `install.sh` at its root,
`graft init` copies it into the scaffold and `graft pack` / `graft
push` ship it inside the bundle. The launcher (openclaw-launcher's
`graft-apply.ts`) then runs it **once** on the agent's first boot.

Use it for **runtime binary setup** that can't be expressed
declaratively — typically installing a CLI your bundled skill depends
on:

```sh
#!/bin/sh
# Make `gh` available so the bundled `github` skill can use it.
set -e
command -v gh >/dev/null && exit 0
apt-get update
apt-get install -y --no-install-recommends gh
echo "gh" >> "/mnt/efs/agents/$AGENT_ID/.deps/apt-packages.txt"
```

Runtime contract enforced by the launcher:

- Invocation: `/bin/sh install.sh`, working dir is the bundle's
  extract dir.
- Runs as root inside the agent container; `apt-get install -y`
  works without sudo.
- Hard timeout: 5 minutes (SIGKILL on overrun).
- stdout → launcher logs at `info`, stderr at `warn`.
- Non-zero exit aborts the apply and the marker is not written, so
  the launcher retries on next boot. Use `set -e`.
- Must be idempotent.

When **not** to use it:

- Per-user secrets → declare a `secret` field inside the `schema`
  object in `graft.json` with a `materialize` block. `materialize`
  re-runs on every boot/reload to follow rotations; `install.sh`
  runs only once.
- Things the agent will install on demand anyway → if the cost of one
  user message waiting on `apt-get install` is acceptable, skip the
  hook entirely. The agent template tells the LLM it has root and can
  install anything it needs.

The full author-facing reference is in
[gene-seed/public/guides/authoring-grafts.md](https://github.com/guayaba/gene-seed/blob/main/public/guides/authoring-grafts.md#optional-shipping-an-installsh-hook).

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `GUAYABA_API_KEY` | Yes (for `validate` / `push`) | Account master API key (`g_master_*`). Prompted interactively when missing and stdin is a TTY. |
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

Reach into [`src/framework/`](src/framework/) for the sidecar
machinery if you need to inline outside the CLI shell.

## Development

```bash
npm install
npm run build      # tsup → dist/
npm run test       # vitest
npm run typecheck  # tsc --noEmit
```

Node ≥ 18 (uses `globalThis.fetch`, `FormData`, `Blob`).
