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

export { mergeDecisionsIntoGraft } from './graft/merge.js';
export { collectMarkdownDecisions } from './prompts/markdown.js';
export type { MarkdownDecisions, CollectResult } from './prompts/markdown.js';
export type {
  Prompter,
  MarkdownDecision,
  MarkdownPromptInput,
  MarkdownTarget,
  MetadataResult,
} from './prompts/types.js';

export {
  defaultMetadataFor,
  slugify,
  parseTagsInput,
  validateSlug,
  validateName,
  validateShortDescription,
  validateVersion,
} from './graft/metadata.js';
export type { GraftMetadata, GraftPackage, KnownCategorySlug } from './graft/package.js';
export { KNOWN_CATEGORY_SLUGS } from './graft/package.js';
