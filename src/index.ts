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

export { extractOpenclawSummary } from './openclaw/extract.js';
export type { OpenclawAgentSummary, ThinkingLevel } from './openclaw/extract.js';

export { buildGraftFromOpenclaw } from './graft/build.js';
export type { GraftDocument, GraftDefaults, GraftField } from './graft/build.js';
