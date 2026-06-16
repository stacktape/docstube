import { evaluate } from '@mdx-js/mdx';
import { createElement } from 'react';
import type { ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as jsxRuntime from 'react/jsx-runtime';
import { z, type ZodError } from 'zod';
import {
  checkResultSchema,
  checkStatuses,
  checkSectionPresence,
  duplicatePageIds,
  duplicateSectionIds,
  generatedPageFrontmatterSchema,
  pageIdSchema,
  parseSectionMarker,
  relativePathSchema,
  registrySchema,
  sectionIdSchema,
  safeParseDocstubeConfig,
  safeParseGlossary,
  safeParseIa
} from '@docstube/contracts';
import type {
  CheckResult,
  ComponentRegistry,
  Finding,
  FindingLocation,
  GeneratedPageFrontmatter,
  RelativePath
} from '@docstube/contracts';

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

export type DeterministicCheckResult = CheckResult;

export type DeterministicCheckStatus = CheckResult['status'];

export const deterministicCheckStatuses = checkStatuses;
