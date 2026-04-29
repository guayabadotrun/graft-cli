// CLI entry point — wired up by tsup with a `#!/usr/bin/env node` banner
// and exposed as the `graft` binary in package.json.
//
// Workflow (gene-seed/internal/architecture/grafts-marketplace.md §3):
//
//   1. `graft init --framework openclaw -w <workspace> -o <scaffold>`
//      Creates a scaffold directory containing `graft.json` (declarative
//      schema) plus markdown sidecars (SOUL.md, IDENTITY.md, AGENTS.md
//      for openclaw — names match the source framework so the dev sees
//      something familiar). The dev then trims the sidecars by hand.
//
//   2. `graft validate --framework openclaw [-i <scaffold>]`
//      Inlines the sidecars into the schema's `defaults` and POSTs the
//      envelope to the backend. Backend is the single source of truth
//      for whether the result is acceptable.
//
//   3. `graft pack --framework openclaw [-i <scaffold>] -w <workspace>`
//      Same inline step, then writes a `graft.tar.gz` locally. Skills
//      are read from the workspace (not the scaffold) — the scaffold
//      only owns the prose fields.
//
//   4. `graft push --framework openclaw [-i <scaffold>] -w <workspace>`
//      Same as `pack`, but uploads to the user's personal area on the
//      Guayaba backend instead of writing locally.

import { Command } from 'commander';
import { writeFile, access, readFile, mkdir, rm } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { isCancel, password, confirm } from '@clack/prompts';
import {
  VERSION,
  readOpenclawWorkspace,
  extractOpenclawSummary,
  buildGraftFromOpenclaw,
  defaultMetadataFor,
  WorkspaceNotFoundError,
  InvalidOpenclawConfigError,
  validateGraftPackage,
  ValidateRequestError,
  pushGraftPackage,
  PushRequestError,
  buildGraftBundle,
} from './index.js';
import type { GraftDocument } from './graft/build.js';
import type { GraftMetadata, GraftPackage } from './graft/package.js';
import { createClackPrompter } from './prompts/clack.js';
import {
  isSupportedFramework,
  SUPPORTED_FRAMEWORKS,
  type FrameworkSlug,
} from './framework/mapping.js';
import {
  copyWorkspaceSidecars,
  copyWorkspaceSkills,
  inlineSidecars,
  sidecarFilenamesFor,
} from './framework/sidecars.js';

// ─── Shared helpers ──────────────────────────────────────────

/** Validate the `--framework` flag value, exiting with a clear message. */
function requireFramework(command: string, raw: unknown): FrameworkSlug {
  if (typeof raw !== 'string' || !isSupportedFramework(raw)) {
    console.error(
      `graft ${command}: --framework is required. Supported: ${SUPPORTED_FRAMEWORKS.join(', ')}.`,
    );
    process.exit(1);
  }
  return raw;
}

/**
 * Read a `graft.json` envelope from disk and assert it has the expected
 * `{ metadata, schema }` shape.
 */
async function readGraftEnvelope(inputPath: string, command: string): Promise<GraftPackage> {
  let raw: string;
  try {
    raw = await readFile(inputPath, 'utf8');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`graft ${command}: could not read ${inputPath}: ${msg}`);
    process.exit(1);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error(`graft ${command}: ${inputPath} is not valid JSON: ${(err as Error).message}`);
    process.exit(1);
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('metadata' in parsed) ||
    !('schema' in parsed)
  ) {
    console.error(
      `graft ${command}: ${inputPath} is not a valid GRAFT envelope. Expected an object with 'metadata' and 'schema' keys.`,
    );
    process.exit(1);
  }
  return parsed as GraftPackage;
}

/**
 * Resolve the master API key from `$GUAYABA_API_KEY` or, in a TTY,
 * prompt for it interactively.
 */
async function resolveApiKey(command: string): Promise<string> {
  const fromEnv = process.env.GUAYABA_API_KEY;
  if (fromEnv) return fromEnv;
  if (!process.stdin.isTTY) {
    console.error(
      `graft ${command}: requires an account master API key. Set $GUAYABA_API_KEY or run in a TTY to be prompted.`,
    );
    process.exit(2);
  }
  const entered = await password({ message: 'Account master API key (input hidden)' });
  if (isCancel(entered) || typeof entered !== 'string' || entered.length === 0) {
    console.error(`graft ${command}: cancelled — no API key provided.`);
    process.exit(1);
  }
  return entered;
}

/**
 * Load the scaffold (graft.json + sidecars) and return a fully-resolved
 * envelope ready to be sent to the backend or packed. The schema's
 * `defaults` will have the sidecar contents inlined under their mapped
 * dot-paths.
 */
async function loadScaffold(
  scaffoldDir: string,
  framework: FrameworkSlug,
  command: string,
): Promise<{ envelope: GraftPackage; appliedSidecars: { filename: string; bytes: number }[] }> {
  const envelopePath = resolve(scaffoldDir, 'graft.json');
  const pkg = await readGraftEnvelope(envelopePath, command);
  const result = await inlineSidecars(pkg.schema, scaffoldDir, framework);
  return {
    envelope: { metadata: pkg.metadata, schema: result.schema },
    appliedSidecars: result.applied.map(({ filename, bytes }) => ({ filename, bytes })),
  };
}

/** Pretty-print validation results, exit on failure. */
function reportValidation(result: Awaited<ReturnType<typeof validateGraftPackage>>, command: string): void {
  if (result.ok) {
    console.log('  ✓ valid');
    for (const w of result.warnings) console.log(`  warning: ${w}`);
    return;
  }
  console.error('  ✗ invalid:');
  for (const issue of result.issues) {
    console.error(`    - ${issue.field}: ${issue.message}`);
  }
  console.error(`graft ${command}: backend rejected the GRAFT.`);
  process.exit(2);
}

// ─── Program ─────────────────────────────────────────────────

const program = new Command();

program
  .name('graft')
  .description('Author Guayaba GRAFT templates from agent workspaces.')
  .version(VERSION, '-v, --version', 'Print the @guayaba/graft-cli version.');

// ─── init ────────────────────────────────────────────────────

program
  .command('init')
  .description(
    'Create a GRAFT scaffold directory: graft.json plus markdown sidecars copied from the source workspace (e.g. SOUL.md, IDENTITY.md, AGENTS.md).',
  )
  .requiredOption(
    '--framework <slug>',
    `Source framework slug. Supported: ${SUPPORTED_FRAMEWORKS.join(', ')}.`,
  )
  .option(
    '-w, --workspace <path>',
    'Path to the agent workspace to inspect. Defaults to the current working directory.',
  )
  .option(
    '-o, --out <path>',
    'Scaffold directory to create. Defaults to ./graft in the current directory.',
  )
  .action(
    async (opts: {
      framework: string;
      workspace?: string;
      out?: string;
    }) => {
      const framework = requireFramework('init', opts.framework);
      const workspacePath = resolve(opts.workspace ?? process.cwd());
      const scaffoldDir = resolve(opts.out ?? 'graft');
      const interactive = Boolean(process.stdin.isTTY);

      // 1) Read the workspace (framework-specific extractor).
      let summary;
      try {
        const ws = await readOpenclawWorkspace(workspacePath);
        summary = extractOpenclawSummary(ws);
      } catch (err) {
        if (err instanceof WorkspaceNotFoundError || err instanceof InvalidOpenclawConfigError) {
          console.error(`graft init: ${err.message}`);
          process.exit(1);
        }
        throw err;
      }

      // 2) If the scaffold dir already exists, ask before nuking it.
      const exists = await access(scaffoldDir).then(() => true, () => false);
      if (exists) {
        if (!interactive) {
          console.error(
            `graft init: ${scaffoldDir} already exists. Re-running init regenerates the scaffold from scratch and overwrites all sidecars; refusing to do so non-interactively.`,
          );
          process.exit(1);
        }
        const ok = await confirm({
          message: `${basename(scaffoldDir)}/ already exists. Re-init wipes it and regenerates the scaffold (sidecars will be overwritten). Continue?`,
          initialValue: false,
        });
        if (isCancel(ok) || ok !== true) {
          console.error('graft init: cancelled, scaffold not modified.');
          process.exit(1);
        }
        await rm(scaffoldDir, { recursive: true, force: true });
      }
      await mkdir(scaffoldDir, { recursive: true });

      // 3) Build the structural schema (channels, model, thinking).
      let doc: GraftDocument;
      try {
        doc = buildGraftFromOpenclaw(summary);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`graft init: ${msg}`);
        process.exit(1);
      }

      // 4) Metadata (interactive when possible, sensible defaults otherwise).
      let metadata: GraftMetadata = defaultMetadataFor(summary);
      if (interactive) {
        const prompter = createClackPrompter();
        const meta = await prompter.askMetadata(metadata);
        if (meta === null) {
          console.error('graft init: cancelled by user. Scaffold not written.');
          await rm(scaffoldDir, { recursive: true, force: true });
          process.exit(1);
        }
        metadata = meta;
      }

      // 5) Copy markdown sidecars from the workspace.
      const { copied, missingInWorkspace } = await copyWorkspaceSidecars(
        workspacePath,
        scaffoldDir,
        framework,
      );

      // 5b) Copy installed skills (and TOOLS.md when present) so the
      //     scaffold is self-contained — `pack`/`push` then read skills
      //     straight from it without needing a separate workspace flag.
      let copiedSkills: string[] = [];
      let copiedTools = false;
      let copiedInstallScript = false;
      try {
        const result = await copyWorkspaceSkills(workspacePath, scaffoldDir);
        copiedSkills = result.skills;
        copiedTools = result.tools;
        copiedInstallScript = result.installScript;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`graft init: failed to copy skills from workspace: ${msg}`);
        await rm(scaffoldDir, { recursive: true, force: true });
        process.exit(1);
      }

      // 6) For files missing in the workspace, optionally create blank stubs.
      const stubsCreated: string[] = [];
      if (missingInWorkspace.length > 0 && interactive) {
        const wantStubs = await confirm({
          message: `These sidecars don't exist in the workspace: ${missingInWorkspace.join(', ')}. Create empty stubs in the scaffold so you can fill them in by hand?`,
          initialValue: true,
        });
        if (!isCancel(wantStubs) && wantStubs === true) {
          for (const filename of missingInWorkspace) {
            await writeFile(resolve(scaffoldDir, filename), '', 'utf8');
            stubsCreated.push(filename);
          }
        }
      }

      // 7) Write graft.json last so the scaffold is consistent if the
      //    user Ctrl-Cs midway.
      const pkg: GraftPackage = { metadata, schema: doc };
      await writeFile(
        resolve(scaffoldDir, 'graft.json'),
        `${JSON.stringify(pkg, null, 2)}\n`,
        'utf8',
      );

      // 8) Report.
      console.log(`Scaffold written to ${scaffoldDir}`);
      console.log(`  framework: ${framework}`);
      if (summary.agent.name) {
        console.log(`  agent:     ${summary.agent.name}${summary.agent.id ? ` (${summary.agent.id})` : ''}`);
      }
      if (summary.universal.model) console.log(`  model:     ${summary.universal.model}`);
      if (summary.universal.thinking) console.log(`  thinking:  ${summary.universal.thinking}`);
      if (summary.universal.channels.length > 0) {
        console.log(`  channels:  ${summary.universal.channels.join(', ')}`);
      }
      console.log('');
      console.log('Files:');
      console.log('  graft.json (declarative schema)');
      for (const f of copied) console.log(`  ${f} (copied from workspace)`);
      for (const f of stubsCreated) console.log(`  ${f} (empty stub)`);
      const skipped = missingInWorkspace.filter((f) => !stubsCreated.includes(f));
      for (const f of skipped) console.log(`  ${f} (missing — schema field will stay empty)`);
      if (copiedSkills.length > 0) {
        console.log(`  skills/ (${copiedSkills.length} skill${copiedSkills.length === 1 ? '' : 's'}: ${copiedSkills.join(', ')})`);
      }
      if (copiedTools) console.log('  TOOLS.md (copied from workspace)');
      if (copiedInstallScript) console.log('  install.sh (copied from workspace; runs once on first apply)');
      console.log('');
      console.log(`Edit the sidecars to taste, then run: graft validate --framework ${framework}`);
    },
  );

// ─── validate ────────────────────────────────────────────────

program
  .command('validate')
  .description('Inline scaffold sidecars into the schema and validate against the Guayaba backend.')
  .requiredOption(
    '--framework <slug>',
    `Source framework slug. Supported: ${SUPPORTED_FRAMEWORKS.join(', ')}.`,
  )
  .option(
    '-i, --input <path>',
    'Path to the scaffold directory (containing graft.json + sidecars). Defaults to the current working directory.',
  )
  .action(async (opts: { framework: string; input?: string }) => {
    const framework = requireFramework('validate', opts.framework);
    const scaffoldDir = resolve(opts.input ?? process.cwd());
    const { envelope, appliedSidecars } = await loadScaffold(scaffoldDir, framework, 'validate');
    const apiKey = await resolveApiKey('validate');

    console.log(`Validating ${envelope.metadata.slug}@${envelope.metadata.version} against Guayaba API …`);
    for (const s of appliedSidecars) {
      console.log(`  inlined ${s.filename} (${s.bytes} bytes)`);
    }
    try {
      const result = await validateGraftPackage(envelope, { apiKey });
      reportValidation(result, 'validate');
    } catch (err) {
      if (err instanceof ValidateRequestError) {
        console.error(`graft validate: ${err.message}`);
        process.exit(2);
      }
      throw err;
    }
  });

// ─── pack ────────────────────────────────────────────────────

program
  .command('pack')
  .description('Inline scaffold sidecars and build a GRAFT bundle (graft.tar.gz) locally without uploading.')
  .requiredOption(
    '--framework <slug>',
    `Source framework slug. Supported: ${SUPPORTED_FRAMEWORKS.join(', ')}.`,
  )
  .option(
    '-i, --input <path>',
    'Path to the scaffold directory (graft.json + sidecars + skills/). Defaults to the current working directory.',
  )
  .option(
    '-o, --out <path>',
    'Where to write the resulting tarball. Defaults to ./graft.tar.gz in the current directory.',
  )
  .option('-f, --force', 'Overwrite the output file if it already exists.', false)
  .action(
    async (opts: {
      framework: string;
      input?: string;
      out?: string;
      force?: boolean;
    }) => {
      const framework = requireFramework('pack', opts.framework);
      const scaffoldDir = resolve(opts.input ?? process.cwd());
      const outPath = resolve(opts.out ?? 'graft.tar.gz');

      if (!opts.force) {
        const exists = await access(outPath).then(() => true, () => false);
        if (exists) {
          console.error(`graft pack: refusing to overwrite ${outPath}. Pass --force to replace it.`);
          process.exit(1);
        }
      }

      const { envelope, appliedSidecars } = await loadScaffold(scaffoldDir, framework, 'pack');

      console.log(`Packing ${envelope.metadata.slug}@${envelope.metadata.version} …`);
      for (const s of appliedSidecars) {
        console.log(`  inlined ${s.filename} (${s.bytes} bytes)`);
      }
      console.log(`  scaffold:  ${scaffoldDir} (skills source)`);

      try {
        const { stream, done, skillCount } = await buildGraftBundle({
          workspacePath: scaffoldDir,
          metadata: envelope.metadata,
          schema: envelope.schema,
        });
        await pipeline(stream, createWriteStream(outPath));
        await done;
        console.log(`  ✓ wrote ${outPath}`);
        console.log(`    skills bundled: ${skillCount}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`graft pack: ${msg}`);
        process.exit(1);
      }
    },
  );

// ─── push ────────────────────────────────────────────────────

program
  .command('push')
  .description("Inline scaffold sidecars and upload the bundle to the user's personal storage on the Guayaba backend.")
  .requiredOption(
    '--framework <slug>',
    `Source framework slug. Supported: ${SUPPORTED_FRAMEWORKS.join(', ')}.`,
  )
  .option(
    '-i, --input <path>',
    'Path to the scaffold directory (graft.json + sidecars + skills/). Defaults to the current working directory.',
  )
  .option('--icon <path>', 'Optional path to an icon image (PNG/JPG/WebP, ≤ 1 MB).')
  .option('--cover <path>', 'Optional path to a cover image (PNG/JPG/WebP, ≤ 4 MB).')
  .action(
    async (opts: {
      framework: string;
      input?: string;
      icon?: string;
      cover?: string;
    }) => {
      const framework = requireFramework('push', opts.framework);
      const scaffoldDir = resolve(opts.input ?? process.cwd());

      const { envelope, appliedSidecars } = await loadScaffold(scaffoldDir, framework, 'push');
      const apiKey = await resolveApiKey('push');

      const assets = {
        iconPath: opts.icon ? resolve(opts.icon) : undefined,
        coverPath: opts.cover ? resolve(opts.cover) : undefined,
      };

      console.log(`Pushing ${envelope.metadata.slug}@${envelope.metadata.version} to Guayaba …`);
      for (const s of appliedSidecars) {
        console.log(`  inlined ${s.filename} (${s.bytes} bytes)`);
      }

      try {
        const result = await pushGraftPackage(envelope, scaffoldDir, assets, { apiKey });
        if (result.ok) {
          console.log('  ✓ bundle uploaded');
          console.log(`    graft id:   ${result.id}`);
          console.log(`    version id: ${result.versionId}`);
          console.log(`    bundle:     ${result.bundleS3Key}`);
          for (const a of result.assets) console.log(`    ${a.type}: ${a.path}`);
        } else {
          console.error('  ✗ push rejected:');
          for (const issue of result.issues) {
            console.error(`    - ${issue.field}: ${issue.message}`);
          }
          process.exit(2);
        }
      } catch (err) {
        if (err instanceof PushRequestError) {
          console.error(`graft push: ${err.message}`);
          process.exit(2);
        }
        throw err;
      }

      // Avoid unused-variable warning in environments where sidecar list
      // isn't logged elsewhere.
      void appliedSidecars;
    },
  );

// `commander` writes help to stderr when no command is given. Keep that
// default behaviour rather than reinventing it here.
program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
