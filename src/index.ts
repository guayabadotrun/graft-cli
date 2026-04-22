// Programmatic entry point for @guayaba/graft-cli.
//
// Anything that's safe to call from another tool (no prompts, no
// process.exit, no console output beyond what the caller asks for)
// belongs here. Right now we expose the package version and the
// OpenClaw workspace reader.

export const VERSION = '0.0.1';

export {
  readOpenclawWorkspace,
  WorkspaceNotFoundError,
  InvalidOpenclawConfigError,
} from './openclaw/workspace.js';
export type {
  OpenclawWorkspace,
  WorkspaceMarkdown,
  KnownMarkdownFile,
} from './openclaw/workspace.js';
