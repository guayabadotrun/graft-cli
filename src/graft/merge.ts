// Merge interactive decisions into a baseline GRAFT document.
//
// Kept as a small, pure helper so `cli.ts` doesn't grow merge logic and
// tests can verify the final shape directly without going through prompts.

import type { GraftDocument } from './build.js';
import type { MarkdownDecisions } from '../prompts/markdown.js';

export function mergeDecisionsIntoGraft(
  doc: GraftDocument,
  decisions: MarkdownDecisions,
): GraftDocument {
  const next: GraftDocument = {
    schema_version: doc.schema_version,
    framework_constraints: [...doc.framework_constraints],
    defaults: {
      ...doc.defaults,
      ...(doc.defaults.channels ? { channels: [...doc.defaults.channels] } : {}),
      ...(doc.defaults.settings ? { settings: { ...doc.defaults.settings } } : {}),
    },
    fields: doc.fields.map((f) => ({ ...f })),
  };

  if (decisions.bio && decisions.bio.length > 0) {
    next.defaults.bio = [...decisions.bio];
  }
  if (decisions.knowledge && decisions.knowledge.length > 0) {
    next.defaults.knowledge = [...decisions.knowledge];
  }
  if (decisions.extra_instructions !== undefined) {
    const settings = next.defaults.settings ?? {};
    next.defaults.settings = { ...settings, extra_instructions: decisions.extra_instructions };
  }

  return next;
}
