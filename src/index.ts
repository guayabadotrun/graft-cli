// Programmatic entry point for @guayaba/graft-cli.
//
// Anything that's safe to call from another tool (no prompts, no
// process.exit, no console output beyond what the caller asks for)
// belongs here. Right now we expose the package version and the
// OpenClaw workspace reader.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Read version from package.json at module load. Works for both the
// bundled dist (`dist/index.js` -> `../package.json`) and src under
// tsx (`src/index.ts` -> `../package.json`). tsup shims
// `import.meta.url` for the CJS build.
const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
export const VERSION = (JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string }).version;

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

export {
  parseSkillFrontmatter,
  listInstalledSkills,
  resolveSkillDir,
  tarSkillBundle,
  SKILL_ROOTS,
} from './openclaw/skills.js';
export type {
  InstalledSkill,
  ListSkillsResult,
  SkillRoot,
} from './openclaw/skills.js';

export { buildGraftFromOpenclaw } from './graft/build.js';
export type { GraftDocument, GraftDefaults, GraftField } from './graft/build.js';

export { buildGraftBundle } from './graft/bundle.js';
export type {
  BuildGraftBundleInput,
  BuildGraftBundleResult,
} from './graft/bundle.js';

export type {
  Prompter,
  MetadataResult,
} from './prompts/types.js';

export {
  defaultMetadataFor,
  slugify,
  parseTagsInput,
} from './graft/metadata.js';
export type { GraftMetadata, GraftPackage, KnownCategorySlug } from './graft/package.js';
export { KNOWN_CATEGORY_SLUGS } from './graft/package.js';

export {
  validateGraftPackage,
  ValidateRequestError,
} from './api/validateClient.js';
export type {
  ValidationIssue,
  ValidateResult,
  ValidateClientOptions,
} from './api/validateClient.js';

export {
  pushGraftPackage,
  PushRequestError,
} from './api/pushClient.js';
export type {
  PushAssets,
  PushClientOptions,
  PushedAsset,
  PushResult,
} from './api/pushClient.js';

export { API_BASE_URL } from './config.js';
