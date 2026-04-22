import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  readOpenclawWorkspace,
  WorkspaceNotFoundError,
  InvalidOpenclawConfigError,
} from '../workspace.js';

// Spin up a real temporary directory per test rather than mocking `fs`.
// The reader's whole job is to interact with the filesystem, so a real
// fixture is the most faithful test we can write.
async function makeTempWorkspace(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'graft-cli-ws-'));
}

async function writeOpenclawConfig(workspace: string, body: string): Promise<void> {
  const dir = path.join(workspace, '.openclaw');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'openclaw.json'), body, 'utf8');
}

describe('readOpenclawWorkspace', () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = await makeTempWorkspace();
  });

  afterEach(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });

  it('reads config and every known markdown file when present', async () => {
    await writeOpenclawConfig(workspace, JSON.stringify({ version: '1.0', agents: { defaults: {} } }));
    await fs.writeFile(path.join(workspace, 'SOUL.md'), '# soul', 'utf8');
    await fs.writeFile(path.join(workspace, 'AGENTS.md'), '# agents', 'utf8');
    await fs.writeFile(path.join(workspace, 'USER.md'), '# user', 'utf8');
    await fs.writeFile(path.join(workspace, 'IDENTITY.md'), '# identity', 'utf8');
    await fs.writeFile(path.join(workspace, 'TOOLS.md'), '# tools', 'utf8');
    await fs.writeFile(path.join(workspace, 'HEARTBEAT.md'), '# heartbeat', 'utf8');
    await fs.writeFile(path.join(workspace, 'MEMORY.md'), '# memory', 'utf8');

    const ws = await readOpenclawWorkspace(workspace);

    expect(ws.workspacePath).toBe(path.resolve(workspace));
    expect(ws.configPath).toBe(path.join(path.resolve(workspace), '.openclaw', 'openclaw.json'));
    expect(ws.config).toEqual({ version: '1.0', agents: { defaults: {} } });
    expect(ws.markdown).toEqual({
      soul: '# soul',
      agents: '# agents',
      user: '# user',
      identity: '# identity',
      tools: '# tools',
      heartbeat: '# heartbeat',
      memory: '# memory',
    });
  });

  it('omits markdown files that are not present', async () => {
    await writeOpenclawConfig(workspace, '{}');
    await fs.writeFile(path.join(workspace, 'SOUL.md'), '# only soul', 'utf8');

    const ws = await readOpenclawWorkspace(workspace);

    expect(ws.markdown).toEqual({ soul: '# only soul' });
  });

  it('throws WorkspaceNotFoundError when the path does not exist', async () => {
    await expect(
      readOpenclawWorkspace(path.join(workspace, 'does-not-exist')),
    ).rejects.toBeInstanceOf(WorkspaceNotFoundError);
  });

  it('throws WorkspaceNotFoundError when the path is a file, not a directory', async () => {
    const file = path.join(workspace, 'a-file');
    await fs.writeFile(file, 'hello', 'utf8');

    await expect(readOpenclawWorkspace(file)).rejects.toBeInstanceOf(WorkspaceNotFoundError);
  });

  it('throws WorkspaceNotFoundError when openclaw.json is missing', async () => {
    // Workspace exists, but no .openclaw/openclaw.json
    await expect(readOpenclawWorkspace(workspace)).rejects.toBeInstanceOf(WorkspaceNotFoundError);
  });

  it('throws InvalidOpenclawConfigError when openclaw.json has invalid JSON', async () => {
    await writeOpenclawConfig(workspace, '{ this is not json');

    await expect(readOpenclawWorkspace(workspace)).rejects.toBeInstanceOf(InvalidOpenclawConfigError);
  });
});
