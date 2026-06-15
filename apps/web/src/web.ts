import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export const webWorkstreamOwner = 'another-agent';

const buildPlaceholder = async () => {
  const distDir = resolve(import.meta.dirname, '../dist');
  await mkdir(distDir, { recursive: true });
  await writeFile(
    resolve(distDir, 'index.html'),
    [
      '<!doctype html>',
      '<html lang="en">',
      '<head>',
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      '<title>docstube</title>',
      '</head>',
      '<body>',
      '<main>',
      '<h1>docstube</h1>',
      '<p>Marketing website implementation is handled by another workstream.</p>',
      '</main>',
      '</body>',
      '</html>'
    ].join('')
  );
};

await buildPlaceholder();
