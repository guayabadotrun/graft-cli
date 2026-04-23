// CLI entry point — wired up by tsup with a `#!/usr/bin/env node` banner
// and exposed as the `graft` binary in package.json.
//
// Commands are deliberately stubbed out at this stage. Each one will gain
// a real implementation in a follow-up step (workspace introspection →
// interactive prompts → graft.json emission).

import { Command } from 'commander';
import { writeFile, access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { isCancel, password } from '@clack/prompts';
import {
  VERSION,
  readOpenclawWorkspace,
  extractOpenclawSummary,
  buildGraftFromOpenclaw,
  collectMarkdownDecisions,
  mergeDecisionsIntoGraft,
  defaultMetadataFor,
  WorkspaceNotFoundError,
  InvalidOpenclawConfigError,
  validateGraftPackage,
  ValidateRequestError,
  pushGraftPackage,
  PushRequestError,
} from './index.js';
import type { GraftMetadata, GraftPackage } from './graft/package.js';
import { createClackPrompter } from './prompts/clack.js';

const program = new Command();

program
  .name('graft')
  .description('Generate Guayaba GRAFT templates from agent workspaces.')
  .version(VERSION, '-v, --version', 'Print the @guayaba/graft-cli version.');

program
  .command('init')
  .description('Inspect an agent workspace and emit a graft.json template (non-interactive baseline).')
  .option(
    '-w, --workspace <path>',
    'Path to the agent workspace to inspect. Defaults to the current working directory.',
  )
  .option(
    '-o, --out <path>',
    'Where to write the generated GRAFT document. Defaults to ./graft.json in the current directory.',
  )
  .option('-f, --force', 'Overwrite the output file if it already exists.', false)
  .option(
    '--no-interactive',
    'Skip the markdown prompts and emit the structural baseline only. Auto-enabled when stdin is not a TTY.',
  )
  .option(
    '--validate',
    'After writing, POST the envelope to the Guayaba API for authoritative validation. Prompts for your account master API key (or reads $GUAYABA_API_KEY).',
    false,
  )
  .action(async (opts: { workspace?: string; out?: string; force?: boolean; interactive?: boolean; validate?: boolean }) => {
    const target = opts.workspace ?? process.cwd();
    const outPath = resolve(opts.out ?? 'graft.json');
    // commander turns `--no-interactive` into `interactive: false`. Auto-disable
    // prompts when stdin isn't a TTY so the CLI is safe in CI / scripts.
    const interactive = opts.interactive !== false && Boolean(process.stdin.isTTY);
    try {
      const ws = await readOpenclawWorkspace(target);
      const summary = extractOpenclawSummary(ws);
      let doc = buildGraftFromOpenclaw(summary);
      let metadata: GraftMetadata = defaultMetadataFor(summary);

      if (interactive) {
        const prompter = createClackPrompter();
        const meta = await prompter.askMetadata(metadata);
        if (meta === null) {
          console.error('graft init: cancelled by user. No file written.');
          process.exit(1);
        }
        metadata = meta;

        const { decisions, cancelled } = await collectMarkdownDecisions(summary, prompter);
        if (cancelled) {
          console.error('graft init: cancelled by user. No file written.');
          process.exit(1);
        }
        doc = mergeDecisionsIntoGraft(doc, decisions);
      }

      if (!opts.force) {
        const exists = await access(outPath).then(
          () => true,
          () => false,
        );
        if (exists) {
          console.error(
            `graft init: refusing to overwrite ${outPath}. Pass --force to replace it.`,
          );
          process.exit(1);
        }
      }

      const pkg: GraftPackage = { metadata, schema: doc };
      await writeFile(outPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');

      console.log(`Found OpenClaw workspace at ${ws.workspacePath}`);
      if (summary.agent.name) {
        console.log(`  agent:    ${summary.agent.name}${summary.agent.id ? ` (${summary.agent.id})` : ''}`);
      }
      if (summary.universal.model) {
        console.log(`  model:    ${summary.universal.model}`);
      }
      if (summary.universal.thinking) {
        console.log(`  thinking: ${summary.universal.thinking}`);
      }
      if (summary.universal.channels.length > 0) {
        console.log(`  channels: ${summary.universal.channels.join(', ')}`);
      }
      console.log('');
      console.log(`Wrote ${outPath}`);
      console.log(`  slug:    ${metadata.slug || '(not set)'}`);
      console.log(`  version: ${metadata.version}`);
      if (!interactive) {
        console.log('Non-interactive mode: metadata is a placeholder; bio / knowledge / extra_instructions were not added.');
        console.log('Re-run in a TTY (or omit --no-interactive) to fill metadata and review markdown.');
      }

      if (opts.validate) {
        let apiKey = process.env.GUAYABA_API_KEY;
        if (!apiKey) {
          if (!interactive) {
            console.error(
              'graft init: --validate requires an account master API key. Set $GUAYABA_API_KEY or run in a TTY to be prompted.',
            );
            process.exit(2);
          }
          const entered = await password({
            message: 'Account master API key (input hidden)',
          });
          if (isCancel(entered) || typeof entered !== 'string' || entered.length === 0) {
            console.error('graft init: validation cancelled — no API key provided.');
            process.exit(1);
          }
          apiKey = entered;
        }

        console.log('');
        console.log('Validating against Guayaba API …');
        try {
          const result = await validateGraftPackage(pkg, { apiKey });
          if (result.ok) {
            console.log('  ✓ valid');
            for (const w of result.warnings) console.log(`  warning: ${w}`);
          } else {
            console.error('  ✗ invalid:');
            for (const issue of result.issues) {
              console.error(`    - ${issue.field}: ${issue.message}`);
            }
            process.exit(2);
          }
        } catch (err) {
          if (err instanceof ValidateRequestError) {
            console.error(`graft init: ${err.message}`);
            process.exit(2);
          }
          throw err;
        }
      }
    } catch (err) {
      if (err instanceof WorkspaceNotFoundError || err instanceof InvalidOpenclawConfigError) {
        console.error(`graft init: ${err.message}`);
        process.exit(1);
      }
      throw err;
    }
  });

program
  .command('push')
  .description('Upload a graft.json (and optional artwork) to your personal storage on the Guayaba backend.')
  .option(
    '-i, --input <path>',
    'Path to the GRAFT envelope to upload. Defaults to ./graft.json.',
  )
  .option(
    '-w, --workspace <path>',
    'Path to the OpenClaw workspace whose installed skills will be packed into the bundle. Defaults to the current working directory.',
  )
  .option(
    '--icon <path>',
    'Optional path to an icon image (PNG/JPG/WebP, ≤ 1 MB). Stored unversioned per slug.',
  )
  .option(
    '--cover <path>',
    'Optional path to a cover image (PNG/JPG/WebP, ≤ 4 MB). Stored unversioned per slug.',
  )
  .action(async (opts: { input?: string; workspace?: string; icon?: string; cover?: string }) => {
    const inputPath = resolve(opts.input ?? 'graft.json');
    const workspacePath = resolve(opts.workspace ?? process.cwd());

    // 1) Read + parse the envelope. Bail loudly if the file is missing or
    //    malformed so the user fixes it before we hit the wire.
    let pkg: GraftPackage;
    try {
      const raw = await readFile(inputPath, 'utf8');
      const parsed = JSON.parse(raw);
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        !('metadata' in parsed) ||
        !('schema' in parsed)
      ) {
        console.error(`graft push: ${inputPath} is not a valid GRAFT envelope. Expected an object with 'metadata' and 'schema' keys.`);
        process.exit(1);
      }
      pkg = parsed as GraftPackage;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`graft push: could not read ${inputPath}: ${msg}`);
      process.exit(1);
    }

    // 2) Collect API key the same way `--validate` does so the auth UX is
    //    consistent across commands.
    let apiKey = process.env.GUAYABA_API_KEY;
    if (!apiKey) {
      if (!process.stdin.isTTY) {
        console.error(
          'graft push: requires an account master API key. Set $GUAYABA_API_KEY or run in a TTY to be prompted.',
        );
        process.exit(2);
      }
      const entered = await password({
        message: 'Account master API key (input hidden)',
      });
      if (isCancel(entered) || typeof entered !== 'string' || entered.length === 0) {
        console.error('graft push: cancelled — no API key provided.');
        process.exit(1);
      }
      apiKey = entered;
    }

    // 3) Resolve asset paths (if any) before doing any I/O — fail fast on
    //    typos.
    const assets = {
      iconPath: opts.icon ? resolve(opts.icon) : undefined,
      coverPath: opts.cover ? resolve(opts.cover) : undefined,
    };

    console.log(`Pushing ${pkg.metadata.slug}@${pkg.metadata.version} to Guayaba …`);

    try {
      const result = await pushGraftPackage(pkg, workspacePath, assets, { apiKey });
      if (result.ok) {
        console.log('  ✓ bundle uploaded');
        console.log(`    graft id:   ${result.id}`);
        console.log(`    version id: ${result.versionId}`);
        console.log(`    bundle:     ${result.bundleS3Key}`);
        for (const a of result.assets) {
          console.log(`    ${a.type}: ${a.path}`);
        }
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
  });

// `commander` writes help to stderr when no command is given. Keep that
// default behaviour rather than reinventing it here.
program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
