// OpenClaw skills reader + bundler.
//
// Responsibilities:
//   - Scan an OpenClaw agent workspace for installed skills.
//   - Parse each `SKILL.md` frontmatter using `gray-matter`, then enforce
//     the OpenClaw spec via `validateSkillFrontmatter` (canonical
//     contract, see grafts-marketplace.md §0.4.4).
//   - Produce a tar.gz stream of any one skill directory, suitable for
//     uploading as a GRAFT bundle.
//
// Both the launcher (at runtime, on demand) and the CLI (at `graft push`
// time) consume this module so the on-disk skill format stays in one place.
// Other framework launchers (Paperclip, Hermes…) are expected to ship
// their own pre-parser that emits the same `<name>.manifest.json` shape;
// the backend never parses SKILL.md.

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import type { Readable } from 'node:stream';
import matter from 'gray-matter';

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
  /**
   * Per-name conflicts where a lower-precedence root was silently dropped
   * because the same `name` already appeared in a higher-precedence root.
   * The launcher logs these as WARN so the conflict is visible to the
   * user in the in-UI agent log viewer (see grafts-marketplace.md §0.4.3).
   * graft-cli currently ignores them.
   */
  duplicates: Array<{ name: string; winner: SkillRoot; loser: SkillRoot }>;
}

/** Skill names must match this — same as OpenClaw's snake_case convention. */
const SKILL_NAME_PATTERN = /^[a-z0-9_-]+$/;

// ─── Frontmatter parser ─────────────────────────────────────
//
// Strategy: parse with `gray-matter` (which accepts arbitrary YAML),
// then enforce the OpenClaw single-line constraint with a strict
// post-validator. This way we get a battle-tested parser AND keep the
// canonical Guayaba SKILL.md spec honest. See §0.4.4 of the roadmap.

/** Top-level keys recognised by the OpenClaw skill spec. */
const KNOWN_FRONTMATTER_KEYS = new Set([
  'name',
  'description',
  'homepage',
  'user-invocable',
  'disable-model-invocation',
  'command-dispatch',
  'command-tool',
  'command-arg-mode',
  'metadata',
]);

/**
 * Validates a parsed-by-gray-matter frontmatter object against the
 * canonical Guayaba SKILL.md contract. Throws on any violation; returns
 * the same object on success so it can be chained.
 *
 * Constraints enforced (mirrors OpenClaw upstream parser, see
 * https://docs.openclaw.ai/tools/skills):
 *   - `name`         (required, non-empty string, snake_case-ish)
 *   - `description`  (required, non-empty string)
 *   - all other keys must be in {@link KNOWN_FRONTMATTER_KEYS}
 *   - `metadata`     (optional, plain object — single-line JSON in source)
 *   - boolean keys must actually be booleans
 *
 * Multi-line YAML constructs (e.g. `description: |\n…`) are rejected at
 * the source-text level by {@link assertSingleLineKeys} because the
 * upstream parser doesn't accept them either.
 */
export function validateSkillFrontmatter(
  data: Record<string, unknown>,
): Record<string, unknown> {
  if (typeof data.name !== 'string' || data.name.length === 0) {
    throw new Error("SKILL.md frontmatter is missing required 'name' field");
  }
  if (!SKILL_NAME_PATTERN.test(data.name)) {
    throw new Error(
      `SKILL.md frontmatter 'name' must match ${SKILL_NAME_PATTERN.source}, got '${data.name}'`,
    );
  }
  if (typeof data.description !== 'string' || data.description.length === 0) {
    throw new Error("SKILL.md frontmatter is missing required 'description' field");
  }
  for (const key of Object.keys(data)) {
    if (!KNOWN_FRONTMATTER_KEYS.has(key)) {
      throw new Error(`SKILL.md frontmatter has unknown key '${key}'`);
    }
  }
  for (const boolKey of ['user-invocable', 'disable-model-invocation']) {
    if (boolKey in data && typeof data[boolKey] !== 'boolean') {
      throw new Error(`SKILL.md frontmatter '${boolKey}' must be a boolean`);
    }
  }
  if ('metadata' in data) {
    if (typeof data.metadata !== 'object' || data.metadata === null || Array.isArray(data.metadata)) {
      throw new Error("SKILL.md frontmatter 'metadata' must be an object");
    }
  }
  return data;
}

/**
 * Reject multi-line YAML in the frontmatter source. OpenClaw's upstream
 * parser only accepts single-line `key: value` pairs at the top level
 * (per docs); we mirror that here so a SKILL.md that parses cleanly with
 * `gray-matter` but would break upstream is caught at our boundary.
 */
function assertSingleLineKeys(blockSource: string): void {
  const lines = blockSource.split('\n');
  for (const line of lines) {
    if (line.trim() === '' || line.trim().startsWith('#')) continue;
    // Top-level keys must start at column 0 with `key:`. Indented lines
    // (the start of a YAML block scalar or nested mapping) are rejected.
    if (/^\s/.test(line)) {
      throw new Error(
        'SKILL.md frontmatter must use single-line keys only (no multi-line YAML blocks). ' +
          'Use single-line JSON for `metadata`.',
      );
    }
  }
}

/**
 * Parse a SKILL.md frontmatter block. Returns null if no frontmatter is
 * present; throws if the block is malformed (missing closing `---`,
 * unknown key, missing required `name`/`description`, or a multi-line
 * YAML construct that would not survive a round-trip through OpenClaw's
 * parser).
 */
export function parseSkillFrontmatter(source: string): Record<string, unknown> | null {
  const normalised = source.replace(/\r\n/g, '\n');
  if (!normalised.startsWith('---\n')) return null;

  // Locate the closing delimiter ourselves so we can give a precise error
  // and so we can validate the raw block source (gray-matter throws a
  // generic YAMLException on bad input which is hard to attribute).
  const closingIdx = normalised.indexOf('\n---', 4);
  if (closingIdx === -1) {
    throw new Error("SKILL.md frontmatter is missing closing '---' delimiter");
  }
  const blockSource = normalised.slice(4, closingIdx);
  assertSingleLineKeys(blockSource);

  let parsed: matter.GrayMatterFile<string>;
  try {
    parsed = matter(normalised);
  } catch (err) {
    throw new Error(
      `SKILL.md frontmatter is not valid YAML: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const data = (parsed.data ?? {}) as Record<string, unknown>;
  return validateSkillFrontmatter(data);
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

/**
 * Returns true if the directory contains a readable `SKILL.md` file.
 * Used to decide whether a directory IS a skill or merely a container
 * (e.g. the clawhub group dir at `skills/<source>/<name>/SKILL.md`).
 */
async function hasSkillFile(dir: string): Promise<boolean> {
  try {
    const st = await fs.stat(path.join(dir, 'SKILL.md'));
    return st.isFile();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
}

async function scanRoot(rootDir: string, root: SkillRoot): Promise<{ skills: InstalledSkill[]; errors: ListSkillsResult['errors'] }> {
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

      // Layout 1 (flat): `<root>/<skill>/SKILL.md` — historical CLI
      // convention, what `graft init` produces.
      if (await hasSkillFile(dir)) {
        skills.push(await readSkill(dir, root));
        continue;
      }

      // Layout 2 (grouped): `<root>/<source>/<skill>/SKILL.md` — what
      // `openclaw skills install` from clawhub produces (the outer dir
      // is the source/namespace, the inner one is the actual skill).
      // Descend exactly one more level — we deliberately do NOT recurse
      // arbitrarily to keep the scan cheap and predictable.
      let inner: string[];
      try {
        inner = await fs.readdir(dir);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'ENOTDIR') continue;
        throw err;
      }
      for (const sub of inner) {
        if (sub.startsWith('.')) continue;
        const subDir = path.join(dir, sub);
        try {
          const subSt = await fs.stat(subDir);
          if (!subSt.isDirectory()) continue;
          if (!(await hasSkillFile(subDir))) continue;
          skills.push(await readSkill(subDir, root));
        } catch (err) {
          errors.push({
            path: subDir,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
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
 * silently from `skills`, but reported via `duplicates` so callers (the
 * launcher) can log them. See grafts-marketplace.md §0.4.3.
 */
export async function listInstalledSkills(workspacePath: string): Promise<ListSkillsResult> {
  const winners = new Map<string, SkillRoot>();
  const skills: InstalledSkill[] = [];
  const errors: ListSkillsResult['errors'] = [];
  const duplicates: ListSkillsResult['duplicates'] = [];
  for (const root of SKILL_ROOTS) {
    const result = await scanRoot(path.join(workspacePath, root), root);
    for (const skill of result.skills) {
      const winner = winners.get(skill.name);
      if (winner !== undefined) {
        duplicates.push({ name: skill.name, winner, loser: root });
        continue;
      }
      winners.set(skill.name, root);
      skills.push(skill);
    }
    errors.push(...result.errors);
  }
  return { skills, errors, duplicates };
}

/**
 * Normalised skill manifest emitted alongside each `<name>.tar.gz` in a
 * GRAFT bundle. Persisted verbatim by the backend into
 * `agent_skills.manifest`. The shape is framework-agnostic on purpose: a
 * future Paperclip launcher will produce the same JSON from whatever its
 * skill format looks like, and the backend never has to know.
 *
 * See grafts-marketplace.md §0.4.4 + §0.4.5.
 */
export interface SkillManifestJson {
  name: string;
  description: string;
  emoji?: string;
  homepage?: string;
  /** OpenClaw `metadata.openclaw.requires` block (bins / env / config). */
  requires?: Record<string, unknown>;
  /** OpenClaw `metadata.openclaw.primaryEnv` (key the skill keys auth on). */
  primary_env?: string;
  /** OpenClaw `metadata.openclaw.install` block (brew/node/go/uv/download). */
  install?: Record<string, unknown>;
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Build the JSON manifest written next to a skill's tar.gz inside a GRAFT
 * bundle. Pure projection of the parsed SKILL.md frontmatter — never
 * reads the filesystem.
 */
export function buildSkillManifest(skill: InstalledSkill): SkillManifestJson {
  const meta = asObject(skill.manifest.metadata);
  const ocMeta = meta ? asObject(meta.openclaw) : undefined;

  const out: SkillManifestJson = {
    name: skill.name,
    description: typeof skill.manifest.description === 'string' ? skill.manifest.description : '',
  };

  const emoji = skill.emoji ?? (ocMeta ? asNonEmptyString(ocMeta.emoji) : undefined);
  if (emoji !== undefined) out.emoji = emoji;

  const homepage = asNonEmptyString(skill.manifest.homepage);
  if (homepage !== undefined) out.homepage = homepage;

  if (ocMeta) {
    const requires = asObject(ocMeta.requires);
    if (requires !== undefined) out.requires = requires;

    const primaryEnv = asNonEmptyString(ocMeta.primaryEnv);
    if (primaryEnv !== undefined) out.primary_env = primaryEnv;

    const install = asObject(ocMeta.install);
    if (install !== undefined) out.install = install;
  }

  return out;
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
    // Flat: `<root>/<name>/SKILL.md`.
    const dir = path.join(workspacePath, root, name);
    try {
      const st = await fs.stat(dir);
      if (st.isDirectory() && (await hasSkillFile(dir))) {
        return { root, dir };
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }

    // Grouped: `<root>/<source>/<name>/SKILL.md` — clawhub layout. Walk
    // the immediate children of <root> looking for a child group dir
    // that contains `<name>/SKILL.md`. First match wins (group order is
    // filesystem order; clawhub never installs the same skill twice).
    let groups: string[];
    try {
      groups = await fs.readdir(path.join(workspacePath, root));
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ENOTDIR') continue;
      throw err;
    }
    for (const group of groups) {
      if (group.startsWith('.')) continue;
      const candidate = path.join(workspacePath, root, group, name);
      try {
        const st = await fs.stat(candidate);
        if (st.isDirectory() && (await hasSkillFile(candidate))) {
          return { root, dir: candidate };
        }
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      }
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
