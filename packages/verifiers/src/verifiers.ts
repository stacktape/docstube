import { execFile } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, posix } from 'node:path';
import { promisify } from 'node:util';
import { evaluate } from '@mdx-js/mdx';
import { D2 } from '@terrastruct/d2';
import { createElement } from 'react';
import type { ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as jsxRuntime from 'react/jsx-runtime';
import ts from 'typescript';
import { z, type ZodError } from 'zod';
import {
  checkResultSchema,
  checkStatuses,
  checkSectionPresence,
  duplicatePageIds,
  duplicateSectionIds,
  generatedPageFrontmatterSchema,
  glossarySchema,
  pageIdSchema,
  parseSectionMarker,
  relativePathSchema,
  registrySchema,
  sectionIdSchema,
  safeParseDocstubeConfig,
  safeParseGlossary,
  safeParseIa
} from '@docstube/contracts';
import { apiReferenceSymbolSchema } from '@docstube/extractors';
import type {
  CheckResult,
  ComponentRegistry,
  Finding,
  FindingLocation,
  GeneratedPageFrontmatter,
  RelativePath
} from '@docstube/contracts';
import type { ApiReferenceSymbol } from '@docstube/extractors';

const execFileAsync = promisify(execFile);

export type VerifierRunResult = CheckResult | Promise<CheckResult>;

export type Verifier = {
  id: string;
  run: (input: unknown) => VerifierRunResult;
};

export type VerifierRegistry = {
  list: () => Verifier[];
  get: (id: string) => Verifier | undefined;
  run: (id: string, input: unknown) => VerifierRunResult;
};

export const createVerifierRegistry = (verifiers: readonly Verifier[]): VerifierRegistry => {
  const byId = new Map(verifiers.map((verifier) => [verifier.id, verifier]));

  return {
    list: () => [...byId.values()].toSorted((left, right) => left.id.localeCompare(right.id)),
    get: (id) => byId.get(id),
    run: (id, input) => {
      const verifier = byId.get(id);
      if (!verifier) {
        return checkResultSchema.parse({ checkId: id, status: 'errored', error: `unknown verifier: ${id}` });
      }
      return verifier.run(input);
    }
  };
};

const passed = (checkId: string): CheckResult => checkResultSchema.parse({ checkId, status: 'passed' });

const failed = (checkId: string, findings: Finding[]): CheckResult =>
  checkResultSchema.parse({ checkId, status: 'failed', findings });

const skipped = (checkId: string, reason: string): CheckResult =>
  checkResultSchema.parse({ checkId, status: 'skipped', reason });

const finding = (
  code: string,
  message: string,
  options: { location?: FindingLocation; pageId?: string; sectionId?: string } = {}
): Finding => ({
  code,
  severity: 'major',
  origin: 'verifier',
  message,
  ...options
});

const issuePath = (path: readonly (string | number | symbol)[]): string =>
  path.length > 0 ? path.map((part) => String(part)).join('.') : '<root>';

const zodFindings = (
  code: string,
  error: ZodError,
  options: { location?: FindingLocation; pageId?: string } = {}
): Finding[] =>
  error.issues.map((issue) =>
    finding(code, `${issuePath(issue.path)}: ${issue.message}`, {
      location: options.location,
      pageId: options.pageId
    })
  );

export const generatedMdxPageSchema = z.strictObject({
  path: relativePathSchema,
  frontmatter: generatedPageFrontmatterSchema,
  body: z.string().min(1)
});

export type GeneratedMdxPage = {
  path: RelativePath;
  frontmatter: GeneratedPageFrontmatter;
  body: string;
};

export const configFamilyCheckId = 'config-family';
export const generatedFrontmatterCheckId = 'generated-frontmatter';
export const pageSectionIdCheckId = 'page-section-ids';
export const generatedPageSectionCheckId = 'section-presence';
export const mdxCompileCheckId = 'mdx-compile';
export const componentPropsCheckId = 'component-props';
export const typescriptSnippetCheckId = 'typescript-snippet';
export const pythonSnippetCheckId = 'python-snippet';
export const importPathCheckId = 'import-paths';
export const linkCheckId = 'links';
export const d2CheckId = 'd2';
export const glossaryRulesCheckId = 'glossary-rules';
export const apiReferenceConsistencyCheckId = 'api-reference-consistency';

export const configFamilyCheckInputSchema = z.strictObject({
  docstubeConfig: z.unknown().optional(),
  ia: z.unknown().optional(),
  glossary: z.unknown().optional()
});

export type ConfigFamilyCheckInput = z.infer<typeof configFamilyCheckInputSchema>;

export const checkConfigFamily = (input: ConfigFamilyCheckInput): CheckResult => {
  const parsed = configFamilyCheckInputSchema.parse(input);
  const findings: Finding[] = [];

  if ('docstubeConfig' in parsed) {
    const result = safeParseDocstubeConfig(parsed.docstubeConfig);
    if (!result.ok) {
      findings.push(...zodFindings(configFamilyCheckId, result.error, { location: { path: 'docstube.yml' } }));
    }
  }

  if ('ia' in parsed) {
    const result = safeParseIa(parsed.ia);
    if (!result.ok) {
      findings.push(...zodFindings(configFamilyCheckId, result.error, { location: { path: 'ia.yml' } }));
    }
  }

  if ('glossary' in parsed) {
    const result = safeParseGlossary(parsed.glossary);
    if (!result.ok) {
      findings.push(...zodFindings(configFamilyCheckId, result.error, { location: { path: 'glossary.yaml' } }));
    }
  }

  return findings.length === 0 ? passed(configFamilyCheckId) : failed(configFamilyCheckId, findings);
};

export const generatedFrontmatterCheckInputSchema = z.strictObject({
  path: relativePathSchema,
  frontmatter: z.unknown()
});

export type GeneratedFrontmatterCheckInput = z.infer<typeof generatedFrontmatterCheckInputSchema>;

export const checkGeneratedPageFrontmatter = (input: GeneratedFrontmatterCheckInput): CheckResult => {
  const parsed = generatedFrontmatterCheckInputSchema.parse(input);
  const result = generatedPageFrontmatterSchema.safeParse(parsed.frontmatter);
  return result.success
    ? passed(generatedFrontmatterCheckId)
    : failed(
        generatedFrontmatterCheckId,
        zodFindings(generatedFrontmatterCheckId, result.error, { location: { path: parsed.path } })
      );
};

export const pageSectionIdCheckInputSchema = z.strictObject({
  pageIds: z.array(z.unknown()),
  sectionsByPage: z
    .array(
      z.strictObject({
        pageId: z.unknown(),
        sectionIds: z.array(z.unknown())
      })
    )
    .default([])
});

export type PageSectionIdCheckInput = z.infer<typeof pageSectionIdCheckInputSchema>;

export const checkPageAndSectionIds = (input: PageSectionIdCheckInput): CheckResult => {
  const parsed = pageSectionIdCheckInputSchema.parse(input);
  const findings: Finding[] = [];
  const validPageIds: string[] = [];

  for (const [index, pageId] of parsed.pageIds.entries()) {
    const result = pageIdSchema.safeParse(pageId);
    if (result.success) {
      validPageIds.push(result.data);
    } else {
      findings.push(...zodFindings(pageSectionIdCheckId, result.error, { location: { path: `pages/${index}.mdx` } }));
    }
  }

  for (const pageId of duplicatePageIds(validPageIds)) {
    findings.push(finding(pageSectionIdCheckId, `Duplicate page id: ${pageId}`, { pageId }));
  }

  for (const group of parsed.sectionsByPage) {
    const pageIdResult = pageIdSchema.safeParse(group.pageId);
    const pageId = pageIdResult.success ? pageIdResult.data : undefined;
    if (!pageIdResult.success) {
      findings.push(...zodFindings(pageSectionIdCheckId, pageIdResult.error));
    }

    const validSectionIds: string[] = [];
    for (const sectionId of group.sectionIds) {
      const result = sectionIdSchema.safeParse(sectionId);
      if (result.success) {
        validSectionIds.push(result.data);
      } else {
        findings.push(...zodFindings(pageSectionIdCheckId, result.error, { pageId }));
      }
    }

    for (const sectionId of duplicateSectionIds(validSectionIds)) {
      findings.push(finding(pageSectionIdCheckId, `Duplicate section id: ${sectionId}`, { pageId, sectionId }));
    }
  }

  return findings.length === 0 ? passed(pageSectionIdCheckId) : failed(pageSectionIdCheckId, findings);
};

export const checkGeneratedPageSections = (page: GeneratedMdxPage): CheckResult => {
  const parsed = generatedMdxPageSchema.parse(page);
  const expectedSections = parsed.frontmatter.sections ?? [];
  const presence = checkSectionPresence(expectedSections, parsed.body);

  if (presence.missing.length === 0 && presence.undeclared.length === 0 && presence.unbalanced.length === 0) {
    return checkResultSchema.parse({ checkId: generatedPageSectionCheckId, status: 'passed' });
  }

  const findings: Finding[] = [
    ...presence.missing.map(
      (sectionId): Finding => ({
        code: generatedPageSectionCheckId,
        severity: 'major',
        origin: 'verifier',
        message: `Declared section is missing balanced markers: ${sectionId}`,
        pageId: parsed.frontmatter.id,
        sectionId,
        location: { path: parsed.path }
      })
    ),
    ...presence.undeclared.map(
      (sectionId): Finding => ({
        code: generatedPageSectionCheckId,
        severity: 'major',
        origin: 'verifier',
        message: `Section marker is not declared in frontmatter: ${sectionId}`,
        pageId: parsed.frontmatter.id,
        sectionId,
        location: { path: parsed.path }
      })
    ),
    ...presence.unbalanced.map(
      (sectionId): Finding => ({
        code: generatedPageSectionCheckId,
        severity: 'major',
        origin: 'verifier',
        message: `Section markers are unbalanced or out of order: ${sectionId}`,
        pageId: parsed.frontmatter.id,
        sectionId,
        location: { path: parsed.path }
      })
    )
  ];

  return checkResultSchema.parse({ checkId: generatedPageSectionCheckId, status: 'failed', findings });
};

export const compileMdxBodyToHtml = async (mdx: string): Promise<string> => {
  const renderableMdx = mdx
    .split(/\r?\n/u)
    .filter((line) => parseSectionMarker(line) === null)
    .join('\n');
  const evaluated = await evaluate(renderableMdx, { ...jsxRuntime, baseUrl: import.meta.url });
  const Content = evaluated.default as ComponentType<Record<string, never>>;
  return renderToStaticMarkup(createElement(Content, {}));
};

export const compileGeneratedMdxPageToHtml = async (page: GeneratedMdxPage): Promise<string> => {
  const parsed = generatedMdxPageSchema.parse(page);
  return compileMdxBodyToHtml(parsed.body);
};

export const mdxCompileCheckInputSchema = z.strictObject({
  path: relativePathSchema,
  body: z.string()
});

export type MdxCompileCheckInput = z.infer<typeof mdxCompileCheckInputSchema>;

export const checkMdxCompiles = async (input: MdxCompileCheckInput): Promise<CheckResult> => {
  const parsed = mdxCompileCheckInputSchema.parse(input);
  try {
    await compileMdxBodyToHtml(parsed.body);
    return passed(mdxCompileCheckId);
  } catch (error) {
    return failed(mdxCompileCheckId, [
      finding(mdxCompileCheckId, error instanceof Error ? error.message : 'MDX compile failed', {
        location: { path: parsed.path }
      })
    ]);
  }
};

export const componentUsageSchema = z.strictObject({
  name: z.string().min(1),
  props: z.unknown(),
  location: z
    .strictObject({
      path: relativePathSchema.optional(),
      line: z.int().positive().optional(),
      column: z.int().positive().optional()
    })
    .optional()
});

export type ComponentUsage = z.infer<typeof componentUsageSchema>;

export const componentPropsCheckInputSchema = z.strictObject({
  registry: registrySchema,
  usages: z.array(componentUsageSchema),
  propSchemas: z.record(z.string(), z.instanceof(z.ZodType))
});

export type ComponentPropsCheckInput = {
  registry: ComponentRegistry;
  usages: ComponentUsage[];
  propSchemas: Record<string, z.ZodType>;
};

export const checkComponentProps = (input: ComponentPropsCheckInput): CheckResult => {
  const parsed = componentPropsCheckInputSchema.parse(input);
  const components = new Map(parsed.registry.components.map((component) => [component.name, component]));
  const findings: Finding[] = [];

  for (const usage of parsed.usages) {
    const component = components.get(usage.name);
    if (!component) {
      findings.push(
        finding(componentPropsCheckId, `Component is not registered: ${usage.name}`, { location: usage.location })
      );
      continue;
    }

    const propSchema = parsed.propSchemas[component.props.ref];
    if (!propSchema) {
      findings.push(
        finding(componentPropsCheckId, `Missing prop schema for component ${usage.name}: ${component.props.ref}`, {
          location: usage.location
        })
      );
      continue;
    }

    const result = propSchema.safeParse(usage.props);
    if (!result.success) {
      findings.push(
        ...zodFindings(componentPropsCheckId, result.error, {
          location: usage.location
        })
      );
    }
  }

  return findings.length === 0 ? passed(componentPropsCheckId) : failed(componentPropsCheckId, findings);
};

export const foundationalVerifiers = [
  { id: configFamilyCheckId, run: (input) => checkConfigFamily(configFamilyCheckInputSchema.parse(input)) },
  {
    id: generatedFrontmatterCheckId,
    run: (input) => checkGeneratedPageFrontmatter(generatedFrontmatterCheckInputSchema.parse(input))
  },
  { id: pageSectionIdCheckId, run: (input) => checkPageAndSectionIds(pageSectionIdCheckInputSchema.parse(input)) },
  { id: generatedPageSectionCheckId, run: (input) => checkGeneratedPageSections(generatedMdxPageSchema.parse(input)) },
  { id: mdxCompileCheckId, run: (input) => checkMdxCompiles(mdxCompileCheckInputSchema.parse(input)) },
  { id: componentPropsCheckId, run: (input) => checkComponentProps(input as ComponentPropsCheckInput) }
] as const satisfies readonly Verifier[];

export const foundationalVerifierRegistry = createVerifierRegistry(foundationalVerifiers);

export const typescriptSnippetCheckInputSchema = z.strictObject({
  path: relativePathSchema,
  code: z.string()
});

export type TypeScriptSnippetCheckInput = z.infer<typeof typescriptSnippetCheckInputSchema>;

const diagnosticMessage = (diagnostic: ts.Diagnostic): string =>
  ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');

export const checkTypeScriptSnippet = (input: TypeScriptSnippetCheckInput): CheckResult => {
  const parsed = typescriptSnippetCheckInputSchema.parse(input);
  const output = ts.transpileModule(parsed.code, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      strict: true,
      target: ts.ScriptTarget.ESNext
    },
    fileName: parsed.path,
    reportDiagnostics: true
  });
  const diagnostics = (output.diagnostics ?? []).filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error
  );

  return diagnostics.length === 0
    ? passed(typescriptSnippetCheckId)
    : failed(
        typescriptSnippetCheckId,
        diagnostics.map((diagnostic) =>
          finding(typescriptSnippetCheckId, diagnosticMessage(diagnostic), { location: { path: parsed.path } })
        )
      );
};

export const pythonSnippetCheckInputSchema = z.strictObject({
  path: relativePathSchema,
  code: z.string(),
  pyrightCommand: z.string().min(1).default('pyright')
});

export type PythonSnippetCheckInput = z.input<typeof pythonSnippetCheckInputSchema>;

const outputFromExecError = (error: unknown): { stdout?: string; stderr?: string } => {
  if (!error || typeof error !== 'object') {
    return {};
  }
  const record = error as { stdout?: unknown; stderr?: unknown };
  return {
    stdout: typeof record.stdout === 'string' ? record.stdout : undefined,
    stderr: typeof record.stderr === 'string' ? record.stderr : undefined
  };
};

export const checkPythonSnippet = async (input: PythonSnippetCheckInput): Promise<CheckResult> => {
  const parsed = pythonSnippetCheckInputSchema.parse(input);

  try {
    await execFileAsync(parsed.pyrightCommand, ['--version']);
  } catch {
    return skipped(pythonSnippetCheckId, 'pyright is unavailable');
  }

  const tempDir = await mkdtemp(join(tmpdir(), 'docstube-pyright-'));
  const filePath = join(tempDir, parsed.path.replaceAll('/', '_'));
  await writeFile(filePath, parsed.code, 'utf8');

  try {
    await execFileAsync(parsed.pyrightCommand, ['--outputjson', filePath], { cwd: tempDir });
    return passed(pythonSnippetCheckId);
  } catch (error) {
    const output = outputFromExecError(error);
    const findings: Finding[] = [];

    if (output.stdout) {
      try {
        const parsedOutput = z
          .object({
            generalDiagnostics: z
              .array(z.object({ message: z.string(), file: z.string().optional(), range: z.unknown().optional() }))
              .optional()
          })
          .safeParse(JSON.parse(output.stdout));
        if (parsedOutput.success) {
          for (const diagnostic of parsedOutput.data.generalDiagnostics ?? []) {
            findings.push(finding(pythonSnippetCheckId, diagnostic.message, { location: { path: parsed.path } }));
          }
        }
      } catch {
        findings.push(finding(pythonSnippetCheckId, output.stdout, { location: { path: parsed.path } }));
      }
    }

    if (findings.length === 0) {
      findings.push(
        finding(pythonSnippetCheckId, output.stderr || 'pyright reported an error', { location: { path: parsed.path } })
      );
    }

    return failed(pythonSnippetCheckId, findings);
  }
};

export const importPathCheckInputSchema = z.strictObject({
  files: z.array(relativePathSchema),
  imports: z.array(
    z.strictObject({
      fromPath: relativePathSchema,
      specifier: z.string().min(1)
    })
  )
});

export type ImportPathCheckInput = z.infer<typeof importPathCheckInputSchema>;

const resolveImportCandidates = (fromPath: RelativePath, specifier: string): string[] => {
  const baseDir = posix.dirname(fromPath);
  const resolved = posix.normalize(posix.join(baseDir, specifier));
  return [
    resolved,
    `${resolved}.ts`,
    `${resolved}.tsx`,
    `${resolved}.js`,
    `${resolved}.jsx`,
    `${resolved}.mjs`,
    `${resolved}.py`,
    posix.join(resolved, 'index.ts'),
    posix.join(resolved, 'index.js')
  ];
};

export const checkImportPaths = (input: ImportPathCheckInput): CheckResult => {
  const parsed = importPathCheckInputSchema.parse(input);
  const files = new Set(parsed.files);
  const findings: Finding[] = [];

  for (const importRef of parsed.imports) {
    if (!importRef.specifier.startsWith('.')) {
      continue;
    }

    const resolved = resolveImportCandidates(importRef.fromPath, importRef.specifier);
    if (!resolved.some((candidate) => files.has(candidate))) {
      findings.push(
        finding(importPathCheckId, `Unresolved relative import: ${importRef.specifier}`, {
          location: { path: importRef.fromPath }
        })
      );
    }
  }

  return findings.length === 0 ? passed(importPathCheckId) : failed(importPathCheckId, findings);
};

export type LinkCheckInput = {
  links: string[];
  files: RelativePath[];
  anchors?: string[];
  fetchExternal?: (url: string) => Promise<boolean> | boolean;
  sourcePath?: RelativePath;
};

export const linkCheckInputSchema = z.strictObject({
  links: z.array(z.string().min(1)),
  files: z.array(relativePathSchema),
  anchors: z.array(z.string().min(1)).optional(),
  fetchExternal: z.function().optional(),
  sourcePath: relativePathSchema.optional()
});

const isExternalLink = (link: string): boolean => /^https?:\/\//iu.test(link);

export const checkLinks = async (input: LinkCheckInput): Promise<CheckResult> => {
  const parsed = linkCheckInputSchema.parse(input) as LinkCheckInput;
  const files = new Set(parsed.files);
  const anchors = new Set(parsed.anchors ?? []);
  const findings: Finding[] = [];
  const externalChecks: Promise<{ link: string; ok: boolean }>[] = [];
  let skippedExternal = false;

  for (const link of parsed.links) {
    if (isExternalLink(link)) {
      if (!parsed.fetchExternal) {
        skippedExternal = true;
        continue;
      }
      externalChecks.push(Promise.resolve(parsed.fetchExternal(link)).then((ok) => ({ link, ok })));
      continue;
    }

    const [rawPath = '', rawAnchor] = link.split('#');
    const pathResult = rawPath === '' ? undefined : relativePathSchema.safeParse(posix.normalize(rawPath));
    if (pathResult && !pathResult.success) {
      findings.push(
        finding(linkCheckId, `Internal link target is invalid: ${link}`, { location: { path: parsed.sourcePath } })
      );
      continue;
    }

    const path = rawPath === '' ? parsed.sourcePath : pathResult?.data;
    if (path && !files.has(path)) {
      findings.push(
        finding(linkCheckId, `Internal link target is missing: ${link}`, { location: { path: parsed.sourcePath } })
      );
      continue;
    }

    if (rawAnchor && !anchors.has(`${path ?? ''}#${rawAnchor}`) && !anchors.has(`#${rawAnchor}`)) {
      findings.push(
        finding(linkCheckId, `Internal link anchor is missing: ${link}`, { location: { path: parsed.sourcePath } })
      );
    }
  }

  for (const result of await Promise.all(externalChecks)) {
    if (!result.ok) {
      findings.push(
        finding(linkCheckId, `External link did not resolve: ${result.link}`, { location: { path: parsed.sourcePath } })
      );
    }
  }

  if (findings.length > 0) {
    return failed(linkCheckId, findings);
  }
  return skippedExternal ? skipped(linkCheckId, 'external link fetcher is unavailable') : passed(linkCheckId);
};

export const d2CheckInputSchema = z.strictObject({
  path: relativePathSchema,
  source: z.string()
});

export type D2CheckInput = z.infer<typeof d2CheckInputSchema>;

export const checkD2 = async (input: D2CheckInput): Promise<CheckResult> => {
  const parsed = d2CheckInputSchema.parse(input);
  try {
    const d2 = new D2();
    await d2.compile(parsed.source);
    return passed(d2CheckId);
  } catch (error) {
    return failed(d2CheckId, [
      finding(d2CheckId, error instanceof Error ? error.message : 'D2 compile failed', {
        location: { path: parsed.path }
      })
    ]);
  }
};

export const glossaryRulesCheckInputSchema = z.strictObject({
  glossary: z.unknown(),
  usedTerms: z.array(z.string().min(1)).default([])
});

export type GlossaryRulesCheckInput = z.input<typeof glossaryRulesCheckInputSchema>;

const normalizedTerm = (term: string): string => term.trim().toLowerCase();

export const checkGlossaryRules = (input: GlossaryRulesCheckInput): CheckResult => {
  const parsed = glossaryRulesCheckInputSchema.parse(input);
  const glossary = glossarySchema.safeParse(parsed.glossary);
  if (!glossary.success) {
    return failed(
      glossaryRulesCheckId,
      zodFindings(glossaryRulesCheckId, glossary.error, { location: { path: 'glossary.yaml' } })
    );
  }

  const known = new Map<string, string>();
  const findings: Finding[] = [];
  for (const term of glossary.data.terms) {
    for (const label of [term.term, ...(term.aliases ?? [])]) {
      const normalized = normalizedTerm(label);
      const existing = known.get(normalized);
      if (existing && existing !== term.id) {
        findings.push(finding(glossaryRulesCheckId, `Glossary label is used by multiple terms: ${label}`));
      }
      known.set(normalized, term.id);
    }
  }

  for (const usedTerm of parsed.usedTerms) {
    if (!known.has(normalizedTerm(usedTerm))) {
      findings.push(finding(glossaryRulesCheckId, `Glossary term is not defined: ${usedTerm}`));
    }
  }

  return findings.length === 0 ? passed(glossaryRulesCheckId) : failed(glossaryRulesCheckId, findings);
};

export const apiReferenceConsistencyCheckInputSchema = z.strictObject({
  documentedSymbols: z.array(z.string().min(1)),
  extractedSymbols: z.array(apiReferenceSymbolSchema)
});

export type ApiReferenceConsistencyCheckInput = {
  documentedSymbols: string[];
  extractedSymbols: ApiReferenceSymbol[];
};

export const checkApiReferenceConsistency = (input: ApiReferenceConsistencyCheckInput): CheckResult => {
  const parsed = apiReferenceConsistencyCheckInputSchema.parse(input);
  const extracted = new Set(parsed.extractedSymbols.map((symbol) => symbol.name));
  const findings = parsed.documentedSymbols
    .filter((symbol) => !extracted.has(symbol))
    .map((symbol) =>
      finding(apiReferenceConsistencyCheckId, `Documented API symbol is missing from extractor output: ${symbol}`)
    );

  return findings.length === 0
    ? passed(apiReferenceConsistencyCheckId)
    : failed(apiReferenceConsistencyCheckId, findings);
};

export const contentVerifiers = [
  {
    id: typescriptSnippetCheckId,
    run: (input) => checkTypeScriptSnippet(typescriptSnippetCheckInputSchema.parse(input))
  },
  { id: pythonSnippetCheckId, run: (input) => checkPythonSnippet(pythonSnippetCheckInputSchema.parse(input)) },
  { id: importPathCheckId, run: (input) => checkImportPaths(importPathCheckInputSchema.parse(input)) },
  { id: linkCheckId, run: (input) => checkLinks(input as LinkCheckInput) },
  { id: d2CheckId, run: (input) => checkD2(d2CheckInputSchema.parse(input)) },
  { id: glossaryRulesCheckId, run: (input) => checkGlossaryRules(glossaryRulesCheckInputSchema.parse(input)) },
  {
    id: apiReferenceConsistencyCheckId,
    run: (input) => checkApiReferenceConsistency(input as ApiReferenceConsistencyCheckInput)
  }
] as const satisfies readonly Verifier[];

export const allVerifiers = [...foundationalVerifiers, ...contentVerifiers] as const satisfies readonly Verifier[];

export const allVerifierRegistry = createVerifierRegistry(allVerifiers);

export type DeterministicCheckResult = CheckResult;

export type DeterministicCheckStatus = CheckResult['status'];

export const deterministicCheckStatuses = checkStatuses;
