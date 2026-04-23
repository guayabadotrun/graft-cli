// OpenClaw skills reader + bundler.
//
// Responsibilities:
//   - Scan an OpenClaw agent workspace for installed skills.
//   - Parse each `SKILL.md` frontmatter (single-line YAML keys; `metadata`
//     is single-line JSON, per the OpenClaw skill contract).
//   - Produce a tar.gz stream of any one skill directory, suitable for
//     uploading as a GRAFT bundle.
//
// Both the launcher (at runtime, on demand) and the CLI (at `graft push`
// time) consume this module so the on-disk skill format stays in one place.

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import type { Readable } from 'node:stream';

/** Roots scanned for installed skills, in precedence order (highest first). */
export const SKILL_ROOTS = ['skills', '.agents/skills'] as const;

export type SkillRoot = (typeof SKILL_ROOTS)[number];

export interface InstalledSkill {
  /** The `name` field from the SKILL.md frontmatter (snake_case). */
  name: string;
  /** Absolute path of the skill directory. */
  path: string;
  /** Workspace-relative root the skill was discovered under. */
  root: SkillRoot;
  /** Parsed frontmatter, opaque beyond the `name` field. */
  manifest: Record<string, unknown>;
  /** Convenience: from `manifest.description` if string-typed. */
  description?: string;
  /** Convenience: from `manifest.metadata.openclaw.emoji` if string-typed. */
  emoji?: string;
}

export interface ListSkillsResult {
  skills: InstalledSkill[];
  /** Per-directory parse failures, surfaced for diagnostics — not fatal. */
  errors: Array<{ path: string; error: string }>;
}

/** Skill names must match this — same as OpenClaw's snake_case convention. */
const SKILL_NAME_PATTERN = /^[a-z0-9_-]+$/;

// ─── Frontmatter parser ─────────────────────────────────────

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length < 2) return trimmed;
  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function coerceScalar(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed === '') return '';
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === 'null' || trimmed === '~') return null;
  if (/^-?\d+$/.test(trimmed)) return Number(trimmed);
  if (/^-?\d*\.\d+$/.test(trimmed)) return Number(trimmed);
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      // not JSON — fall through to string
    }
  }
  return unquote(trimmed);
}

/**
 * Parse a SKILL.md frontmatter block. Returns null if no frontmatter is
 * present; throws if the block is malformed (missing closing `---`, line
 * without colon, or missing required `name` field).
 */
export function parseSkillFrontmatter(source: string): Record<string, unknown> | null {
  const normalised = source.replace(/\r\n/g, '\n');
  if (!normalised.startsWith('---\n')) return null;

  const closingIdx = normalised.indexOf('\n---', 4);
  if (closingIdx === -1) {
    throw new Error("SKILL.md frontmatter is missing closing '---' delimiter");
  }

  const block = normalised.slice(4, closingIdx);
  const out: Record<string, unknown> = {};
  for (const line of block.split('\n')) {
    if (line.trim() === '' || line.trim().startsWith('#')) continue;
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) {
      throw new Error(`SKILL.md frontmatter line has no colon: ${line}`);
    }
    const key = line.slice(0, colonIdx).trim();
    out[key] = coerceScalar(line.slice(colonIdx + 1));
  }

  if (typeof out.name !== 'string' || out.name.length === 0) {
    throw new Error("SKILL.md frontmatter is missing required 'name' field");
  }
  return out;
}

// ─── Scan ───────────────────────────────────────────────────

async function readSkill(dir: string, root: SkillRoot): Promise<InstalledSkill> {
  const skillFile = path.join(dir, 'SKILL.md');
  const content = await fs.readFile(skillFile, 'utf-8');
  const manifest = parseSkillFrontmatter(content);
  if (!manifest) {
    throw new Error(`SKILL.md at ${skillFile} has no frontmatter block`);
  }

  const meta =
    typeof manifest.metadata === 'object' && manifest.metadata !== null
      ? (manifest.metadata as Record<string, unknown>)
      : null;
  const ocMeta =
    meta && typeof meta.openclaw === 'object' && meta.openclaw !== null
      ? (meta.openclaw as Record<string, unknown>)
      : null;

  return {
    name: manifest.name as string,
    path: dir,
    root,
    manifest,
    description: typeof manifest.description === 'string' ? manifest.description : undefined,
    emoji: ocMeta && typeof ocMeta.emoji === 'string' ? ocMeta.emoji : undefined,
  };
}

async function scanRoot(rootDir: string, root: SkillRoot): Promise<ListSkillsResult> {
  let entries: string[];
  try {
    entries = await fs.readdir(rootDir);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return { skills: [], errors: [] };
    throw err;
  }

  const skills: InstalledSkill[] = [];
  const errors: ListSkillsResult['errors'] = [];
  for (const entry of entries) {
    if (entry.startsWith('.')) continue;
    const dir = path.join(rootDir, entry);
    try {
      const st = await fs.stat(dir);
      if (!st.isDirectory()) continue;
      skills.push(await readSkill(dir, root));
    } catch (err) {
      errors.push({
        path: dir,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { skills, errors };
}

/**
 * List every skill installed under an OpenClaw agent workspace.
 *
 * Skills found in `<workspace>/skills` take precedence over the same name
 * in `<workspace>/.agents/skills`; lower-precedence duplicates are dropped
 * silently, matching OpenClaw's own load-time behaviour.
 */
export async function listInstalledSkills(workspacePath: string): Promise<ListSkillsResult> {
  const seen = new Set<string>();
  const skills: InstalledSkill[] = [];
  const errors: ListSkillsResult['errors'] = [];
  for (const root of SKILL_ROOTS) {
    const result = await scanRoot(path.join(workspacePath, root), root);
    for (const skill of result.skills) {
      if (seen.has(skill.name)) continue;
      seen.add(skill.name);
      skills.push(skill);
    }
    errors.push(...result.errors);
  }
  return { skills, errors };
}

/**
 * Resolve the absolute path of an installed skill by name. Returns the
 * first match across the roots in precedence order. Throws `ENOENT` if no
 * directory contains a matching `SKILL.md`, `EINVAL` if `name` fails the
 * safety regex (which would otherwise allow path traversal).
 */
export async function resolveSkillDir(
  workspacePath: string,
  name: string,
): Promise<{ root: SkillRoot; dir: string }> {
  if (!SKILL_NAME_PATTERN.test(name)) {
    const err = new Error(`Invalid skill name: ${name}`);
    (err as NodeJS.ErrnoException).code = 'EINVAL';
    throw err;
  }
  for (const root of SKILL_ROOTS) {
    const dir = path.join(workspacePath, root, name);
    try {
      const st = await fs.stat(dir);
      if (!st.isDirectory()) continue;
      await fs.stat(path.join(dir, 'SKILL.md'));
      return { root, dir };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw err;
    }
  }
  const err = new Error(`Skill not found: ${name}`);
  (err as NodeJS.ErrnoException).code = 'ENOENT';
  throw err;
}

// ─── Tarball ───────────────────────────────────────────────

/**
 * Spawn `tar -czf - -C <parent> <basename>` and return its stdout stream.
 * The caller pipes it wherever they need; the `done` promise rejects if
 * tar exits non-zero (with stderr included), resolves on clean exit.
 */
export function tarSkillBundle(skillDir: string): {
  stream: Readable;
  done: Promise<void>;
} {
  const parent = path.dirname(skillDir);
  const name = path.basename(skillDir);

  const child = spawn('tar', ['-czf', '-', '-C', parent, name], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  const done = new Promise<void>((resolveDone, rejectDone) => {
    child.on('error', rejectDone);
    child.on('close', (code, signal) => {
      if (code === 0) {
        resolveDone();
        return;
      }
      const trimmed = stderr.trim().slice(0, 500);
      rejectDone(
        new Error(`tar exited with code=${code} signal=${signal ?? ''}: ${trimmed}`),
      );
    });
  });

  return { stream: child.stdout, done };
}
