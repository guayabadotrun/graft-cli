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
  WorkspaceNotFoundError,
  InvalidOpenclawConfigError,
} from './index.js';

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
  .action(async (opts: { workspace?: string; out?: string; force?: boolean }) => {
    const target = opts.workspace ?? process.cwd();
    const outPath = resolve(opts.out ?? 'graft.json');
    try {
      const ws = await readOpenclawWorkspace(target);
      const summary = extractOpenclawSummary(ws);
      const doc = buildGraftFromOpenclaw(summary);

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

      await writeFile(outPath, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');

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
      console.log('Bio / knowledge / extra_instructions are NOT included — they live in agent-evolved markdown.');
      console.log('Add them by hand or wait for the interactive prompts step.');
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
