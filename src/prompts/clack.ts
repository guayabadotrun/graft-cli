// @clack/prompts adapter for the `Prompter` interface.
//
// Kept thin on purpose: any logic worth testing lives in
// `prompts/markdown.ts`. This file is just the wire-up to clack and is
// exercised end-to-end via the CLI smoke path, not via unit tests.

import { isCancel, select, text, log } from '@clack/prompts';
import type {
  MarkdownDecision,
  MarkdownPromptInput,
  MetadataResult,
  Prompter,
} from './types.js';
import type { GraftMetadata } from '../graft/package.js';
import { KNOWN_CATEGORY_SLUGS } from '../graft/package.js';
import { parseTagsInput } from '../graft/metadata.js';

// Minimal "non-empty" guard for required free-text fields. Format checks
// (slug regex, semver, length caps) are the backend's job — see
// `graft init --validate <api-url>` and ValidateGraftRequest.
const requireNonEmpty = (label: string) => (value: string): string | undefined =>
  value.trim().length === 0 ? `${label} is required.` : undefined;

const FILE_LABELS: Record<string, string> = {
  soul: 'SOUL.md',
  memory: 'MEMORY.md',
  identity: 'IDENTITY.md',
};

const TARGET_LABELS: Record<string, string> = {
  bio: 'bio',
  knowledge: 'knowledge',
  extra_instructions: 'settings.extra_instructions',
};

export function createClackPrompter(): Prompter {
  return {
    async askIncludeMarkdown(input: MarkdownPromptInput): Promise<MarkdownDecision> {
      const fileLabel = FILE_LABELS[input.file] ?? `${input.file}.md`;
      const targetLabel = TARGET_LABELS[input.target] ?? input.target;

      log.info(`${fileLabel} (${input.lines} non-blank lines) preview:\n${input.preview}`);

      const choice = await select({
        message: `Include ${fileLabel} as ${targetLabel} in the GRAFT?`,
        options: [
          { value: 'skip', label: 'Skip — leave this field empty' },
          { value: 'include', label: 'Include — copy the file contents into the GRAFT' },
        ],
        initialValue: 'skip',
      });

      if (isCancel(choice)) return 'cancel';
      return choice as MarkdownDecision;
    },

    async askMetadata(defaults: GraftMetadata): Promise<MetadataResult> {
      const name = await text({
        message: 'GRAFT display name (max 150 chars).',
        initialValue: defaults.name,
        validate: requireNonEmpty('Name'),
      });
      if (isCancel(name)) return null;

      const slug = await text({
        message: 'Slug (kebab-case, max 100 chars). Used in marketplace URLs.',
        initialValue: defaults.slug,
        validate: requireNonEmpty('Slug'),
      });
      if (isCancel(slug)) return null;

      const shortDescription = await text({
        message: 'Short description (one-liner, max 255 chars). Leave blank to skip.',
        initialValue: defaults.short_description ?? '',
      });
      if (isCancel(shortDescription)) return null;

      const description = await text({
        message: 'Full description (markdown, multi-line not supported in CLI). Leave blank to skip.',
        initialValue: defaults.description ?? '',
      });
      if (isCancel(description)) return null;

      const version = await text({
        message: 'Version (semver).',
        initialValue: defaults.version,
        validate: requireNonEmpty('Version'),
      });
      if (isCancel(version)) return null;

      const tagsRaw = await text({
        message: 'Tags (comma-separated). Leave blank to skip.',
        initialValue: defaults.tags.join(', '),
      });
      if (isCancel(tagsRaw)) return null;

      const categoriesRaw = await text({
        message: `Categories (comma-separated). Known: ${KNOWN_CATEGORY_SLUGS.join(', ')}. Leave blank to skip.`,
        initialValue: defaults.category_slugs.join(', '),
      });
      if (isCancel(categoriesRaw)) return null;

      const authorName = await text({
        message: 'Author name (optional, public). Leave blank to skip.',
        initialValue: defaults.author_name ?? '',
      });
      if (isCancel(authorName)) return null;

      const trimmedShort = shortDescription.trim();
      const trimmedDescription = description.trim();
      const trimmedAuthor = authorName.trim();

      return {
        slug: slug.trim(),
        name: name.trim(),
        ...(trimmedShort.length > 0 ? { short_description: trimmedShort } : {}),
        ...(trimmedDescription.length > 0 ? { description: trimmedDescription } : {}),
        version: version.trim(),
        tags: parseTagsInput(tagsRaw),
        category_slugs: parseTagsInput(categoriesRaw),
        framework_slugs: [...defaults.framework_slugs],
        ...(trimmedAuthor.length > 0 ? { author_name: trimmedAuthor } : {}),
        tier: defaults.tier,
        price_credits: defaults.price_credits,
      };
    },
  };
}

