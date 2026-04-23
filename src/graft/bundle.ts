// GRAFT bundle builder — assembles the full `.tar.gz` artefact that
// gets POSTed to the backend (either via the public `/grafts`
// endpoint with a master API key, or via the launcher's internal
// equivalent with a launcher API key).
//
// The on-the-wire layout is (frozen — see grafts-marketplace.md §0.4.5):
//
//   graft.tar.gz
//   ├── README.md                   ← author-facing scaffold guide
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
import { augmentSchemaWithMechanicalFields, extractChannels } from './scaffoldFields.js';

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
    // List skills up front: their manifests feed both the per-skill
    // tarballs AND the mechanical `fields[]` derivation that augments
    // the schema. Doing this once keeps everything consistent.
    const { skills } = await listInstalledSkills(workspacePath);
    const skillManifests = skills.map((s) => buildSkillManifest(s));

    // Augment the schema with mechanical `fields[]` (skill secrets +
    // channel secrets). Idempotent: if the caller already declared a
    // field with the same id we leave it alone, so re-bundling an
    // already-edited schema is a no-op for the derived part.
    const augmentedSchema = augmentSchemaWithMechanicalFields(schema, {
      skillManifests,
      channels: extractChannels(schema),
    });

    // Top-level documents.
    await fs.writeFile(
      path.join(stageDir, 'metadata.json'),
      JSON.stringify(metadata, null, 2),
      'utf8',
    );
    await fs.writeFile(
      path.join(stageDir, 'schema.json'),
      JSON.stringify(augmentedSchema, null, 2),
      'utf8',
    );
    // Author-facing guide. Lives in the bundle so the documentation
    // travels with the artefact — see grafts-marketplace.md §3.6.2.
    await fs.writeFile(
      path.join(stageDir, 'README.md'),
      renderScaffoldReadme(metadata),
      'utf8',
    );

    // Skills directory — only created if the workspace has any. An empty
    // `skills/` would round-trip fine but is noise on the wire.
    if (skills.length > 0) {
      const skillsDir = path.join(stageDir, 'skills');
      await fs.mkdir(skillsDir);

      // Sequential to keep CPU/IO predictable and to avoid spawning N
      // tar children at once on workspaces with many skills.
      for (let i = 0; i < skills.length; i += 1) {
        const skill = skills[i];
        const manifest = skillManifests[i];
        const tarPath = path.join(skillsDir, `${skill.name}.tar.gz`);
        const manifestPath = path.join(skillsDir, `${skill.name}.manifest.json`);
        await writeSkillTarball(skill.path, tarPath);
        // Per §0.4.5, the manifest is written next to the tar so the
        // backend never needs to crack open the archive at apply time.
        await fs.writeFile(
          manifestPath,
          JSON.stringify(manifest, null, 2),
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

/**
 * Render the scaffold's `README.md`. This is the single doc the author
 * will see when they open the downloaded `.tar.gz` — it has to be enough
 * to get them from "I have a bundle" to "I pushed a working GRAFT".
 *
 * Kept inline (vs. a separate template file) because it's short and
 * because the only dynamic bit is the slug — anything more elaborate
 * belongs in the marketplace docs, not in every author's tarball.
 */
function renderScaffoldReadme(metadata: GraftMetadata): string {
  const slug = metadata.slug;
  const version = metadata.version;
  return `# ${metadata.name} — GRAFT scaffold

This bundle is a **starting point** generated from a running agent. It contains
everything needed to recreate that agent as a GRAFT, but with no \`{{variables}}\`
yet — every default is the literal text the source agent had at export time.

## What's inside

\`\`\`
${slug}-${version}/
├── README.md              ← this file
├── metadata.json          ← marketplace-facing fields (name, slug, tags, …)
├── schema.json            ← agent definition + opt-in user inputs (\`fields[]\`)
└── skills/
    ├── <name>.tar.gz      ← raw skill folder (one per installed skill)
    └── <name>.manifest.json
\`\`\`

You can push this bundle as-is — it will work. But the point of a GRAFT is to be
*reusable across users*, which usually means turning some of the literal text in
\`schema.json\` into \`{{placeholders}}\` the wizard asks the new owner to fill in.

## Adding a user-input variable

Two changes, both in \`schema.json\`:

1. **Replace the literal value with \`{{your_variable_id}}\`** in \`defaults\`.
   Example — turn the agent's hard-coded bio into a templated one:

   \`\`\`diff
     "defaults": {
   -   "bio": "I help people debug Postgres queries."
   +   "bio": "I help people debug {{topic}} queries."
     }
   \`\`\`

2. **Declare the field** under \`fields[]\` so the wizard knows to ask for it:

   \`\`\`json
   {
     "id": "topic",
     "label": "What do you want help with?",
     "type": "text",
     "required": true,
     "placeholder": "Postgres"
   }
   \`\`\`

The full \`fields[]\` schema (types, validation, predicates, placement) lives in
the GRAFT marketplace docs — search "schema_version 2" in the public API docs.

## What's already templated for you

This scaffold pre-fills \`fields[]\` with the **mechanical** entries the launcher
can derive without guessing:

- One \`secret\` field per skill that declares a \`primary_env\` in its manifest.
- One \`secret\` field per channel that needs a token (e.g. Telegram).

Free-text variables (\`{{topic}}\`, \`{{tone}}\`, \`{{audience}}\` …) are **your job**
— the export tool deliberately doesn't try to invent them from prose.

## Re-packing after edits

\`\`\`bash
cd ${slug}-${version}/
tar -czf ../${slug}-${version}.tar.gz .
\`\`\`

(Run from inside the extracted folder so the tarball has the same flat layout.)

## Pushing the edited bundle

Until the "Upload bundle" UI ships, use the CLI:

\`\`\`bash
npx @guayaba/graft-cli push ./${slug}-${version}.tar.gz
\`\`\`

This calls \`POST /api/grafts\` with your master API key and creates (or
versions) the personal GRAFT. The same \`(slug, version)\` is **immutable** —
bump the version in \`metadata.json\` to push a new revision.
`;
}
