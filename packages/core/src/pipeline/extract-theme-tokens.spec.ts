import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ToolDescriptor, Transcript } from '@docstube/contracts';
import { idPrefixes, mintId, transcriptSchema } from '@docstube/contracts';
import { buildExtractThemeTokensTask, tokensFromTranscript } from './extract-theme-tokens.ts';

const readTools: ToolDescriptor[] = [
  { name: 'read_file', description: 'Read a file', paramsJsonSchema: { type: 'object' } }
];

const structuredTranscript = (value: unknown): Transcript =>
  transcriptSchema.parse({
    schemaVersion: 1,
    taskId: mintId(idPrefixes.task),
    cacheKey: 'test',
    transport: 'replay',
    model: 'replay',
    turns: [],
    usage: {},
    stopReason: 'complete',
    result: { type: 'structured', value }
  });

describe('buildExtractThemeTokensTask', () => {
  it('builds a read-tool task that names detected candidate files', async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), 'docstube-theme-extract-'));
    await writeFile(join(repoRoot, 'tailwind.config.ts'), 'export default { theme: {} };', 'utf8');
    const task = await buildExtractThemeTokensTask({ repoRoot, toolDescriptors: readTools });
    expect(task.kind).toBe('extract-theme-tokens');
    expect(task.output.type).toBe('structured');
    expect(task.tools).toEqual(readTools);
    expect(task.userPrompt).toContain('tailwind.config.ts');
    // The token vocabulary is spelled out for the model.
    expect(task.systemPrompt).toContain('accent-strong');
    expect(task.systemPrompt).toContain('font-family');
    expect(task.workspace.writableRoots).toEqual([]);
  });

  it('falls back to a search instruction when no candidates exist', async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), 'docstube-theme-empty-'));
    const task = await buildExtractThemeTokensTask({ repoRoot, toolDescriptors: readTools });
    expect(task.userPrompt).toContain('No obvious token files');
  });
});

describe('tokensFromTranscript', () => {
  it('keeps known token names and drops unknown ones with a warning', () => {
    const result = tokensFromTranscript(
      structuredTranscript({
        tokens: { accent: '#0f766e', 'font-family': 'Inter, sans-serif', 'brand-sparkle': '#ff00ff' },
        notes: 'from tailwind.config.ts'
      })
    );
    expect(result.tokens).toEqual({ accent: '#0f766e', 'font-family': 'Inter, sans-serif' });
    expect(result.notes).toBe('from tailwind.config.ts');
    expect(result.warnings[0]).toMatch(/brand-sparkle/);
  });

  it('returns empty tokens with a warning on an invalid payload', () => {
    const result = tokensFromTranscript(structuredTranscript({ tokens: { accent: 42 } }));
    expect(result.tokens).toEqual({});
    expect(result.warnings[0]).toMatch(/no valid tokens/);
  });

  it('returns empty tokens with a warning when the task failed', () => {
    const failed = transcriptSchema.parse({
      schemaVersion: 1,
      taskId: mintId(idPrefixes.task),
      cacheKey: 'test',
      transport: 'replay',
      model: 'replay',
      turns: [],
      usage: {},
      stopReason: 'max-turns'
    });
    const result = tokensFromTranscript(failed);
    expect(result.tokens).toEqual({});
    expect(result.warnings[0]).toMatch(/stop: max-turns/);
  });
});
