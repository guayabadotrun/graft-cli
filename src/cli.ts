// CLI entry point — wired up by tsup with a `#!/usr/bin/env node` banner
// and exposed as the `graft` binary in package.json.
//
// Commands are deliberately stubbed out at this stage. Each one will gain
// a real implementation in a follow-up step (workspace introspection →
// interactive prompts → graft.json emission).

import { Command } from 'commander';
import {
  VERSION,
  readOpenclawWorkspace,
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
  .description('Inspect an agent workspace and produce a graft.json template (interactive).')
  .option(
    '-w, --workspace <path>',
    'Path to the agent workspace to inspect. Defaults to the current working directory.',
  )
  .action(async (opts: { workspace?: string }) => {
    const target = opts.workspace ?? process.cwd();
    try {
      const ws = await readOpenclawWorkspace(target);
      const mdFiles = Object.keys(ws.markdown).sort();
      const configKeys =
        ws.config && typeof ws.config === 'object' ? Object.keys(ws.config as Record<string, unknown>) : [];
      console.log(`Found OpenClaw workspace at ${ws.workspacePath}`);
      console.log(`  config:   ${ws.configPath} (${configKeys.length} top-level keys)`);
      console.log(`  markdown: ${mdFiles.length ? mdFiles.join(', ') : '(none)'}`);
      console.log('');
      console.log('graft.json generation is not implemented yet — coming in the next iteration.');
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
