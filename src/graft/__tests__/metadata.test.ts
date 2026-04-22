import { describe, expect, it } from 'vitest';
import {
  defaultMetadataFor,
  parseTagsInput,
  slugify,
  validateName,
  validateShortDescription,
  validateSlug,
  validateVersion,
} from '../metadata.js';
import type { OpenclawAgentSummary } from '../../openclaw/extract.js';

function summary(name: string | undefined): OpenclawAgentSummary {
  return {
    framework: 'openclaw',
    agent: name === undefined ? {} : { id: 'agt_1', name },
    universal: { channels: [], skills: [] },
    rawMarkdown: {},
  };
}

describe('slugify', () => {
  it('lowercases and joins words with hyphens', () => {
    expect(slugify('Customer Support Pro')).toBe('customer-support-pro');
  });

  it('strips accents', () => {
    expect(slugify('Soporte Técnico')).toBe('soporte-tecnico');
  });

  it('collapses repeated separators and trims edge dashes', () => {
    expect(slugify('  Hello -- World  ')).toBe('hello-world');
  });

  it('drops non-alphanumeric characters', () => {
    expect(slugify("My Bot's Name!")).toBe('my-bot-s-name');
  });

  it('truncates to 100 characters', () => {
    const long = 'a'.repeat(150);
    expect(slugify(long)).toHaveLength(100);
  });
});

describe('validateSlug', () => {
  it.each([
    ['hello-world', undefined],
    ['agent-1', undefined],
    ['', 'Slug is required.'],
    ['Hello-World', expect.stringContaining('kebab-case')],
    ['hello_world', expect.stringContaining('kebab-case')],
    ['-leading', expect.stringContaining('kebab-case')],
    ['trailing-', expect.stringContaining('kebab-case')],
    ['double--dash', expect.stringContaining('kebab-case')],
    ['has space', expect.stringContaining('kebab-case')],
  ])('validateSlug(%j) -> %j', (input, expected) => {
    expect(validateSlug(input)).toEqual(expected);
  });

  it('rejects slugs longer than 100 chars', () => {
    expect(validateSlug('a'.repeat(101))).toMatch(/100/);
  });
});

describe('validateName', () => {
  it('rejects blank names', () => {
    expect(validateName('   ')).toMatch(/required/i);
  });
  it('accepts normal names', () => {
    expect(validateName('Customer Support Pro')).toBeUndefined();
  });
  it('rejects names longer than 150 chars', () => {
    expect(validateName('a'.repeat(151))).toMatch(/150/);
  });
});

describe('validateShortDescription', () => {
  it('accepts empty (it is optional)', () => {
    expect(validateShortDescription('')).toBeUndefined();
  });
  it('rejects strings longer than 255 chars', () => {
    expect(validateShortDescription('a'.repeat(256))).toMatch(/255/);
  });
});

describe('validateVersion', () => {
  it.each([
    ['0.1.0', undefined],
    ['1.0.0', undefined],
    ['1.2.3-beta.1', undefined],
    ['1.2.3+build.42', undefined],
    ['v1.0.0', expect.stringContaining('semver')],
    ['1.0', expect.stringContaining('semver')],
    ['', expect.stringContaining('semver')],
  ])('validateVersion(%j)', (input, expected) => {
    expect(validateVersion(input)).toEqual(expected);
  });
});

describe('parseTagsInput', () => {
  it('splits on commas and newlines, trims, lowercases', () => {
    expect(parseTagsInput(' Support, Telegram\n  AI ')).toEqual(['support', 'telegram', 'ai']);
  });
  it('returns an empty array on blank input', () => {
    expect(parseTagsInput('   ')).toEqual([]);
  });
  it('drops empty fragments produced by stray commas', () => {
    expect(parseTagsInput('a,,b,, ,c')).toEqual(['a', 'b', 'c']);
  });
});

describe('defaultMetadataFor', () => {
  it('seeds slug + name from the agent display name', () => {
    const meta = defaultMetadataFor(summary('Customer Support Pro'));
    expect(meta.slug).toBe('customer-support-pro');
    expect(meta.name).toBe('Customer Support Pro');
  });

  it('leaves slug + name empty when the agent has no name', () => {
    const meta = defaultMetadataFor(summary(undefined));
    expect(meta.slug).toBe('');
    expect(meta.name).toBe('');
  });

  it('defaults to version 0.1.0, free tier, zero price', () => {
    const meta = defaultMetadataFor(summary('Sam'));
    expect(meta.version).toBe('0.1.0');
    expect(meta.tier).toBe('free');
    expect(meta.price_credits).toBe(0);
  });

  it('records the framework slug from the summary in framework_slugs', () => {
    const meta = defaultMetadataFor(summary('Sam'));
    expect(meta.framework_slugs).toEqual(['openclaw']);
  });

  it('starts with empty tags and categories', () => {
    const meta = defaultMetadataFor(summary('Sam'));
    expect(meta.tags).toEqual([]);
    expect(meta.category_slugs).toEqual([]);
  });
});
