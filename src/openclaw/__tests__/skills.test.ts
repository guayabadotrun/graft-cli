import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import {
  parseSkillFrontmatter,
  listInstalledSkills,
  resolveSkillDir,
  tarSkillBundle,
  buildSkillManifest,
} from '../skills.js';

async function makeTempWorkspace(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'graft-cli-skills-'));
}

async function writeSkill(
  workspace: string,
  root: 'skills' | '.agents/skills',
  name: string,
  frontmatter: string,
  body: string = 'body',
): Promise<string> {
  const dir = path.join(workspace, root, name);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'SKILL.md'), `${frontmatter}\n${body}`, 'utf8');
  return dir;
}

describe('parseSkillFrontmatter', () => {
  it('parses minimal frontmatter (name + description required)', () => {
    const r = parseSkillFrontmatter(`---\nname: hello\ndescription: hi\n---\nbody`);
    expect(r).toEqual({ name: 'hello', description: 'hi' });
  });

  it('parses metadata as inline JSON', () => {
    const r = parseSkillFrontmatter(
      `---\nname: gemini\ndescription: gem cli\nmetadata: {"openclaw":{"emoji":"♊️","requires":{"bins":["gemini"]}}}\n---`,
    );
    expect(r?.name).toBe('gemini');
    expect((r?.metadata as { openclaw: { emoji: string } }).openclaw.emoji).toBe('♊️');
  });

  it('handles quoted strings, booleans', () => {
    const r = parseSkillFrontmatter(
      `---\nname: img_lab\ndescription: 'image work'\nuser-invocable: false\n---`,
    );
    expect(r?.name).toBe('img_lab');
    expect(r?.description).toBe('image work');
    expect(r?.['user-invocable']).toBe(false);
  });

  it('returns null when no frontmatter is present', () => {
    expect(parseSkillFrontmatter('# just markdown')).toBeNull();
  });

  it('handles CRLF line endings', () => {
    const r = parseSkillFrontmatter('---\r\nname: crlf\r\ndescription: x\r\n---\r\nbody');
    expect(r?.name).toBe('crlf');
  });

  it('throws on missing closing delimiter', () => {
    expect(() => parseSkillFrontmatter('---\nname: x\ndescription: y')).toThrow(/closing/);
  });

  it('throws when name field is missing', () => {
    expect(() => parseSkillFrontmatter('---\ndescription: x\n---')).toThrow(/name/);
  });

  it('throws when description field is missing', () => {
    expect(() => parseSkillFrontmatter('---\nname: x\n---')).toThrow(/description/);
  });

  it('throws on unknown top-level key', () => {
    expect(() =>
      parseSkillFrontmatter('---\nname: x\ndescription: y\nrandom: nope\n---'),
    ).toThrow(/unknown key/);
  });

  it('throws on multi-line YAML block (single-line constraint)', () => {
    // OpenClaw upstream parser only accepts single-line keys; we mirror that.
    expect(() =>
      parseSkillFrontmatter('---\nname: x\ndescription: |\n  multi\n  line\n---'),
    ).toThrow(/single-line/);
  });
});

describe('listInstalledSkills', () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = await makeTempWorkspace();
  });

  afterEach(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });

  it('returns empty when neither root exists', async () => {
    const r = await listInstalledSkills(workspace);
    expect(r.skills).toEqual([]);
    expect(r.errors).toEqual([]);
  });

  it('discovers skills under both roots', async () => {
    await writeSkill(workspace, 'skills', 'one', '---\nname: one\ndescription: x\n---');
    await writeSkill(workspace, '.agents/skills', 'two', '---\nname: two\ndescription: y\n---');
    const r = await listInstalledSkills(workspace);
    expect(r.skills.map((s) => s.name).sort()).toEqual(['one', 'two']);
    expect(r.errors).toEqual([]);
  });

  it('gives precedence to <workspace>/skills on name collision', async () => {
    await writeSkill(workspace, 'skills', 'dup', '---\nname: dup\ndescription: high\n---');
    await writeSkill(workspace, '.agents/skills', 'dup', '---\nname: dup\ndescription: low\n---');
    const r = await listInstalledSkills(workspace);
    expect(r.skills).toHaveLength(1);
    expect(r.skills[0]!.root).toBe('skills');
    expect(r.skills[0]!.description).toBe('high');
    // The dropped duplicate is surfaced for the launcher to log.
    expect(r.duplicates).toEqual([
      { name: 'dup', winner: 'skills', loser: '.agents/skills' },
    ]);
  });

  it('captures parse failures as non-fatal errors', async () => {
    await writeSkill(workspace, 'skills', 'good', '---\nname: good\ndescription: ok\n---');
    const badDir = path.join(workspace, 'skills', 'bad');
    await fs.mkdir(badDir, { recursive: true });
    await fs.writeFile(path.join(badDir, 'SKILL.md'), 'no frontmatter here', 'utf8');

    const r = await listInstalledSkills(workspace);
    expect(r.skills.map((s) => s.name)).toEqual(['good']);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]!.path).toBe(badDir);
  });

  it('skips dotfiles and non-directories', async () => {
    await writeSkill(workspace, 'skills', 'real', '---\nname: real\ndescription: y\n---');
    await fs.mkdir(path.join(workspace, 'skills', '.hidden'), { recursive: true });
    await fs.writeFile(path.join(workspace, 'skills', 'README'), 'not a skill', 'utf8');
    const r = await listInstalledSkills(workspace);
    expect(r.skills.map((s) => s.name)).toEqual(['real']);
    expect(r.errors).toEqual([]);
  });

  it('exposes emoji from metadata.openclaw.emoji', async () => {
    await writeSkill(
      workspace,
      'skills',
      'gem',
      `---\nname: gem\ndescription: gem cli\nmetadata: {"openclaw":{"emoji":"♊️"}}\n---`,
    );
    const r = await listInstalledSkills(workspace);
    expect(r.skills[0]!.emoji).toBe('♊️');
  });

  it('discovers grouped skills at <root>/<source>/<name>/SKILL.md (clawhub layout)', async () => {
    // Simulate `openclaw skills install github` which lays out the
    // skill under `skills/<source>/<name>/SKILL.md` (the outer dir is
    // the source/namespace, e.g. `github`, the inner one is the actual
    // skill, also named `github`).
    const dir = path.join(workspace, 'skills', 'github', 'github');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, 'SKILL.md'),
      '---\nname: github\ndescription: gh cli wrapper\n---\nbody',
      'utf8',
    );
    const r = await listInstalledSkills(workspace);
    expect(r.skills.map((s) => s.name)).toEqual(['github']);
    expect(r.skills[0]!.path).toBe(dir);
    expect(r.errors).toEqual([]);
  });

  it('mixes flat and grouped layouts under the same root', async () => {
    await writeSkill(workspace, 'skills', 'flat', '---\nname: flat\ndescription: f\n---');
    const grouped = path.join(workspace, 'skills', 'group', 'nested');
    await fs.mkdir(grouped, { recursive: true });
    await fs.writeFile(
      path.join(grouped, 'SKILL.md'),
      '---\nname: nested\ndescription: n\n---',
      'utf8',
    );
    const r = await listInstalledSkills(workspace);
    expect(r.skills.map((s) => s.name).sort()).toEqual(['flat', 'nested']);
  });
});

describe('resolveSkillDir', () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = await makeTempWorkspace();
  });

  afterEach(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });

  it('finds a skill in the high-precedence root', async () => {
    const dir = await writeSkill(workspace, 'skills', 'foo', '---\nname: foo\n---');
    const r = await resolveSkillDir(workspace, 'foo');
    expect(r.dir).toBe(dir);
    expect(r.root).toBe('skills');
  });

  it('falls back to .agents/skills', async () => {
    const dir = await writeSkill(workspace, '.agents/skills', 'bar', '---\nname: bar\n---');
    const r = await resolveSkillDir(workspace, 'bar');
    expect(r.dir).toBe(dir);
    expect(r.root).toBe('.agents/skills');
  });

  it('rejects path-traversal names', async () => {
    await expect(resolveSkillDir(workspace, '../etc')).rejects.toMatchObject({ code: 'EINVAL' });
    await expect(resolveSkillDir(workspace, 'foo/bar')).rejects.toMatchObject({ code: 'EINVAL' });
  });

  it('throws ENOENT when missing', async () => {
    await expect(resolveSkillDir(workspace, 'nope')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not match a directory without SKILL.md', async () => {
    await fs.mkdir(path.join(workspace, 'skills', 'naked'), { recursive: true });
    await expect(resolveSkillDir(workspace, 'naked')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('resolves grouped skills at <root>/<source>/<name>/SKILL.md (clawhub layout)', async () => {
    const dir = path.join(workspace, 'skills', 'github', 'github');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, 'SKILL.md'),
      '---\nname: github\ndescription: gh\n---',
      'utf8',
    );
    const r = await resolveSkillDir(workspace, 'github');
    expect(r.dir).toBe(dir);
    expect(r.root).toBe('skills');
  });
});

describe('tarSkillBundle', () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = await makeTempWorkspace();
  });

  afterEach(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });

  it('produces a tar.gz that re-extracts to the same files', async () => {
    const skillDir = await writeSkill(
      workspace,
      'skills',
      'pack',
      '---\nname: pack\ndescription: x\n---',
      'README content',
    );
    await fs.writeFile(path.join(skillDir, 'extra.txt'), 'extra', 'utf8');

    const { stream, done } = tarSkillBundle(skillDir);

    // Capture stdout as a buffer.
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    await done;
    const tarball = Buffer.concat(chunks);
    expect(tarball.length).toBeGreaterThan(20);
    // gzip magic bytes
    expect(tarball[0]).toBe(0x1f);
    expect(tarball[1]).toBe(0x8b);

    // Extract into a fresh dir and verify contents.
    const out = await fs.mkdtemp(path.join(os.tmpdir(), 'graft-cli-extract-'));
    try {
      await new Promise<void>((resolveExtract, rejectExtract) => {
        const tar = spawn('tar', ['-xzf', '-', '-C', out]);
        tar.on('error', rejectExtract);
        tar.on('close', (code) =>
          code === 0 ? resolveExtract() : rejectExtract(new Error(`extract code=${code}`)),
        );
        tar.stdin.write(tarball);
        tar.stdin.end();
      });

      const skillMd = await fs.readFile(path.join(out, 'pack', 'SKILL.md'), 'utf8');
      expect(skillMd).toContain('name: pack');
      const extra = await fs.readFile(path.join(out, 'pack', 'extra.txt'), 'utf8');
      expect(extra).toBe('extra');
    } finally {
      await fs.rm(out, { recursive: true, force: true });
    }
  });

  it('rejects when tar fails (missing source)', async () => {
    const { stream, done } = tarSkillBundle(path.join(workspace, 'does-not-exist'));
    // Drain stdout so the child process can finish.
    for await (const _ of stream) { /* drain */ }
    await expect(done).rejects.toThrow(/tar exited/);
  });
});

describe('buildSkillManifest', () => {
  it('produces a minimal manifest from name + description', () => {
    const m = buildSkillManifest({
      name: 'minimal',
      path: '/x',
      root: 'skills',
      manifest: { name: 'minimal', description: 'just a skill' },
    });
    expect(m).toEqual({ name: 'minimal', description: 'just a skill' });
  });

  it('hoists emoji, requires, primary_env, install from metadata.openclaw', () => {
    const m = buildSkillManifest({
      name: 'gem',
      path: '/x',
      root: 'skills',
      emoji: '♊',
      manifest: {
        name: 'gem',
        description: 'gemini wrapper',
        homepage: 'https://example.com',
        metadata: {
          openclaw: {
            emoji: '♊',
            requires: { bins: ['gemini'] },
            primaryEnv: 'GEMINI_API_KEY',
            install: { brew: 'gemini-cli' },
          },
        },
      },
    });
    expect(m).toMatchObject({
      name: 'gem',
      description: 'gemini wrapper',
      emoji: '♊',
      homepage: 'https://example.com',
      requires: { bins: ['gemini'] },
      primary_env: 'GEMINI_API_KEY',
      install: { brew: 'gemini-cli' },
    });
  });

  it('omits optional keys that are absent rather than emitting null', () => {
    const m = buildSkillManifest({
      name: 'lean',
      path: '/x',
      root: 'skills',
      manifest: { name: 'lean', description: 'd' },
    });
    expect(m).not.toHaveProperty('emoji');
    expect(m).not.toHaveProperty('homepage');
    expect(m).not.toHaveProperty('requires');
    expect(m).not.toHaveProperty('install');
    expect(m).not.toHaveProperty('primary_env');
  });
});
