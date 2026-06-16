import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = fileURLToPath(new URL('..', import.meta.url));
const distDir = join(rootDir, 'dist');
const siteName = 'docstube fixture';
const siteDescription = 'Generated docs fixture.';
const siteUrl = 'https://docs.example.test';
const navItems = [
  { href: '/', label: 'Overview' },
  { href: '/credit-disabled/', label: 'Credit Disabled' },
  { href: '/glossary/', label: 'Glossary' },
  { href: '/guides/install/', label: 'Install' }
];

const collectHtmlFiles = async (currentDir = distDir) => {
  const entries = await readdir(currentDir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      if (entry.name === 'pagefind') {
        return [];
      }
      const entryPath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        return collectHtmlFiles(entryPath);
      }
      return entry.isFile() && entry.name.endsWith('.html') ? [entryPath] : [];
    })
  );
  return files.flat().toSorted((left, right) => left.localeCompare(right));
};

const pageUrlFromFile = (file) => {
  const normalized = relative(distDir, file).replaceAll('\\', '/');
  if (normalized === 'index.html') {
    return '/';
  }
  return `/${normalized.replace(/\/?index\.html$/u, '')}/`;
};

const textFromHtml = (html) =>
  html
    .replaceAll(/<script[\s\S]*?<\/script>/giu, ' ')
    .replaceAll(/<style[\s\S]*?<\/style>/giu, ' ')
    .replaceAll(/<[^>]+>/gu, ' ')
    .replaceAll(/\s+/gu, ' ')
    .trim();

const pagesFromHtml = async () => {
  const byUrl = new Map(navItems.map((item) => [item.href, item]));
  return Promise.all(
    (await collectHtmlFiles()).map(async (file) => {
      const url = pageUrlFromFile(file);
      const html = await readFile(file, 'utf8');
      return {
        title: byUrl.get(url)?.label ?? url,
        url,
        description: siteDescription,
        content: textFromHtml(html)
      };
    })
  );
};

const normalizeUrl = (url) => (url.startsWith('/') ? url : `/${url}`);

const createLlmsText = (pages) => {
  const lines = [`# ${siteName}`, '', `> ${siteDescription}`, '', '## Docs'];
  for (const page of pages.toSorted((left, right) => left.url.localeCompare(right.url))) {
    lines.push(`- [${page.title}](${normalizeUrl(page.url)}): ${page.description}`);
  }
  return `${lines.join('\n')}\n`;
};

const createLlmsFullText = (pages) => {
  const lines = [`# ${siteName}`, '', `> ${siteDescription}`, ''];
  for (const page of pages.toSorted((left, right) => left.url.localeCompare(right.url))) {
    lines.push(`## ${page.title}`, '', `URL: ${normalizeUrl(page.url)}`, '', page.content, '');
  }
  return `${lines.join('\n').trim()}\n`;
};

const createSitemapXml = (pages) =>
  [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...pages
      .toSorted((left, right) => left.url.localeCompare(right.url))
      .flatMap((page) => ['  <url>', `    <loc>${siteUrl}${page.url}</loc>`, '  </url>']),
    '</urlset>',
    ''
  ].join('\n');

const writeTextFile = async (path, content) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, 'utf8');
};

const buildPagefind = async () => {
  const pagefind = await import('pagefind');
  const response = await pagefind.createIndex({ rootSelector: '[data-pagefind-body]' });
  if (!response.index) {
    await pagefind.close();
    throw new Error(`Pagefind index creation failed: ${response.errors.join('; ')}`);
  }
  try {
    const indexed = await response.index.addDirectory({ path: distDir, glob: '**/*.html' });
    const written = await response.index.writeFiles({ outputPath: join(distDir, 'pagefind') });
    const errors = [...response.errors, ...indexed.errors, ...written.errors];
    if (errors.length > 0) {
      throw new Error(`Pagefind failed: ${errors.join('; ')}`);
    }
  } finally {
    await response.index.deleteIndex();
    await pagefind.close();
  }
};

const pages = await pagesFromHtml();
await Promise.all([
  writeTextFile(join(distDir, 'llms.txt'), createLlmsText(pages)),
  writeTextFile(join(distDir, 'llms-full.txt'), createLlmsFullText(pages)),
  writeTextFile(join(distDir, 'sitemap.xml'), createSitemapXml(pages))
]);
await buildPagefind();
