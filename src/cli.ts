// CLI entry point — wired up by tsup with a `#!/usr/bin/env node` banner
// and exposed as the `graft` binary in package.json.
//
// Commands are deliberately stubbed out at this stage. Each one will gain
// a real implementation in a follow-up step (workspace introspection →
// interactive prompts → graft.json emission).

import { Command } from 'commander';
import { writeFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
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
  .action(async (opts: { workspace?: string; out?: string; force?: boolean; interactive?: boolean }) => {
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
    } catch (err) {
      if (err instanceof WorkspaceNotFoundError || err instanceof InvalidOpenclawConfigError) {
        console.error(`graft init: ${err.message}`);
        process.exit(1);
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
