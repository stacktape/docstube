import {
  apiReferenceConsistencyCheckId,
  checkApiReferenceConsistency,
  checkComponentProps,
  checkD2,
  checkGeneratedPageSections,
  checkGlossaryRules,
  checkImportPaths,
  checkLinks,
  checkMdxCompiles,
  checkPythonSnippet,
  checkTypeScriptSnippet,
  componentPropsCheckId,
  d2CheckId,
  generatedPageSectionCheckId,
  glossaryRulesCheckId,
  importPathCheckId,
  linkCheckId,
  mdxCompileCheckId,
  pythonSnippetCheckId,
  typescriptSnippetCheckId
} from '@docstube/verifiers';
import { docstubeThemeRegistry, themeComponentPropSchemas } from '@docstube/theme';
import { checkResultSchema } from '@docstube/contracts';
import type { CheckResult, Finding, RelativePath } from '@docstube/contracts';
import type { ComponentUsage, GeneratedMdxPage } from '@docstube/verifiers';
import type { PageGenerationContext } from './page-generation-context.ts';
import type { PageDeterministicVerifier } from './page-orchestrator.ts';

type CodeFence = {
  code: string;
  language: string;
};

const codeFencePattern = /```(?<language>[A-Za-z0-9_+-]*)[^\n]*\n(?<code>[\s\S]*?)```/gu;
const componentPattern = /<(?<name>[A-Z][A-Za-z0-9]*)\b(?<attrs>[^>]*)\/?>/gu;
const propPattern = /(?<name>[A-Za-z_$][\w$-]*)=(?:"(?<double>[^"]*)"|'(?<single>[^']*)'|\{(?<expression>[^}]*)\})/gu;
const markdownLinkPattern = /\[[^\]]+\]\((?<target>[^)]+)\)/gu;
const hrefPattern = /\bhref=(?:"(?<double>[^"]*)"|'(?<single>[^']*)'|\{["'`](?<expression>[^"'`]+)["'`]\})/gu;
const headingPattern = /^#{1,6}\s+(?<title>.+)$/gmu;
const termComponentPattern =
  /<Term\b[^>]*\bid=(?:"(?<double>[^"]+)"|'(?<single>[^']+)'|\{["'`](?<expression>[^"'`]+)["'`]\})/gu;
const glossaryMarkerPattern = /\{\{glossary:(?<term>[a-z0-9]+(?:-[a-z0-9]+)*)\}\}/gu;
const apiReferencePattern =
  /<ApiReference\b[^>]*\bsymbol=(?:"(?<double>[^"]+)"|'(?<single>[^']+)'|\{["'`](?<expression>[^"'`]+)["'`]\})/gu;
const d2SourcePropPattern = /<Diagram\b[^>]*\bsource=\{`(?<source>[\s\S]*?)`\}/gu;
const importPattern = /\bimport\s+(?:[^'"]+\s+from\s+)?['"](?<specifier>[^'"]+)['"]/gu;

const skipped = (checkId: string, reason: string): CheckResult =>
  checkResultSchema.parse({ checkId, status: 'skipped', reason });

const passed = (checkId: string): CheckResult => checkResultSchema.parse({ checkId, status: 'passed' });

const findingFromErroredResult = (result: Extract<CheckResult, { status: 'errored' }>): Finding => ({
  code: result.checkId,
  severity: 'major',
  origin: 'verifier',
  message: result.error
});

const combineCheckResults = (checkId: string, results: readonly CheckResult[], emptyReason: string): CheckResult => {
  if (results.length === 0) {
    return skipped(checkId, emptyReason);
  }

  const findings = results.flatMap((result): Finding[] => {
    if (result.status === 'failed') {
      return result.findings;
    }
    if (result.status === 'errored') {
      return [findingFromErroredResult(result)];
    }
    return [];
  });

  if (findings.length > 0) {
    return checkResultSchema.parse({ checkId, status: 'failed', findings });
  }

  if (results.every((result) => result.status === 'skipped')) {
    return skipped(checkId, results.map((result) => (result.status === 'skipped' ? result.reason : '')).join('; '));
  }

  return passed(checkId);
};

const extractCodeFences = (body: string): CodeFence[] =>
  [...body.matchAll(codeFencePattern)].map((match) => ({
    language: (match.groups?.language ?? '').toLowerCase(),
    code: match.groups?.code ?? ''
  }));

const parseExpressionValue = (expression: string): unknown => {
  const trimmed = expression.trim();
  if (trimmed === 'true') {
    return true;
  }
  if (trimmed === 'false') {
    return false;
  }
  if (/^-?\d+(?:\.\d+)?$/u.test(trimmed)) {
    return Number(trimmed);
  }
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('`') && trimmed.endsWith('`'))
  ) {
    return trimmed.slice(1, -1);
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
};

const parseComponentProps = (attrs: string): Record<string, unknown> => {
  const props: Record<string, unknown> = {};
  for (const match of attrs.matchAll(propPattern)) {
    const name = match.groups?.name;
    if (!name) {
      continue;
    }
    const value = match.groups?.double ?? match.groups?.single;
    props[name] = value ?? parseExpressionValue(match.groups?.expression ?? '');
  }
  return props;
};

export const extractMdxComponentUsages = (page: GeneratedMdxPage): ComponentUsage[] =>
  [...page.body.matchAll(componentPattern)].map((match): ComponentUsage => {
    const before = page.body.slice(0, match.index);
    const line = before.split(/\r?\n/u).length;
    return {
      name: match.groups?.name ?? '',
      props: parseComponentProps(match.groups?.attrs ?? ''),
      location: { path: page.path, line }
    };
  });

const extractMarkdownLinks = (body: string): string[] =>
  [...body.matchAll(markdownLinkPattern), ...body.matchAll(hrefPattern)]
    .map(
      (match) => match.groups?.target ?? match.groups?.double ?? match.groups?.single ?? match.groups?.expression ?? ''
    )
    .filter(Boolean);

const headingSlug = (title: string): string =>
  title
    .replaceAll(/<[^>]+>/gu, '')
    .toLowerCase()
    .replaceAll(/[^a-z0-9\s-]/gu, '')
    .trim()
    .replaceAll(/\s+/gu, '-');

const extractAnchors = (page: GeneratedMdxPage): string[] =>
  [...page.body.matchAll(headingPattern)].flatMap((match) => {
    const title = match.groups?.title ?? '';
    const slug = headingSlug(title);
    return slug ? [`${page.path}#${slug}`, `#${slug}`] : [];
  });

const extractUsedGlossaryTerms = (body: string): string[] =>
  [...body.matchAll(glossaryMarkerPattern), ...body.matchAll(termComponentPattern)]
    .map(
      (match) => match.groups?.term ?? match.groups?.double ?? match.groups?.single ?? match.groups?.expression ?? ''
    )
    .filter(Boolean)
    .toSorted((left, right) => left.localeCompare(right));

const extractApiReferenceSymbols = (body: string): string[] =>
  [...body.matchAll(apiReferencePattern)]
    .map((match) => match.groups?.double ?? match.groups?.single ?? match.groups?.expression ?? '')
    .filter(Boolean)
    .toSorted((left, right) => left.localeCompare(right));

const extractD2Sources = (fences: readonly CodeFence[], body: string): string[] => [
  ...fences.filter((fence) => fence.language === 'd2').map((fence) => fence.code),
  ...[...body.matchAll(d2SourcePropPattern)].map((match) => match.groups?.source ?? '').filter(Boolean)
];

const extractImports = (page: GeneratedMdxPage, fences: readonly CodeFence[]) =>
  fences
    .filter((fence) => ['js', 'jsx', 'mjs', 'ts', 'tsx', 'typescript', 'javascript'].includes(fence.language))
    .flatMap((fence) =>
      [...fence.code.matchAll(importPattern)].map((match) => ({
        fromPath: page.path,
        specifier: match.groups?.specifier ?? ''
      }))
    )
    .filter((item) => item.specifier.length > 0);

export const createProjectPageVerifiers = (input: {
  context: PageGenerationContext;
  knownFiles: readonly RelativePath[];
}): readonly PageDeterministicVerifier[] => [
  { id: generatedPageSectionCheckId, run: checkGeneratedPageSections },
  {
    id: mdxCompileCheckId,
    run: (page) => checkMdxCompiles({ path: page.path, body: page.body })
  },
  {
    id: componentPropsCheckId,
    run: (page) =>
      checkComponentProps({
        registry: docstubeThemeRegistry,
        propSchemas: themeComponentPropSchemas,
        usages: extractMdxComponentUsages(page)
      })
  },
  {
    id: typescriptSnippetCheckId,
    run: (page) => {
      const snippets = extractCodeFences(page.body).filter((fence) =>
        ['ts', 'tsx', 'typescript'].includes(fence.language)
      );
      return combineCheckResults(
        typescriptSnippetCheckId,
        snippets.map((snippet) => checkTypeScriptSnippet({ path: page.path, code: snippet.code })),
        'no TypeScript snippets'
      );
    }
  },
  {
    id: pythonSnippetCheckId,
    run: async (page) => {
      const snippets = extractCodeFences(page.body).filter((fence) => ['py', 'python'].includes(fence.language));
      return combineCheckResults(
        pythonSnippetCheckId,
        await Promise.all(snippets.map((snippet) => checkPythonSnippet({ path: page.path, code: snippet.code }))),
        'no Python snippets'
      );
    }
  },
  {
    id: importPathCheckId,
    run: (page) => {
      const fences = extractCodeFences(page.body);
      const imports = extractImports(page, fences);
      return imports.length === 0
        ? skipped(importPathCheckId, 'no relative imports')
        : checkImportPaths({ files: [...input.knownFiles], imports });
    }
  },
  {
    id: linkCheckId,
    run: (page) =>
      checkLinks({
        files: [...input.knownFiles],
        links: extractMarkdownLinks(page.body),
        anchors: extractAnchors(page),
        sourcePath: page.path
      })
  },
  {
    id: d2CheckId,
    run: async (page) => {
      const fences = extractCodeFences(page.body);
      const sources = extractD2Sources(fences, page.body);
      return combineCheckResults(
        d2CheckId,
        await Promise.all(sources.map((source) => checkD2({ path: page.path, source }))),
        'no D2 diagrams'
      );
    }
  },
  {
    id: glossaryRulesCheckId,
    run: (page) =>
      checkGlossaryRules({
        glossary: {
          version: 1,
          terms: input.context.glossaryTerms.map((term) => ({
            id: term.id,
            term: term.term,
            definition: term.definition,
            aliases: [...term.aliases]
          }))
        },
        usedTerms: extractUsedGlossaryTerms(page.body)
      })
  },
  {
    id: apiReferenceConsistencyCheckId,
    run: (page) => {
      const documentedSymbols = extractApiReferenceSymbols(page.body);
      return documentedSymbols.length === 0
        ? skipped(apiReferenceConsistencyCheckId, 'no API reference components')
        : checkApiReferenceConsistency({
            documentedSymbols,
            extractedSymbols: [...input.context.apiSymbols]
          });
    }
  }
];
