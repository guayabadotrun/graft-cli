// GRAFT bundle builder — assembles the full `.tar.gz` artefact that
// gets POSTed to the backend (either via the public `/grafts`
// endpoint with a master API key, or via the launcher's internal
// equivalent with a launcher API key).
//
// The on-the-wire layout is (frozen — see grafts-marketplace.md §0.4.5):
//
//   graft.tar.gz
//   ├── metadata.json
//   ├── schema.json
//   └── skills/
//       ├── <name>.tar.gz             ← raw skill folder
//       ├── <name>.manifest.json      ← parsed SKILL.md frontmatter, normalised
//       └── ...
//
// `<name>.manifest.json` is REQUIRED for every `<name>.tar.gz`. The
// backend persists it verbatim into `agent_skills.manifest` and never
// opens the tar — this keeps the backend framework-agnostic and removes
// PHP from the SKILL.md parsing chain entirely. Future framework
// launchers (Paperclip, Hermes…) emit the same manifest shape; the
// backend doesn't care.
//
// We deliberately don't include icon/cover here — those are unversioned
// per gene-seed/internal/roadmap/grafts-marketplace.md §0.3 and are
// uploaded via a separate endpoint (one per slug, last-write-wins).
//
// Side-effect contract: the function spawns a `tar` child and returns its
// stdout. The temp directory used for assembly is cleaned up when `done`
// settles (success or failure). Callers MUST consume `stream` and await
// `done` — leaking the stream would leak the tempdir.

import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Readable } from 'node:stream';

import { buildSkillManifest, listInstalledSkills, tarSkillBundle } from '../openclaw/skills.js';
import type { GraftDocument } from './build.js';
import type { GraftMetadata } from './package.js';

export interface BuildGraftBundleInput {
  /** Absolute path to the OpenClaw workspace root. */
  workspacePath: string;
  /** Already-validated metadata block (slug, version, name, …). */
  metadata: GraftMetadata;
  /** Schema document (`schema_version: 2`, defaults, fields). */
  schema: GraftDocument;
}

export interface BuildGraftBundleResult {
  /** Stream emitting the gzipped tarball bytes. Pipe somewhere. */
  stream: Readable;
  /** Resolves when tar exits cleanly, rejects on any failure. */
  done: Promise<void>;
  /** Number of skill sub-bundles included. Useful for telemetry. */
  skillCount: number;
}

/**
 * Build a complete GRAFT bundle from an OpenClaw workspace.
 *
 * The function does NOT validate `metadata` or `schema` — the backend's
 * `ValidateGraftRequest` is the single source of truth and is invoked at
 * push time. Validating here too would drift.
 */
export async function buildGraftBundle(
  input: BuildGraftBundleInput,
): Promise<BuildGraftBundleResult> {
  const { workspacePath, metadata, schema } = input;

  // Stage everything in a tempdir so the outer tar can simply `-C <dir> .`
  // No need to track individual file lists or worry about path escapes —
  // the dir we hand tar contains exactly what we want and nothing else.
  const stageDir = await fs.mkdtemp(path.join(os.tmpdir(), 'graft-bundle-'));

  let skillCount = 0;
  try {
    // Top-level documents.
    await fs.writeFile(
      path.join(stageDir, 'metadata.json'),
      JSON.stringify(metadata, null, 2),
      'utf8',
    );
    await fs.writeFile(
      path.join(stageDir, 'schema.json'),
      JSON.stringify(schema, null, 2),
      'utf8',
    );

    // Skills directory — only created if the workspace has any. An empty
    // `skills/` would round-trip fine but is noise on the wire.
    const { skills } = await listInstalledSkills(workspacePath);
    if (skills.length > 0) {
      const skillsDir = path.join(stageDir, 'skills');
      await fs.mkdir(skillsDir);

      // Sequential to keep CPU/IO predictable and to avoid spawning N
      // tar children at once on workspaces with many skills.
      for (const skill of skills) {
        const tarPath = path.join(skillsDir, `${skill.name}.tar.gz`);
        const manifestPath = path.join(skillsDir, `${skill.name}.manifest.json`);
        await writeSkillTarball(skill.path, tarPath);
        // Per §0.4.5, the manifest is written next to the tar so the
        // backend never needs to crack open the archive at apply time.
        await fs.writeFile(
          manifestPath,
          JSON.stringify(buildSkillManifest(skill), null, 2),
          'utf8',
        );
        skillCount += 1;
      }
    }
  } catch (err) {
    await safeRemove(stageDir);
    throw err;
  }

  // Outer `tar -czf - -C <stageDir> .` → stdout stream.
  const child = spawn('tar', ['-czf', '-', '-C', stageDir, '.'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  const done = new Promise<void>((resolveDone, rejectDone) => {
    child.on('error', async (err) => {
      await safeRemove(stageDir);
      rejectDone(err);
    });
    child.on('close', async (code, signal) => {
      await safeRemove(stageDir);
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

  return { stream: child.stdout, done, skillCount };
}

/**
 * Pipe a single skill's tarball into a file under the stage dir. We
 * reuse the existing `tarSkillBundle` so the on-disk layout of one
 * skill is decided in exactly one place.
 */
async function writeSkillTarball(skillDir: string, outPath: string): Promise<void> {
  const { stream, done } = tarSkillBundle(skillDir);
  const out = await fs.open(outPath, 'w');
  try {
    const writable = out.createWriteStream();
    await Promise.all([
      done,
      new Promise<void>((resolve, reject) => {
        stream.on('error', reject);
        writable.on('error', reject);
        writable.on('finish', resolve);
        stream.pipe(writable);
      }),
    ]);
  } finally {
    await out.close().catch(() => {
      // Already closed by the writable stream; swallow.
    });
  }
}

async function safeRemove(dir: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup; don't mask the original error.
  }
}
