// Prompt-layer abstractions.
//
// The CLI is the only place that talks to a real TTY (via @clack/prompts).
// The interactive metadata prompt goes through `Prompter` so tests can
// inject deterministic answers without spawning interactive shells.

import type { GraftMetadata } from '../graft/package.js';

/**
 * Result of the metadata prompt. Implementations return `null` when
 * the user cancels (Ctrl-C / ESC) so the caller can stop early.
 */
export type MetadataResult = GraftMetadata | null;

export interface Prompter {
  /**
   * Ask the user for the marketplace metadata block. The `defaults`
   * argument is a fully-formed metadata object with sensible suggestions
   * derived from the agent (slug from the name, version 0.1.0, etc.) —
   * implementations should pre-fill each prompt with these values.
   */
  askMetadata(defaults: GraftMetadata): Promise<MetadataResult>;
}
