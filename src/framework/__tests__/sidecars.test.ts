import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import {
  inlineSidecars,
  copyWorkspaceSidecars,
  copyWorkspaceSkills,
  sidecarFilenamesFor,
} from '../sidecars.js';
import type { GraftDocument } from '../../graft/build.js';

function emptyDoc(): GraftDocument {
  return {
    schema_version: 2,
    framework_constraints: ['openclaw'],
    defaults: {},
    fields: [],
  };
}

describe('inlineSidecars', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'graft-sidecars-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('inlines all three openclaw sidecars when present', async () => {
    await writeFile(path.join(dir, 'SOUL.md'), 'You are a helpful assistant.', 'utf8');
    await writeFile(path.join(dir, 'IDENTITY.md'), 'dry, witty', 'utf8');
    await writeFile(path.join(dir, 'AGENTS.md'), 'Always cite sources.', 'utf8');

    const result = await inlineSidecars(emptyDoc(), dir, 'openclaw');

    expect(result.schema.defaults.personality).toBe('You are a helpful assistant.');
    expect(result.schema.defaults.vibe).toBe('dry, witty');
    expect(result.schema.defaults.settings?.extra_instructions).toBe('Always cite sources.');
    expect(result.applied.map((a) => a.filename).sort()).toEqual([
      'AGENTS.md',
      'IDENTITY.md',
      'SOUL.md',
    ]);
    expect(result.missing).toEqual([]);
  });

  it('reports missing sidecars and leaves their fields untouched', async () => {
    await writeFile(path.join(dir, 'SOUL.md'), 'just a soul', 'utf8');
    const result = await inlineSidecars(emptyDoc(), dir, 'openclaw');

    expect(result.schema.defaults.personality).toBe('just a soul');
    expect(result.schema.defaults.vibe).toBeUndefined();
    expect(result.schema.defaults.settings).toBeUndefined();
    expect(result.missing.sort()).toEqual(['AGENTS.md', 'IDENTITY.md']);
  });

  it('treats whitespace-only sidecars as missing', async () => {
    await writeFile(path.join(dir, 'SOUL.md'), '   \n\t\n', 'utf8');
    const result = await inlineSidecars(emptyDoc(), dir, 'openclaw');

    expect(result.schema.defaults.personality).toBeUndefined();
    expect(result.missing).toContain('SOUL.md');
  });

  it('preserves existing defaults that are not overridden by a sidecar', async () => {
    const doc = emptyDoc();
    doc.defaults.channels = ['telegram'];
    doc.defaults.settings = { model: 'anthropic/claude-sonnet-4.6' };

    const result = await inlineSidecars(doc, dir, 'openclaw');

    expect(result.schema.defaults.channels).toEqual(['telegram']);
    expect(result.schema.defaults.settings?.model).toBe('anthropic/claude-sonnet-4.6');
  });

  it('does not mutate the input schema', async () => {
    await writeFile(path.join(dir, 'SOUL.md'), 'hi', 'utf8');
    const doc = emptyDoc();
    await inlineSidecars(doc, dir, 'openclaw');
    expect(doc.defaults.personality).toBeUndefined();
  });

  it('writes nested dot-paths into defaults.settings', async () => {
    await writeFile(path.join(dir, 'AGENTS.md'), 'be precise', 'utf8');
    const result = await inlineSidecars(emptyDoc(), dir, 'openclaw');
    expect(result.schema.defaults.settings).toEqual({ extra_instructions: 'be precise' });
  });
});

describe('copyWorkspaceSidecars', () => {
  let workspace: string;
  let scaffold: string;
  beforeEach(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), 'graft-ws-'));
    scaffold = await mkdtemp(path.join(tmpdir(), 'graft-scaffold-'));
  });
  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
    await rm(scaffold, { recursive: true, force: true });
  });

  it('copies present files and reports missing ones', async () => {
    await writeFile(path.join(workspace, 'SOUL.md'), 'soul', 'utf8');
    await writeFile(path.join(workspace, 'IDENTITY.md'), 'id', 'utf8');
    // AGENTS.md missing on purpose

    const result = await copyWorkspaceSidecars(workspace, scaffold, 'openclaw');

    expect(result.copied.sort()).toEqual(['IDENTITY.md', 'SOUL.md']);
    expect(result.missingInWorkspace).toEqual(['AGENTS.md']);
  });
});

describe('sidecarFilenamesFor', () => {
  it('returns the openclaw sidecar list', () => {
    expect(sidecarFilenamesFor('openclaw').sort()).toEqual([
      'AGENTS.md',
      'IDENTITY.md',
      'SOUL.md',
    ]);
  });
});

describe('copyWorkspaceSkills', () => {
  let workspace: string;
  let scaffold: string;
  beforeEach(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), 'graft-skills-ws-'));
    scaffold = await mkdtemp(path.join(tmpdir(), 'graft-skills-scaffold-'));
  });
  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
    await rm(scaffold, { recursive: true, force: true });
  });

  it('returns empty when the workspace has no skills and no TOOLS.md', async () => {
    const result = await copyWorkspaceSkills(workspace, scaffold);
    expect(result).toEqual({ skills: [], tools: false, installScript: false });
  });

  it('copies skills from <workspace>/skills into <scaffold>/skills', async () => {
    const src = path.join(workspace, 'skills', 'demo');
    await mkdir(src, { recursive: true });
    await writeFile(path.join(src, 'SKILL.md'), '---\nname: demo\ndescription: x\n---\n# demo', 'utf8');
    await writeFile(path.join(src, 'helper.txt'), 'aux', 'utf8');

    const result = await copyWorkspaceSkills(workspace, scaffold);

    expect(result.skills).toEqual(['demo']);
    const { readFile } = await import('node:fs/promises');
    expect(await readFile(path.join(scaffold, 'skills', 'demo', 'SKILL.md'), 'utf8')).toContain('# demo');
    expect(await readFile(path.join(scaffold, 'skills', 'demo', 'helper.txt'), 'utf8')).toBe('aux');
  });

  it('flattens skills from .agents/skills under <scaffold>/skills', async () => {
    const src = path.join(workspace, '.agents', 'skills', 'shared');
    await mkdir(src, { recursive: true });
    await writeFile(path.join(src, 'SKILL.md'), '---\nname: shared\ndescription: y\n---\n# shared', 'utf8');

    const result = await copyWorkspaceSkills(workspace, scaffold);

    expect(result.skills).toEqual(['shared']);
    const { readFile } = await import('node:fs/promises');
    expect(await readFile(path.join(scaffold, 'skills', 'shared', 'SKILL.md'), 'utf8')).toContain('# shared');
  });

  it('copies TOOLS.md when present', async () => {
    await writeFile(path.join(workspace, 'TOOLS.md'), 'tools', 'utf8');
    const result = await copyWorkspaceSkills(workspace, scaffold);
    expect(result.tools).toBe(true);
    const { readFile } = await import('node:fs/promises');
    expect(await readFile(path.join(scaffold, 'TOOLS.md'), 'utf8')).toBe('tools');
  });

  it('copies install.sh when present', async () => {
    await writeFile(path.join(workspace, 'install.sh'), '#!/bin/sh\nexit 0\n', 'utf8');
    const result = await copyWorkspaceSkills(workspace, scaffold);
    expect(result.installScript).toBe(true);
    const { readFile } = await import('node:fs/promises');
    expect(await readFile(path.join(scaffold, 'install.sh'), 'utf8')).toContain('exit 0');
  });

  it('reports installScript=false when the workspace has no install.sh', async () => {
    const result = await copyWorkspaceSkills(workspace, scaffold);
    expect(result.installScript).toBe(false);
  });
});