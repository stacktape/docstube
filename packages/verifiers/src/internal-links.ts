import type { Finding } from '@docstube/contracts';
import type { VerifierDefinition } from '@docstube/plugin-sdk';
import { runVerifier } from './run-support.ts';

const verifierId = 'internal-links';

export type MdxLink = { target: string; line: number };

// [text](target), [text](<target>), [text](target "title") — but not ![images](...).
const markdownLinkPattern = /(?<!!)\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/gu;
const anchorHrefPattern = /<a\b[^>]*?\bhref\s*=\s*["']([^"']+)["']/giu;

const lineOfIndex = (text: string, index: number): number => text.slice(0, index).split('\n').length;

export const findLinks = (mdx: string): MdxLink[] => {
  const links: MdxLink[] = [];
  for (const pattern of [markdownLinkPattern, anchorHrefPattern]) {
    pattern.lastIndex = 0;
    for (const match of mdx.matchAll(pattern)) {
      const target = match[1];
      if (target) {
        links.push({ target, line: lineOfIndex(mdx, match.index) });
      }
    }
  }
  return links;
};

// Any scheme URL (http:, https:, mailto:, tel:, …) and protocol-relative URLs are external —
// slugs never contain ':' or start with '//'.
const isExternalTarget = (target: string): boolean => /^[a-z][a-z0-9+.-]*:/iu.test(target) || target.startsWith('//');

const normalizeSlugTarget = (target: string): string => target.replace(/^\/+/u, '').replace(/\/+$/u, '');

export const internalLinksVerifier: VerifierDefinition = {
  id: verifierId,
  title: 'Internal links resolve',
  description:
    'Every internal link target must resolve to a page slug in the artifact set; same-page #anchors must match a section anchor. Cross-page anchors are not validated in v1.',
  scope: 'site',
  localeScope: 'per-locale',
  proves: true,
  verify: (_ctx, pages) =>
    runVerifier(verifierId, async () => {
      const slugs = new Set(pages.map((artifact) => artifact.page.slug));
      const findings: Finding[] = [];

      for (const artifact of pages) {
        const sectionAnchors = new Set(artifact.page.sections.map((section) => section.anchor));
        const entity = { version: artifact.version, locale: artifact.locale, pageId: artifact.page.id };

        for (const link of findLinks(artifact.mdx)) {
          if (isExternalTarget(link.target)) {
            continue;
          }

          if (link.target.startsWith('#')) {
            const anchor = link.target.slice(1);
            if (anchor !== '' && !sectionAnchors.has(anchor)) {
              findings.push({
                source: 'verifier',
                check: verifierId,
                severity: 'error',
                message: `dead same-page anchor "${link.target}" on page "${artifact.page.slug}": no section with anchor "${anchor}"`,
                entity,
                file: artifact.mdxPath,
                span: [link.line, link.line],
                data: { target: link.target, sourcePageId: artifact.page.id }
              });
            }
            continue;
          }

          // Only the path segment is resolved; anchors on other pages are out of scope here.
          const [pathPart = ''] = link.target.split('#');
          const slug = normalizeSlugTarget(pathPart);
          if (slug === '') {
            continue;
          }
          if (!slugs.has(slug)) {
            findings.push({
              source: 'verifier',
              check: verifierId,
              severity: 'error',
              message: `dead internal link "${link.target}" on page "${artifact.page.slug}": no page with slug "${slug}"`,
              entity,
              file: artifact.mdxPath,
              span: [link.line, link.line],
              data: { target: link.target, sourcePageId: artifact.page.id }
            });
          }
        }
      }

      return { findings, coveredEntityIds: pages.map((artifact) => artifact.page.id) };
    })
};
