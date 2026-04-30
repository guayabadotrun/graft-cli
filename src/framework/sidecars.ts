// Sidecar markdown loader.
//
// At authoring time the scaffold contains markdown sidecar files named
// after their wizard field (personality.md, vibe.md,
// extra_instructions.md). `validate` and `pack` read those files, strip
// any leading instructional HTML comment, inline their contents into the
// GRAFT `defaults` (under the dot-path declared by the framework
// mapping), and hand the resulting envelope to the backend / bundler.
//
// Missing sidecars are NOT an error — they map to "field absent in
// defaults", which the schema validator accepts (those fields are
// optional). Empty files (whitespace only) are also treated as absent.

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { GraftDocument } from '../graft/build.js';
import type { FieldMapping, FrameworkSlug } from './mapping.js';
import { mappingFor } from './mapping.js';

export interface InlineSidecarsResult {
  schema: GraftDocument;
  /** Files that were read and applied. Useful for CLI output. */
  applied: { filename: string; schemaField: string; bytes: number }[];
  /** Files declared by the mapping but missing from the scaffold. */
  missing: string[];
}

/**
 * Read sidecars from `scaffoldDir` according to the given framework
 * mapping and return a NEW schema with their contents inlined into
 * `defaults`. Does not mutate the input schema.
 */
export async function inlineSidecars(
  schema: GraftDocument,
  scaffoldDir: string,
  framework: FrameworkSlug,
): Promise<InlineSidecarsResult> {
  const mapping = mappingFor(framework);
  // Deep-clone the parts of `defaults` we may write into so we don't
  // accidentally share array / object references with the caller.
  const next: GraftDocument = {
    ...schema,
    framework_constraints: [...schema.framework_constraints],
    defaults: {
      ...schema.defaults,
      ...(schema.defaults.channels ? { channels: [...schema.defaults.channels] } : {}),
      ...(schema.defaults.settings ? { settings: { ...schema.defaults.settings } } : {}),
    },
    fields: schema.fields.map((f) => ({ ...f })),
  };

  const applied: InlineSidecarsResult['applied'] = [];
  const missing: string[] = [];

  for (const entry of mapping) {
    const content = await readSidecar(path.join(scaffoldDir, entry.filename));
    if (content === undefined) {
      missing.push(entry.filename);
      continue;
    }
    setByDotPath(next.defaults as Record<string, unknown>, entry.schemaField, content);
    applied.push({
      filename: entry.filename,
      schemaField: entry.schemaField,
      bytes: Buffer.byteLength(content, 'utf8'),
    });
  }

  return { schema: next, applied, missing };
}

async function readSidecar(absPath: string): Promise<string | undefined> {
  let raw: string;
  try {
    raw = await fs.readFile(absPath, 'utf8');
  } catch {
    return undefined;
  }
  const stripped = stripLeadingInstructionComment(raw).trim();
  if (stripped.length === 0) return undefined;
  return stripped;
}

/**
 * Remove the instructional HTML comment that `copyWorkspaceSidecars`
 * prepends to each sidecar. This is a safety net for authors who forget
 * to delete it — the comment must never end up in the GRAFT defaults.
 *
 * Only strips a comment that starts on the very first line; any other
 * HTML comment inside the body is left untouched.
 */
function stripLeadingInstructionComment(content: string): string {
  const trimmedStart = content.trimStart();
  if (!trimmedStart.startsWith('<!--')) return content;
  const closeIdx = trimmedStart.indexOf('-->');
  if (closeIdx === -1) return content;
  return trimmedStart.slice(closeIdx + 3);
}

/**
 * Assign `value` into `target` at the dot-notation `pathStr`, creating
 * intermediate objects on the fly. Only string values are written.
 *
 * Example: setByDotPath({}, 'settings.extra_instructions', 'hi')
 *          → { settings: { extra_instructions: 'hi' } }
 */
function setByDotPath(target: Record<string, unknown>, pathStr: string, value: string): void {
  const segments = pathStr.split('.');
  let cursor: Record<string, unknown> = target;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i]!;
    const existing = cursor[seg];
    if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
      cursor = existing as Record<string, unknown>;
    } else {
      const fresh: Record<string, unknown> = {};
      cursor[seg] = fresh;
      cursor = fresh;
    }
  }
  cursor[segments[segments.length - 1]!] = value;
}

/**
 * For `init`: create a stub sidecar file in the scaffold dir for each
 * mapped field. The stub contains only an instructional HTML comment so
 * the author knows which framework file the field maps to; they must
 * write the template content themselves.
 *
 * Intentionally does NOT copy workspace content — copying verbatim text
 * from a live agent would duplicate it when the GRAFT is later applied
 * (the framework combines personality + extra_instructions into SOUL.md,
 * so pre-filled defaults would appear twice).
 */
export async function copyWorkspaceSidecars(
  _workspaceDir: string,
  scaffoldDir: string,
  framework: FrameworkSlug,
): Promise<{ created: string[] }> {
  const mapping = mappingFor(framework);
  const created: string[] = [];

  for (const entry of mapping) {
    const dst = path.join(scaffoldDir, entry.filename);
    const comment = buildInstructionComment(entry.workspaceFilename);
    await fs.writeFile(dst, comment, 'utf8');
    created.push(entry.filename);
  }

  return { created };
}

/**
 * Build the instructional comment prepended to each scaffold sidecar.
 * The comment tells the author which framework file the content maps to
 * and reminds them to remove it before pushing.
 */
function buildInstructionComment(workspaceFilename: string): string {
  return (
    `<!-- The content of this file will be added to ${workspaceFilename}. ` +
    `Delete this comment before pushing your GRAFT. -->\n`
  );
}

/**
 * For `init`: copy the workspace's installed skill directories into
 * `<scaffoldDir>/skills/<name>/`. The scaffold becomes self-contained
 * — `pack` and `push` then read skills straight from it without
 * needing a separate workspace flag.
 *
 * Skills under `<workspace>/skills/` and `<workspace>/.agents/skills/`
 * are flattened into a single `<scaffoldDir>/skills/` (precedence
 * already resolved by `listInstalledSkills`). Also copies a top-level
 * `TOOLS.md` when present, since the bundle picks it up from the same
 * location as a managed-doc contribution. Same goes for `install.sh`,
 * the optional first-apply binary-setup hook (see graft-cli README).
 *
 * Returns the list of skill names copied and flags for the optional
 * top-level files so the CLI can print a useful summary.
 */
export async function copyWorkspaceSkills(
  workspaceDir: string,
  scaffoldDir: string,
): Promise<{ skills: string[]; tools: boolean; installScript: boolean }> {
  // Imported lazily to avoid pulling the OpenClaw scanner into modules
  // that only need the sidecar mapping (e.g. tests of `inlineSidecars`).
  const { listInstalledSkills } = await import('../openclaw/skills.js');
  const { skills } = await listInstalledSkills(workspaceDir);

  if (skills.length > 0) {
    const skillsDst = path.join(scaffoldDir, 'skills');
    await fs.mkdir(skillsDst, { recursive: true });
    for (const skill of skills) {
      await fs.cp(skill.path, path.join(skillsDst, skill.name), {
        recursive: true,
      });
    }
  }

  let tools = false;
  const toolsSrc = path.join(workspaceDir, 'TOOLS.md');
  const toolsDst = path.join(scaffoldDir, 'TOOLS.md');
  try {
    const data = await fs.readFile(toolsSrc, 'utf8');
    await fs.writeFile(toolsDst, data, 'utf8');
    tools = true;
  } catch {
    // TOOLS.md is optional — silently skip when absent.
  }

  let installScript = false;
  const installSrc = path.join(workspaceDir, 'install.sh');
  const installDst = path.join(scaffoldDir, 'install.sh');
  try {
    // Use cp so the executable bit is preserved alongside the bytes —
    // the bundler also force-chmods 0755, but copying the source mode
    // here keeps the scaffold faithful to what the author wrote.
    await fs.cp(installSrc, installDst);
    installScript = true;
  } catch {
    // install.sh is optional — silently skip when absent.
  }

  return { skills: skills.map((s) => s.name), tools, installScript };
}

export function sidecarFilenamesFor(framework: FrameworkSlug): string[] {
  return mappingFor(framework).map((m: FieldMapping) => m.filename);
}
