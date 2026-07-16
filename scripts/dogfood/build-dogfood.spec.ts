import { rm } from 'node:fs/promises';
import { afterAll, describe, expect, it } from 'vitest';
import { buildDogfood } from './build-dogfood.ts';

const outputDir = 'dist-dogfood-test';

afterAll(async () => {
  await rm(outputDir, { recursive: true, force: true });
});

describe('dogfood build', () => {
  it('generates verified docs for the contracts package through the real pipeline', async () => {
    const { summary } = await buildDogfood({ outputDir });
    expect(summary.outcome).toBe('passed');
    expect(summary.pages).toHaveLength(2);
    expect(summary.pages.every((page) => page.status === 'passed')).toBe(true);
  }, 120_000);
});
