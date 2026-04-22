// OpenClaw → universal-language extractor.
//
// Reads an already-loaded OpenclawWorkspace and pulls out only the
// fields we can infer *unambiguously* from the on-disk config:
//   - agent identity (id, name) from `agents.list[0]`
//   - model + thinking from `agents.defaults`
//   - active channels from `channels.*`
//
// Notably we DO NOT try to derive `bio` / `knowledge` /
// `extra_instructions` from SOUL.md or MEMORY.md. Those files are
// "agent-managed": the launcher seeds them from backend fields once,
// after which the agent edits them every session. Treating them as
// template state would mix up curated config with runtime evolution.
// The interactive `init` step (next iteration) will surface
// `rawMarkdown` to the user and let *them* decide what (if anything)
// becomes part of the GRAFT.

import type { OpenclawWorkspace, WorkspaceMarkdown } from './workspace.js';

export type ThinkingLevel = 'off' | 'low' | 'medium' | 'high';

export interface OpenclawAgentSummary {
  framework: 'openclaw';
  agent: {
    id?: string;
    name?: string;
  };
  /**
   * Universal-language fields as defined by the GRAFT schema v2
   * "ubiquitous language" (gene-seed §1.1). Present only when the
   * underlying config actually carries them — never guessed.
   */
  universal: {
    /** Model id without the provider prefix, e.g. `anthropic/claude-sonnet-4.6`. */
    model?: string;
    thinking?: ThinkingLevel;
    /** Channel slugs detected in `openclaw.json` `channels.*`. */
    channels: string[];
    /**
     * Skill slugs declared in `agents.defaults.skills`. Today our
     * launcher does not write this field, so the array will almost
     * always be empty — we still read it defensively for forward
     * compatibility.
     */
    skills: string[];
  };
  /**
   * Verbatim markdown contents from the workspace. Passed through so
   * the prompts layer can show snippets and ask the user what to do
   * with them. Not interpreted here.
   */
  rawMarkdown: WorkspaceMarkdown;
}

const THINKING_LEVELS: ReadonlySet<string> = new Set(['off', 'low', 'medium', 'high']);

/** Narrow `unknown` to a record without forcing the caller to assert. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.length > 0);
}

/**
 * Strip a leading `<provider>/` segment from a model id.
 * E.g. `openrouter/anthropic/claude-sonnet-4.6` → `anthropic/claude-sonnet-4.6`.
 * If the id has only one segment, returns it unchanged.
 */
function stripProviderPrefix(modelId: string): string {
  const slash = modelId.indexOf('/');
  if (slash <= 0) return modelId;
  // Keep both segments when the id is already in `<vendor>/<model>` form
  // (no provider prefix). Heuristic: providers we generate are a single
  // word with no dots; everything else is treated as already-clean.
  const head = modelId.slice(0, slash);
  const knownProviders = new Set(['openrouter', 'openai', 'anthropic-direct', 'google-direct']);
  if (knownProviders.has(head)) {
    return modelId.slice(slash + 1);
  }
  return modelId;
}

export function extractOpenclawSummary(workspace: OpenclawWorkspace): OpenclawAgentSummary {
  const config = asRecord(workspace.config) ?? {};
  const agentsBlock = asRecord(config.agents) ?? {};
  const defaults = asRecord(agentsBlock.defaults) ?? {};
  const list = Array.isArray(agentsBlock.list) ? agentsBlock.list : [];
  const first = asRecord(list[0]) ?? {};

  const agentId = asString(first.id);
  const agentName = asString(first.name);

  const modelBlock = asRecord(defaults.model);
  const rawModel = asString(modelBlock?.primary);
  const model = rawModel ? stripProviderPrefix(rawModel) : undefined;

  const rawThinking = asString(defaults.thinkingDefault);
  const thinking: ThinkingLevel | undefined =
    rawThinking && THINKING_LEVELS.has(rawThinking) ? (rawThinking as ThinkingLevel) : undefined;

  const channelsBlock = asRecord(config.channels) ?? {};
  const channels = Object.keys(channelsBlock)
    // Defensive: only count entries whose value is an object (a real
    // channel config), not stray nulls or booleans.
    .filter((slug) => asRecord(channelsBlock[slug]))
    .sort();

  const skills = asStringArray(defaults.skills);

  return {
    framework: 'openclaw',
    agent: {
      ...(agentId !== undefined ? { id: agentId } : {}),
      ...(agentName !== undefined ? { name: agentName } : {}),
    },
    universal: {
      ...(model !== undefined ? { model } : {}),
      ...(thinking !== undefined ? { thinking } : {}),
      channels,
      skills,
    },
    rawMarkdown: workspace.markdown,
  };
}
