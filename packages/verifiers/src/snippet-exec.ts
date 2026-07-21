import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';
import type { Finding } from '@docstube/contracts';
import type { PageArtifact, VerifierContext, VerifierDefinition } from '@docstube/plugin-sdk';
import { mapFencesByHash } from './code-typecheck-ts.ts';
import type { MdxCodeBlock } from './code-typecheck-ts.ts';
import { matchingCodeBlocks, missingFenceFinding, runVerifier } from './run-support.ts';

const verifierId = 'snippet-exec';

const matchedLanguages = ['bash', 'sh', 'js', 'javascript', 'ts', 'typescript'];
const bashLanguages = new Set(['bash', 'sh']);
const tsLanguages = new Set(['ts', 'typescript']);

const executionTimeoutMs = 15_000;
const stderrTailLineCount = 10;

// Fences opting out of execution (`no-exec` in the fence meta): illustrative fragments,
// destructive commands, snippets needing credentials or a running service.
const hasNoExecMeta = (fence: MdxCodeBlock): boolean => /(^|\s)no-exec(\s|$)/u.test(fence.meta);

// Fences opting back into full host-environment inheritance (`allow-env` in the fence meta):
// samples that legitimately read configuration from the environment.
const hasAllowEnvMeta = (fence: MdxCodeBlock): boolean => /(^|\s)allow-env(\s|$)/u.test(fence.meta);

// Snippets run with a scrubbed environment by default: PATH plus the platform essentials and
// nothing else, so API keys and tokens in the host env cannot leak into documentation samples.
const minimalSnippetEnv = (): Record<string, string> => {
  const keys =
    process.platform === 'win32' ? ['PATH', 'SYSTEMROOT', 'SYSTEMDRIVE', 'COMSPEC', 'TEMP', 'TMP'] : ['PATH', 'HOME'];
  const env: Record<string, string> = {};
  for (const key of keys) {
    // process.env lookups are case-insensitive on win32 regardless of the stored casing.
    const value = process.env[key];
    if (value !== undefined) {
      env[key] = value;
    }
  }
  return env;
};

// Snippets legitimately import the documented package, which is not installed in the sandbox —
// the same reality code-typecheck-ts handles by skipping module-resolution diagnostics. A
// module-not-found failure means "unprovable here", never "wrong": the block is left uncovered
// (not proven) without a finding.
const isModuleNotFound = (stderr: string): boolean =>
  /ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND|Cannot find (?:package|module)/u.test(stderr);

// Same policy for bash: a sample invoking the documented CLI (`docstube …`) exits 127 in a
// sandbox where it is not installed. Missing binary means "unprovable here", never "wrong".
const isCommandNotFound = (exitCode: number, stderr: string): boolean =>
  exitCode === 127 || /command not found|not recognized as an internal or external command/iu.test(stderr);

const stderrTail = (stderr: string): string => {
  const lines = stderr
    .trimEnd()
    .split(/\r?\n/u)
    .filter((line) => line !== '');
  const tail = lines.slice(-stderrTailLineCount);
  return (lines.length > stderrTailLineCount ? ['…', ...tail] : tail).join('\n');
};

// Sandbox limits, honestly: each snippet runs in a fresh temp directory so it cannot litter the
// repo, with a hard timeout, a scrubbed environment (unless the fence opts back in with
// `allow-env`), and only through ctx.exec (restricted to the plugin's declared permissions.exec:
// bash/node). The child still has full network access — TODO: network isolation is a separate
// research track and is not attempted here.
const runSnippet = async (
  ctx: VerifierContext,
  language: string,
  code: string,
  cwd: string,
  allowEnv: boolean
): Promise<{ exitCode: number; stderr: string }> => {
  const envOption = allowEnv ? {} : { env: minimalSnippetEnv() };
  if (bashLanguages.has(language)) {
    return ctx.exec('bash', ['-euo', 'pipefail', '-c', code], { cwd, timeoutMs: executionTimeoutMs, ...envOption });
  }
  const source = tsLanguages.has(language)
    ? ts.transpileModule(code, {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
      }).outputText
    : code;
  return ctx.exec('node', ['--input-type=module', '-e', source], {
    cwd,
    timeoutMs: executionTimeoutMs,
    ...envOption
  });
};

const executionFailureFinding = (
  artifact: PageArtifact,
  blockId: string,
  fence: MdxCodeBlock,
  detail: string
): Finding => ({
  source: 'verifier',
  check: verifierId,
  severity: 'error',
  message: `code sample failed to execute: ${detail}`,
  entity: { version: artifact.version, locale: artifact.locale, pageId: artifact.page.id, entityId: blockId },
  file: artifact.mdxPath,
  span: [fence.line, fence.line]
});

export const snippetExecVerifier: VerifierDefinition = {
  id: verifierId,
  title: 'Code samples execute',
  description:
    'Every runnable code sample must actually execute (doctest-style): bash/sh via `bash -euo pipefail`, js via `node -e`, ts transpiled then run. Compile-level checks prove syntax; execution proves the sample works. Fences marked `no-exec` are skipped.',
  scope: 'block',
  appliesTo: { blockTypes: ['code-example'], languages: matchedLanguages },
  localeScope: 'source-only',
  proves: true,
  verify: async (ctx, pages) => {
    // Bash availability is probed once per run (covers Windows hosts without bash and minimal
    // containers); bash blocks are skipped, not failed, when the interpreter is missing.
    let bashAvailable: boolean | undefined;
    const bashIsAvailable = async (): Promise<boolean> => {
      if (bashAvailable === undefined) {
        try {
          bashAvailable = (await ctx.exec('bash', ['--version'], { timeoutMs: 5_000 })).exitCode === 0;
        } catch {
          bashAvailable = false;
        }
      }
      return bashAvailable;
    };

    let executedCount = 0;
    let skippedForMissingBash = 0;

    const result = await runVerifier(verifierId, async () => {
      const findings: Finding[] = [];
      const coveredEntityIds: string[] = [];

      for (const artifact of pages) {
        const fencesByHash = mapFencesByHash(artifact.mdx);

        for (const block of matchingCodeBlocks(artifact.page, matchedLanguages)) {
          const fence = fencesByHash.get(block.contentHash);
          if (!fence) {
            findings.push(missingFenceFinding(verifierId, artifact, block));
            continue;
          }
          if (hasNoExecMeta(fence)) {
            continue;
          }
          const language = (block.language ?? '').toLowerCase();
          if (bashLanguages.has(language) && !(await bashIsAvailable())) {
            skippedForMissingBash += 1;
            continue;
          }

          const cwd = await mkdtemp(join(tmpdir(), 'docstube-snippet-'));
          try {
            const run = await runSnippet(ctx, language, fence.code, cwd, hasAllowEnvMeta(fence));
            executedCount += 1;
            if (run.exitCode === 0) {
              // The covered set is the executed BLOCK — snippet execution proves code examples
              // run (block-level evidence). It never covers claims: behavior claims stay
              // unchecked until the v1.x predicate verifiers (trust-model-v2 decision 3).
              coveredEntityIds.push(block.id);
            } else if (!bashLanguages.has(language) && isModuleNotFound(run.stderr)) {
              // Unresolvable import in the sandbox: not proven, not failed.
            } else if (bashLanguages.has(language) && isCommandNotFound(run.exitCode, run.stderr)) {
              // Binary not installed in the sandbox: not proven, not failed.
            } else {
              const tail = stderrTail(run.stderr);
              findings.push(
                executionFailureFinding(artifact, block.id, fence, `exit code ${run.exitCode}${tail === '' ? '' : `\n${tail}`}`)
              );
            }
          } catch (error) {
            // ctx.exec threw: spawn failure or timeout, depending on the host implementation.
            executedCount += 1;
            findings.push(
              executionFailureFinding(
                artifact,
                block.id,
                fence,
                `${error instanceof Error ? error.message : String(error)} (timeout ${executionTimeoutMs}ms)`
              )
            );
          } finally {
            await rm(cwd, { recursive: true, force: true });
          }
        }
      }

      return { findings, coveredEntityIds };
    });

    // Every matching block was a bash block and bash is unavailable: the run proved nothing, and
    // saying 'pass' would be dishonest. 'skipped' keeps the covered set empty and visible.
    if (result.status === 'pass' && executedCount === 0 && skippedForMissingBash > 0) {
      return { ...result, status: 'skipped' };
    }
    return result;
  }
};
