// Smoke tests for the CLI entry point. We don't shell out to the built
// binary — instead we import the same `VERSION` constant the CLI exposes
// and verify the surface contract. Real command behaviour gets covered
// once the commands actually do something.

import { describe, it, expect } from 'vitest';
import { VERSION } from '../index.js';

describe('@guayaba/graft-cli surface', () => {
  it('exposes a semver-shaped VERSION string', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});
