# @guayaba/graft-cli

CLI and programmatic toolkit to generate **GRAFTs** (Guayaba Runtime Agent Framework Templates) from existing agent workspaces.

A GRAFT is a reusable, declarative agent template — see the marketplace roadmap in `gene-seed/internal/roadmap/grafts-marketplace.md` for the full schema (`schema_version: 2`).

> Status: scaffold only. Workspace introspection, interactive prompts, and `graft.json` generation are tracked separately and will land in subsequent iterations.

## Install

```bash
npm i -g @guayaba/graft-cli
```

Or run on demand:

```bash
npx @guayaba/graft-cli --help
```

## Usage

```bash
graft --version
graft init [--workspace <path>]
```

By default `graft init` looks at the current working directory. Pass `--workspace` to point at any other agent workspace.

## Two modes

The package exposes both:

- A **CLI** (`graft`) for human use — interactive prompts, file I/O.
- A **programmatic API** (`import { ... } from '@guayaba/graft-cli'`) for embedding the same logic in other tools (e.g. the Guayaba launcher's "Export as GRAFT" endpoint), without prompts.

## Development

```bash
npm install
npm run build      # tsup → dist/
npm run test       # vitest
npm run typecheck  # tsc --noEmit
```
