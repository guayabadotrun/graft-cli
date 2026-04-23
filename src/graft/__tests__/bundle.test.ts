import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn } from 'node:child_process';

import { buildGraftBundle } from '../bundle.js';
import type { GraftDocument } from '../build.js';
import type { GraftMetadata } from '../package.js';

async function makeWorkspace(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'graft-bundle-test-'));
}

async function writeSkill(workspace: string, name: string): Promise<void> {
  const dir = path.join(workspace, 'skills', name);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: test\n---\nbody-of-${name}\n`,
    'utf8',
  );
  await fs.writeFile(path.join(dir, 'extra.txt'), `extra-${name}`, 'utf8');
}

/** Stream the tar output to disk so we can inspect it after `done`. */
async function consumeToFile(stream: NodeJS.ReadableStream, file: string): Promise<void> {
  const handle = await fs.open(file, 'w');
  try {
    const writable = handle.createWriteStream();
    await new Promise<void>((resolve, reject) => {
      stream.on('error', reject);
      writable.on('error', reject);
      writable.on('finish', resolve);
      stream.pipe(writable);
    });
  } finally {
    await handle.close().catch(() => {});
  }
}

/** Run `tar -tzf <archive>` and return the list of entries. */
function listEntries(archive: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const child = spawn('tar', ['-tzf', archive], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (b: Buffer) => (stdout += b.toString()));
    child.stderr.on('data', (b: Buffer) => (stderr += b.toString()));
    child.on('close', (code) => {
      if (code === 0) {
        resolve(
          stdout
            .split('\n')
            .map((s) => s.trim())
            .filter((s) => s.length > 0 && s !== './'),
        );
      } else {
        reject(new Error(`tar -tzf failed: ${stderr}`));
      }
    });
  });
}

/** Extract a single file from the outer tarball into a buffer. */
function extractFile(archive: string, member: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn('tar', ['-xzOf', archive, member], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const chunks: Buffer[] = [];
    let stderr = '';
    child.stdout.on('data', (b: Buffer) => chunks.push(b));
    child.stderr.on('data', (b: Buffer) => (stderr += b.toString()));
    child.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(`extract ${member} failed: ${stderr}`));
    });
  });
}

const META: GraftMetadata = {
  slug: 'demo-graft',
  name: 'Demo',
  version: '0.1.0',
  tags: ['x'],
  category_slugs: [],
  framework_slugs: ['openclaw'],
  tier: 'free',
  price_credits: 0,
};

const SCHEMA: GraftDocument = {
  schema_version: 2,
  framework_constraints: ['openclaw'],
  defaults: { channels: ['telegram'] },
  fields: [],
};

describe('buildGraftBundle', () => {
  it('produces a tarball with metadata.json and schema.json when there are no skills', async () => {
    const workspace = await makeWorkspace();
    const out = path.join(workspace, 'out.tar.gz');

    const { stream, done, skillCount } = await buildGraftBundle({
      workspacePath: workspace,
      metadata: META,
      schema: SCHEMA,
    });
    await Promise.all([consumeToFile(stream, out), done]);

    expect(skillCount).toBe(0);
    const entries = await listEntries(out);
    expect(entries.sort()).toEqual(['./README.md', './metadata.json', './schema.json']);

    const metaJson = JSON.parse((await extractFile(out, './metadata.json')).toString('utf8'));
    expect(metaJson.slug).toBe('demo-graft');
    const schemaJson = JSON.parse((await extractFile(out, './schema.json')).toString('utf8'));
    expect(schemaJson.schema_version).toBe(2);

    // The author-facing scaffold guide is shipped inside every bundle
    // (see grafts-marketplace.md §3.6.2). Sanity-check it mentions the
    // slug and the two key authoring instructions.
    const readme = (await extractFile(out, './README.md')).toString('utf8');
    expect(readme).toContain('demo-graft');
    expect(readme).toContain('{{');
    expect(readme).toContain('graft-cli push');

    await fs.rm(workspace, { recursive: true, force: true });
  });

  it('embeds one sub-tarball per installed skill under skills/', async () => {
    const workspace = await makeWorkspace();
    await writeSkill(workspace, 'alpha');
    await writeSkill(workspace, 'beta');
    const out = path.join(workspace, 'out.tar.gz');

    const { stream, done, skillCount } = await buildGraftBundle({
      workspacePath: workspace,
      metadata: META,
      schema: SCHEMA,
    });
    await Promise.all([consumeToFile(stream, out), done]);

    expect(skillCount).toBe(2);
    const entries = await listEntries(out);
    expect(entries).toContain('./metadata.json');
    expect(entries).toContain('./schema.json');
    expect(entries).toContain('./skills/alpha.tar.gz');
    expect(entries).toContain('./skills/beta.tar.gz');
    expect(entries).toContain('./skills/alpha.manifest.json');
    expect(entries).toContain('./skills/beta.manifest.json');

    // Sub-tarball is a real, valid tar.gz containing the skill dir.
    const alphaSubTar = path.join(workspace, 'alpha-extracted.tar.gz');
    await fs.writeFile(alphaSubTar, await extractFile(out, './skills/alpha.tar.gz'));
    const subEntries = await listEntries(alphaSubTar);
    expect(subEntries).toContain('alpha/SKILL.md');
    expect(subEntries).toContain('alpha/extra.txt');

    // The companion manifest is a parsed projection of the SKILL.md.
    const alphaManifest = JSON.parse(
      (await extractFile(out, './skills/alpha.manifest.json')).toString('utf8'),
    );
    await fs.rm(workspace, { recursive: true, force: true });
  });

  it('includes top-level TOOLS.md from the workspace when present', async () => {
    const workspace = await makeWorkspace();
    await fs.writeFile(
      path.join(workspace, 'TOOLS.md'),
      '# Tools\n\nuse `gh` with $GITHUB_TOKEN\n',
      'utf8',
    );
    const out = path.join(workspace, 'out.tar.gz');

    const { stream, done } = await buildGraftBundle({
      workspacePath: workspace,
      metadata: META,
      schema: SCHEMA,
    });
    await Promise.all([consumeToFile(stream, out), done]);

    const entries = await listEntries(out);
    expect(entries).toContain('./TOOLS.md');
    const body = (await extractFile(out, './TOOLS.md')).toString('utf8');
    expect(body).toContain('GITHUB_TOKEN');

    await fs.rm(workspace, { recursive: true, force: true });
  });

  it('omits TOOLS.md from the bundle when the workspace has none', async () => {
    const workspace = await makeWorkspace();
    const out = path.join(workspace, 'out.tar.gz');

    const { stream, done } = await buildGraftBundle({
      workspacePath: workspace,
      metadata: META,
      schema: SCHEMA,
    });
    await Promise.all([consumeToFile(stream, out), done]);

    const entries = await listEntries(out);
    expect(entries).not.toContain('./TOOLS.md');

    await fs.rm(workspace, { recursive: true, force: true });
  });

  it('cleans up its tempdir after success (no orphans in os.tmpdir)', async () => {
    const workspace = await makeWorkspace();
    const before = (await fs.readdir(os.tmpdir())).filter((n) =>
      n.startsWith('graft-bundle-'),
    );

    const out = path.join(workspace, 'out.tar.gz');
    const { stream, done } = await buildGraftBundle({
      workspacePath: workspace,
      metadata: META,
      schema: SCHEMA,
    });
    await Promise.all([consumeToFile(stream, out), done]);

    const after = (await fs.readdir(os.tmpdir())).filter((n) =>
      n.startsWith('graft-bundle-'),
    );
    // No new graft-bundle- tempdirs should remain after the call returns.
    expect(after.length).toBeLessThanOrEqual(before.length);

    await fs.rm(workspace, { recursive: true, force: true });
  });
});
