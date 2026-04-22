// OpenClaw workspace reader.
//
// Given a directory on disk, locate the OpenClaw config + the well-known
// markdown files an agent uses (SOUL/AGENTS/USER/...). Parsing is kept
// deliberately shallow: this module only proves the workspace is real
// and surfaces its raw contents. Field extraction (skills, model,
// channels, etc.) lives in later modules so that adding new frameworks
// later doesn't bleed into the file-reading layer.

import { promises as fs } from 'node:fs';
import * as path from 'node:path';

/** Canonical names of the agent-managed markdown files we care about. */
const KNOWN_MARKDOWN_FILES = [
  'SOUL.md',
  'AGENTS.md',
  'USER.md',
  'IDENTITY.md',
  'TOOLS.md',
  'HEARTBEAT.md',
  'MEMORY.md',
] as const;

export type KnownMarkdownFile = (typeof KNOWN_MARKDOWN_FILES)[number];

/** Lower-case keys without the `.md` suffix, easier to consume. */
export type WorkspaceMarkdown = Partial<Record<Lowercase<KnownMarkdownFile> extends `${infer K}.md` ? K : never, string>>;

export interface OpenclawWorkspace {
  /** Absolute path to the workspace root the user pointed us at. */
  workspacePath: string;
  /** Absolute path to the discovered `.openclaw/openclaw.json`. */
  configPath: string;
  /** Raw parsed JSON of `openclaw.json`. Shape is intentionally `unknown` here. */
  config: unknown;
  /** Contents of the well-known markdown files that exist, keyed by lower-case basename. */
  markdown: WorkspaceMarkdown;
}

export class WorkspaceNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkspaceNotFoundError';
  }
}

export class InvalidOpenclawConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidOpenclawConfigError';
  }
}

/**
 * Read an OpenClaw agent workspace from disk.
 *
 * @throws {WorkspaceNotFoundError} when the path doesn't exist, isn't a
 *   directory, or doesn't contain `.openclaw/openclaw.json`.
 * @throws {InvalidOpenclawConfigError} when `openclaw.json` exists but
 *   isn't valid JSON.
 */
export async function readOpenclawWorkspace(workspacePath: string): Promise<OpenclawWorkspace> {
  const absoluteWorkspace = path.resolve(workspacePath);

  let stat;
  try {
    stat = await fs.stat(absoluteWorkspace);
  } catch {
    throw new WorkspaceNotFoundError(`Workspace path does not exist: ${absoluteWorkspace}`);
  }
  if (!stat.isDirectory()) {
    throw new WorkspaceNotFoundError(`Workspace path is not a directory: ${absoluteWorkspace}`);
  }

  const configPath = path.join(absoluteWorkspace, '.openclaw', 'openclaw.json');
  let raw: string;
  try {
    raw = await fs.readFile(configPath, 'utf8');
  } catch {
    throw new WorkspaceNotFoundError(
      `Could not find OpenClaw config at ${configPath}. Is this an OpenClaw agent workspace?`,
    );
  }

  let config: unknown;
  try {
    config = JSON.parse(raw);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new InvalidOpenclawConfigError(
      `Failed to parse ${configPath} as JSON: ${detail}`,
    );
  }

  const markdown: Record<string, string> = {};
  await Promise.all(
    KNOWN_MARKDOWN_FILES.map(async (name) => {
      const filePath = path.join(absoluteWorkspace, name);
      try {
        const content = await fs.readFile(filePath, 'utf8');
        const key = name.replace(/\.md$/, '').toLowerCase();
        markdown[key] = content;
      } catch {
        // Missing markdown files are expected — the launcher only writes
        // the ones the agent needs.
      }
    }),
  );

  return {
    workspacePath: absoluteWorkspace,
    configPath,
    config,
    markdown: markdown as WorkspaceMarkdown,
  };
}
