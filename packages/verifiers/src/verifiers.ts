import { evaluate } from '@mdx-js/mdx';
import { createElement } from 'react';
import type { ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as jsxRuntime from 'react/jsx-runtime';
import { z } from 'zod';
import {
  checkResultSchema,
  checkSectionPresence,
  generatedPageFrontmatterSchema,
  parseSectionMarker,
  relativePathSchema
} from '@docstube/contracts';
import type { CheckResult, Finding, GeneratedPageFrontmatter, RelativePath } from '@docstube/contracts';

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

export const generatedPageSectionCheckId = 'section-presence';

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

export type DeterministicCheckStatus = 'error' | 'fail' | 'pass' | 'skipped' | 'warn';

export type DeterministicCheckResult = {
  checkId: string;
  message?: string;
  status: DeterministicCheckStatus;
};

export const deterministicCheckStatuses = ['pass', 'fail', 'warn', 'skipped', 'error'] as const;
