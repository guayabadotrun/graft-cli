// Sidecar markdown loader.
//
// At authoring time the scaffold contains markdown sidecar files
// (SOUL.md, IDENTITY.md, AGENTS.md, …) named after the source framework.
// `validate` and `pack` read those files, inline their contents into the
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
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed;
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
 * For `init`: copy each mapped markdown file from the source workspace
 * into the scaffold dir, preserving the original filename. Files that
 * don't exist in the workspace are skipped; missing ones are returned
 * so the caller can prompt the user about creating blank stubs.
 */
export async function copyWorkspaceSidecars(
  workspaceDir: string,
  scaffoldDir: string,
  framework: FrameworkSlug,
): Promise<{ copied: string[]; missingInWorkspace: string[] }> {
  const mapping = mappingFor(framework);
  const copied: string[] = [];
  const missingInWorkspace: string[] = [];

  for (const entry of mapping) {
    const src = path.join(workspaceDir, entry.filename);
    const dst = path.join(scaffoldDir, entry.filename);
    try {
      const data = await fs.readFile(src, 'utf8');
      await fs.writeFile(dst, data, 'utf8');
      copied.push(entry.filename);
    } catch {
      missingInWorkspace.push(entry.filename);
    }
  }

  return { copied, missingInWorkspace };
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
