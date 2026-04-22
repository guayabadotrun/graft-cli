// CLI entry point — wired up by tsup with a `#!/usr/bin/env node` banner
// and exposed as the `graft` binary in package.json.
//
// Commands are deliberately stubbed out at this stage. Each one will gain
// a real implementation in a follow-up step (workspace introspection →
// interactive prompts → graft.json emission).

import { Command } from 'commander';
import { VERSION } from './index.js';

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
  .action((opts: { workspace?: string }) => {
    const target = opts.workspace ?? process.cwd();
    // Placeholder until the real workspace inspector lands. Keep the
    // message stable — tests assert on it as a smoke check.
    console.log(`graft init: workspace introspection not implemented yet (target: ${target})`);
  });

// `commander` writes help to stderr when no command is given. Keep that
// default behaviour rather than reinventing it here.
program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
