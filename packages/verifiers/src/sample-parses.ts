import { parseDocument } from 'yaml';
import type { Finding } from '@docstube/contracts';
import type { PageArtifact, VerifierDefinition } from '@docstube/plugin-sdk';
import { mapFencesByHash } from './code-typecheck-ts.ts';
import type { MdxCodeBlock } from './code-typecheck-ts.ts';
import { matchingCodeBlocks, missingFenceFinding, runVerifier } from './run-support.ts';

const verifierId = 'sample-parses';

const jsonLanguages = new Set(['json']);
const matchedLanguages = ['json', 'yaml', 'yml'];

export type SampleParseError = { line: number; column: number; message: string };

// Node's JSON.parse no longer reports positions in its message (V8 changed the format), so a
// minimal recursive-descent scanner locates the first syntax error. JSON.parse stays the source
// of truth for validity; this only runs after it has already thrown.
const locateJsonError = (text: string): { offset: number; message: string } | undefined => {
  let i = 0;
  let error: { offset: number; message: string } | undefined;
  const fail = (message: string): false => {
    error ??= { offset: Math.min(i, Math.max(text.length - 1, 0)), message };
    return false;
  };
  const ws = (): void => {
    while (' \t\n\r'.includes(text[i] ?? 'x')) {
      i += 1;
    }
  };
  const literal = (word: string): boolean => {
    if (!text.startsWith(word, i)) {
      return fail(`invalid literal, expected "${word}"`);
    }
    i += word.length;
    return true;
  };
  const string = (): boolean => {
    i += 1;
    while (i < text.length && text[i] !== '"') {
      if (text[i] === '\\') {
        i += 1;
        const escape = text[i];
        if (escape === undefined || !'"\\/bfnrtu'.includes(escape)) {
          return fail('invalid escape sequence in string');
        }
        if (escape === 'u') {
          if (!/^[0-9a-fA-F]{4}/u.test(text.slice(i + 1, i + 5))) {
            return fail('invalid \\u escape in string');
          }
          i += 4;
        }
      } else if (text.charCodeAt(i) < 0x20) {
        return fail('unescaped control character in string');
      }
      i += 1;
    }
    if (text[i] !== '"') {
      return fail('unterminated string');
    }
    i += 1;
    return true;
  };
  const number = (): boolean => {
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u.exec(text.slice(i));
    if (!match || match[0] === '' || match[0] === '-') {
      return fail('invalid number');
    }
    i += match[0].length;
    return true;
  };
  const value = (): boolean => {
    ws();
    const ch = text[i];
    if (ch === undefined) {
      return fail('unexpected end of input');
    }
    if (ch === '{') {
      return object();
    }
    if (ch === '[') {
      return array();
    }
    if (ch === '"') {
      return string();
    }
    if (ch === 't') {
      return literal('true');
    }
    if (ch === 'f') {
      return literal('false');
    }
    if (ch === 'n') {
      return literal('null');
    }
    if (ch === '-' || (ch >= '0' && ch <= '9')) {
      return number();
    }
    return fail(`unexpected character ${JSON.stringify(ch)}`);
  };
  const object = (): boolean => {
    i += 1;
    ws();
    if (text[i] === '}') {
      i += 1;
      return true;
    }
    for (;;) {
      ws();
      if (text[i] !== '"') {
        return fail('expected string key');
      }
      if (!string()) {
        return false;
      }
      ws();
      if (text[i] !== ':') {
        return fail(`expected ":" after object key`);
      }
      i += 1;
      if (!value()) {
        return false;
      }
      ws();
      if (text[i] === ',') {
        i += 1;
        continue;
      }
      if (text[i] === '}') {
        i += 1;
        return true;
      }
      return fail(`expected "," or "}" in object`);
    }
  };
  const array = (): boolean => {
    i += 1;
    ws();
    if (text[i] === ']') {
      i += 1;
      return true;
    }
    for (;;) {
      if (!value()) {
        return false;
      }
      ws();
      if (text[i] === ',') {
        i += 1;
        continue;
      }
      if (text[i] === ']') {
        i += 1;
        return true;
      }
      return fail(`expected "," or "]" in array`);
    }
  };
  if (value()) {
    ws();
    if (i < text.length) {
      fail('unexpected trailing content');
    }
  }
  return error;
};

const lineColumnOfOffset = (text: string, offset: number): { line: number; column: number } => {
  const before = text.slice(0, offset);
  const lastNewline = before.lastIndexOf('\n');
  return { line: before.split('\n').length, column: offset - lastNewline };
};

export const parseJsonSample = (code: string): SampleParseError[] => {
  try {
    JSON.parse(code);
    return [];
  } catch (parseError) {
    const located = locateJsonError(code);
    if (located) {
      const { line, column } = lineColumnOfOffset(code, located.offset);
      return [{ line, column, message: located.message }];
    }
    return [{ line: 1, column: 1, message: parseError instanceof Error ? parseError.message : String(parseError) }];
  }
};

export const parseYamlSample = (code: string): SampleParseError[] =>
  parseDocument(code).errors.map((yamlError) => ({
    line: yamlError.linePos?.[0]?.line ?? 1,
    column: yamlError.linePos?.[0]?.col ?? 1,
    // yaml error messages carry a multi-line code frame; the first line is the actual message.
    message: `${yamlError.code}: ${yamlError.message.split('\n')[0] ?? yamlError.message}`
  }));

const parseErrorFinding = (
  artifact: PageArtifact,
  blockId: string,
  fence: MdxCodeBlock,
  language: string,
  sampleError: SampleParseError
): Finding => {
  const mdxLine = fence.line + sampleError.line;
  return {
    source: 'verifier',
    check: verifierId,
    severity: 'error',
    message: `${language.toUpperCase()} sample fails to parse at line ${sampleError.line}, column ${sampleError.column}: ${sampleError.message}`,
    entity: { version: artifact.version, locale: artifact.locale, pageId: artifact.page.id, entityId: blockId },
    file: artifact.mdxPath,
    span: [mdxLine, mdxLine],
    data: { snippetLine: sampleError.line, snippetColumn: sampleError.column }
  };
};

export const sampleParsesVerifier: VerifierDefinition = {
  id: verifierId,
  title: 'JSON/YAML samples parse',
  description:
    'Every JSON and YAML code-example block must be well-formed: JSON via JSON.parse, YAML via the yaml package. A successful parse proves the sample is well-formed data (schema conformance is a separate check). Runs per locale — translated pages carry their own fences.',
  scope: 'block',
  appliesTo: { blockTypes: ['code-example'], languages: matchedLanguages },
  localeScope: 'per-locale',
  proves: true,
  verify: (_ctx, pages) =>
    runVerifier(verifierId, async () => {
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
          const language = (block.language ?? '').toLowerCase();
          const sampleErrors = jsonLanguages.has(language) ? parseJsonSample(fence.code) : parseYamlSample(fence.code);
          if (sampleErrors.length === 0) {
            coveredEntityIds.push(block.id);
            continue;
          }
          for (const sampleError of sampleErrors) {
            findings.push(parseErrorFinding(artifact, block.id, fence, language, sampleError));
          }
        }
      }

      return { findings, coveredEntityIds };
    })
};
