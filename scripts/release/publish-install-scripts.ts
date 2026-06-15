import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';

type BucketType = 'preview' | 'production';

const parseArgs = () => {
  const args = process.argv.slice(2);
  const getValue = (name: string) => {
    const index = args.indexOf(`--${name}`);
    return index === -1 ? undefined : args[index + 1];
  };
  return {
    bucketType: (getValue('bucket-type') || 'production') as BucketType,
    projectName: getValue('project-name') || process.env.DOCSTUBE_STACKTAPE_PROJECT || 'docstube',
    region: getValue('region') || process.env.DOCSTUBE_STACKTAPE_REGION || 'eu-west-1',
    resourceName: getValue('resource-name') || process.env.DOCSTUBE_INSTALL_SCRIPTS_RESOURCE || 'installScripts',
    sourceDir: getValue('source-dir') || 'dist-release/install-scripts',
    stage: getValue('stage') || process.env.DOCSTUBE_STACKTAPE_STAGE,
    version: getValue('version')
  };
};

const getBucketName = (bucketType: BucketType) => {
  if (bucketType === 'preview') {
    return process.env.DOCSTUBE_INSTALL_SCRIPTS_PREVIEW_BUCKET || process.env.DOCSTUBE_INSTALL_SCRIPTS_BUCKET;
  }
  return process.env.DOCSTUBE_INSTALL_SCRIPTS_BUCKET;
};

const run = async (command: string, args: string[]) => {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, args, { shell: process.platform === 'win32', stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      reject(new Error(`${command} ${args.join(' ')} failed with exit code ${code}.`));
    });
  });
};

const main = async () => {
  const { bucketType, projectName, region, resourceName, sourceDir, stage, version } = parseArgs();
  const resolvedSourceDir = resolve(sourceDir);
  await stat(resolvedSourceDir);

  if (!version) {
    throw new Error('Missing --version.');
  }

  const bucketName = getBucketName(bucketType);
  if (bucketName) {
    await run('stacktape', [
      'bucket:sync',
      '--bucketId',
      bucketName,
      '--sourcePath',
      resolvedSourceDir,
      '--invalidateCdnCache',
      '--headersPreset',
      'static-website',
      '--region',
      region
    ]);

    console.info(`Published install scripts for ${version} to the ${bucketType} Stacktape bucket.`);
    return;
  }

  const stacktapeStage = stage || bucketType;
  await run('stacktape', [
    'bucket:sync',
    '--stage',
    stacktapeStage,
    '--projectName',
    projectName,
    '--resourceName',
    resourceName,
    '--invalidateCdnCache',
    '--region',
    region
  ]);

  console.info(`Published install scripts for ${version} to ${resourceName} in the ${stacktapeStage} Stacktape stage.`);
};

await main();
