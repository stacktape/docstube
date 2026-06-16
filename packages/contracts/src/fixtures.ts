import type { ZodError, ZodType } from 'zod';
import {
  identifierSchema,
  jsonValueSchema,
  packageVersionSchema,
  relativePathSchema,
  semverSchema,
  severitySchema,
  timestampSchema
} from './primitives.ts';

// A path into a value, matching the shape of `ZodIssue['path']`.
export type IssuePath = ReadonlyArray<PropertyKey>;

export type ValidCase<T> = {
  name: string;
  value: T;
};

export type InvalidCase = {
  name: string;
  value: unknown;
  // Each entry is a path that must appear in `error.issues` for this case.
  expectedPaths: ReadonlyArray<IssuePath>;
};

export type ContractFixtures<T> = {
  schema: ZodType<T>;
  valid: ReadonlyArray<ValidCase<T>>;
  invalid: ReadonlyArray<InvalidCase>;
};

// Normalize a Zod error into the list of issue paths it reported.
export const issuePaths = (error: ZodError): IssuePath[] => error.issues.map((issue) => [...issue.path]);

const samePath = (left: IssuePath, right: IssuePath): boolean => {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((segment, index) => segment === right[index]);
};

// True when every expected path is present among the error's reported issue paths.
export const errorCoversPaths = (error: ZodError, expectedPaths: ReadonlyArray<IssuePath>): boolean => {
  const actual = issuePaths(error);
  return expectedPaths.every((expected) => actual.some((path) => samePath(path, expected)));
};

const root: ReadonlyArray<IssuePath> = [[]];

const identifierFixtures: ContractFixtures<string> = {
  schema: identifierSchema,
  valid: [
    { name: 'simple slug', value: 'getting-started' },
    { name: 'alphanumeric segments', value: 'api-v2-reference' }
  ],
  invalid: [
    { name: 'empty', value: '', expectedPaths: root },
    { name: 'uppercase', value: 'Getting-Started', expectedPaths: root },
    { name: 'leading hyphen', value: '-leading', expectedPaths: root },
    { name: 'underscore', value: 'snake_case', expectedPaths: root },
    { name: 'non-string', value: 42, expectedPaths: root }
  ]
};

const relativePathFixtures: ContractFixtures<string> = {
  schema: relativePathSchema,
  valid: [
    { name: 'nested posix path', value: 'src/contracts.ts' },
    { name: 'top-level file', value: 'docstube.yml' }
  ],
  invalid: [
    { name: 'empty', value: '', expectedPaths: root },
    { name: 'absolute posix', value: '/etc/passwd', expectedPaths: root },
    { name: 'absolute windows drive', value: 'C:/Users/congy/project', expectedPaths: root },
    { name: 'windows drive relative', value: 'C:project', expectedPaths: root },
    { name: 'backslash', value: 'src\\contracts.ts', expectedPaths: root },
    { name: 'traversal', value: '../secrets.env', expectedPaths: root }
  ]
};

const severityFixtures: ContractFixtures<'blocker' | 'major' | 'minor'> = {
  schema: severitySchema,
  valid: [
    { name: 'blocker', value: 'blocker' },
    { name: 'major', value: 'major' },
    { name: 'minor', value: 'minor' }
  ],
  invalid: [
    { name: 'unknown severity', value: 'critical', expectedPaths: root },
    { name: 'empty', value: '', expectedPaths: root }
  ]
};

const timestampFixtures: ContractFixtures<string> = {
  schema: timestampSchema,
  valid: [
    { name: 'utc', value: '2026-06-16T12:00:00Z' },
    { name: 'with offset', value: '2026-06-16T14:00:00+02:00' }
  ],
  invalid: [
    { name: 'date only', value: '2026-06-16', expectedPaths: root },
    { name: 'not a timestamp', value: 'yesterday', expectedPaths: root }
  ]
};

const jsonValueFixtures: ContractFixtures<unknown> = {
  schema: jsonValueSchema,
  valid: [
    { name: 'object', value: { ok: true, nested: { count: 1 } } },
    { name: 'array', value: [1, 'two', null] },
    { name: 'scalar', value: 'plain' }
  ],
  invalid: [
    { name: 'undefined', value: undefined, expectedPaths: root },
    { name: 'function', value: () => 1, expectedPaths: root }
  ]
};

const semverFixtures: ContractFixtures<string> = {
  schema: semverSchema,
  valid: [
    { name: 'release', value: '1.2.3' },
    { name: 'prerelease', value: '0.0.2-rc.1' }
  ],
  invalid: [
    { name: 'partial', value: '1.2', expectedPaths: root },
    { name: 'v-prefixed', value: 'v1.2.3', expectedPaths: root }
  ]
};

const packageVersionFixtures: ContractFixtures<{ name: string; version: string }> = {
  schema: packageVersionSchema,
  valid: [
    { name: 'scoped package', value: { name: '@docstube/contracts', version: '0.0.2' } },
    { name: 'unscoped package', value: { name: 'docstube', version: '1.0.0-beta.4' } }
  ],
  invalid: [
    { name: 'bad version', value: { name: 'docstube', version: 'latest' }, expectedPaths: [['version']] },
    { name: 'bad name', value: { name: 'Bad Name', version: '1.0.0' }, expectedPaths: [['name']] },
    { name: 'both invalid', value: { name: 'Bad Name', version: 'latest' }, expectedPaths: [['name'], ['version']] },
    { name: 'missing version', value: { name: 'docstube' }, expectedPaths: [['version']] }
  ]
};

// Registry of contract fixtures keyed by primitive name, for reuse across package tests.
export const contractFixtures = {
  identifier: identifierFixtures,
  relativePath: relativePathFixtures,
  severity: severityFixtures,
  timestamp: timestampFixtures,
  jsonValue: jsonValueFixtures,
  semver: semverFixtures,
  packageVersion: packageVersionFixtures
} as const;

export type ContractFixtureName = keyof typeof contractFixtures;
