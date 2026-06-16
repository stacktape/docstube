import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type EvalLabel = 'fail' | 'pass';

export type EvalExpectation = {
  mustContain: readonly string[];
  mustNotContain: readonly string[];
};

export type JudgeVsHumanEvalCase = {
  candidate: string;
  expect: EvalExpectation;
  humanLabel: EvalLabel;
  id: string;
  kind: 'judge-vs-human';
};

export type ComparativeEvalVariant = {
  candidate: string;
  expect: EvalExpectation;
  name: string;
};

export type ComparativeEvalCase = {
  expectedDelta: number;
  id: string;
  kind: 'context-ablation' | 'skill-comparison';
  variants: readonly ComparativeEvalVariant[];
};

export type GoldEvalCase = ComparativeEvalCase | JudgeVsHumanEvalCase;

export type GoldEvalSet = {
  cases: readonly GoldEvalCase[];
  thresholds: {
    minAgreement: number;
    minPassRate: number;
  };
  version: 1;
};

export type CandidateScore = {
  forbidden: readonly string[];
  label: EvalLabel;
  missing: readonly string[];
  score: number;
};

export type EvalCaseResult = {
  agreement?: boolean;
  id: string;
  kind: GoldEvalCase['kind'];
  passed: boolean;
  reason: string;
  scores: Record<string, CandidateScore>;
};

export type EvalRunSummary = {
  agreementRate: number;
  failed: number;
  live: boolean;
  passed: number;
  passRate: number;
  total: number;
};

export type EvalRunResult = {
  cases: readonly EvalCaseResult[];
  ok: boolean;
  summary: EvalRunSummary;
};

const defaultGoldSetPath = fileURLToPath(new URL('../../evals/gold-set.json', import.meta.url));
const defaultOutputPath = resolve('.docstube-build', 'evals', 'latest.json');

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const readString = (record: Record<string, unknown>, key: string): string => {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Invalid eval fixture: ${key} must be a non-empty string.`);
  }
  return value;
};

const readStringArray = (record: Record<string, unknown>, key: string): readonly string[] => {
  const value = record[key];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`Invalid eval fixture: ${key} must be an array of strings.`);
  }
  return value;
};

const parseExpectation = (value: unknown): EvalExpectation => {
  if (!isRecord(value)) {
    throw new Error('Invalid eval fixture: expect must be an object.');
  }
  return {
    mustContain: readStringArray(value, 'mustContain'),
    mustNotContain: readStringArray(value, 'mustNotContain')
  };
};

const parseVariant = (value: unknown): ComparativeEvalVariant => {
  if (!isRecord(value)) {
    throw new Error('Invalid eval fixture: variant must be an object.');
  }
  return {
    candidate: readString(value, 'candidate'),
    expect: parseExpectation(value.expect),
    name: readString(value, 'name')
  };
};

const parseEvalCase = (value: unknown): GoldEvalCase => {
  if (!isRecord(value)) {
    throw new Error('Invalid eval fixture: case must be an object.');
  }

  const id = readString(value, 'id');
  const kind = readString(value, 'kind');
  if (kind === 'judge-vs-human') {
    const humanLabel = readString(value, 'humanLabel');
    if (humanLabel !== 'pass' && humanLabel !== 'fail') {
      throw new Error(`Invalid eval fixture: ${id}.humanLabel must be pass or fail.`);
    }
    return {
      candidate: readString(value, 'candidate'),
      expect: parseExpectation(value.expect),
      humanLabel,
      id,
      kind
    };
  }

  if (kind !== 'context-ablation' && kind !== 'skill-comparison') {
    throw new Error(`Invalid eval fixture: unsupported kind ${kind}.`);
  }

  const variantsRaw = value.variants;
  if (!Array.isArray(variantsRaw) || variantsRaw.length !== 2) {
    throw new Error(`Invalid eval fixture: ${id}.variants must contain exactly two variants.`);
  }
  const expectedDelta = value.expectedDelta;
  if (typeof expectedDelta !== 'number' || expectedDelta < 0 || expectedDelta > 1) {
    throw new Error(`Invalid eval fixture: ${id}.expectedDelta must be between 0 and 1.`);
  }

  return {
    expectedDelta,
    id,
    kind,
    variants: variantsRaw.map(parseVariant)
  };
};

export const parseGoldEvalSet = (raw: unknown): GoldEvalSet => {
  if (!isRecord(raw)) {
    throw new Error('Invalid eval fixture: root must be an object.');
  }
  if (raw.version !== 1) {
    throw new Error('Invalid eval fixture: version must be 1.');
  }
  if (!isRecord(raw.thresholds)) {
    throw new Error('Invalid eval fixture: thresholds must be an object.');
  }
  const minAgreement = raw.thresholds.minAgreement;
  const minPassRate = raw.thresholds.minPassRate;
  if (typeof minAgreement !== 'number' || minAgreement < 0 || minAgreement > 1) {
    throw new Error('Invalid eval fixture: thresholds.minAgreement must be between 0 and 1.');
  }
  if (typeof minPassRate !== 'number' || minPassRate < 0 || minPassRate > 1) {
    throw new Error('Invalid eval fixture: thresholds.minPassRate must be between 0 and 1.');
  }
  if (!Array.isArray(raw.cases)) {
    throw new Error('Invalid eval fixture: cases must be an array.');
  }

  return {
    cases: raw.cases.map(parseEvalCase),
    thresholds: { minAgreement, minPassRate },
    version: 1
  };
};

const normalize = (value: string): string => value.toLowerCase().replace(/\s+/g, ' ').trim();

export const scoreCandidate = (candidate: string, expectation: EvalExpectation): CandidateScore => {
  const normalized = normalize(candidate);
  const missing = expectation.mustContain.filter((item) => !normalized.includes(normalize(item)));
  const forbidden = expectation.mustNotContain.filter((item) => normalized.includes(normalize(item)));
  const covered = expectation.mustContain.length - missing.length;
  const score = expectation.mustContain.length === 0 ? 1 : covered / expectation.mustContain.length;

  return {
    forbidden,
    label: missing.length === 0 && forbidden.length === 0 ? 'pass' : 'fail',
    missing,
    score
  };
};

const runJudgeVsHumanCase = (testCase: JudgeVsHumanEvalCase): EvalCaseResult => {
  const score = scoreCandidate(testCase.candidate, testCase.expect);
  const agreement = score.label === testCase.humanLabel;
  return {
    agreement,
    id: testCase.id,
    kind: testCase.kind,
    passed: agreement,
    reason: agreement ? 'judge agreed with human label' : `judge=${score.label}, human=${testCase.humanLabel}`,
    scores: { candidate: score }
  };
};

const runComparativeCase = (testCase: ComparativeEvalCase): EvalCaseResult => {
  const left = testCase.variants[0]!;
  const right = testCase.variants[1]!;
  const leftScore = scoreCandidate(left.candidate, left.expect);
  const rightScore = scoreCandidate(right.candidate, right.expect);
  const delta = leftScore.score - rightScore.score;
  const passed = leftScore.label === 'pass' && delta >= testCase.expectedDelta;

  return {
    id: testCase.id,
    kind: testCase.kind,
    passed,
    reason: passed
      ? `${left.name} beat ${right.name} by ${delta.toFixed(2)}`
      : `${left.name} delta ${delta.toFixed(2)} was below ${testCase.expectedDelta.toFixed(2)}`,
    scores: {
      [left.name]: leftScore,
      [right.name]: rightScore
    }
  };
};

export const runDeterministicEvals = (goldSet: GoldEvalSet, options: { live?: boolean } = {}): EvalRunResult => {
  const cases = goldSet.cases.map((testCase) =>
    testCase.kind === 'judge-vs-human' ? runJudgeVsHumanCase(testCase) : runComparativeCase(testCase)
  );
  const passed = cases.filter((testCase) => testCase.passed).length;
  const agreementCases = cases.filter((testCase) => typeof testCase.agreement === 'boolean');
  const agreements = agreementCases.filter((testCase) => testCase.agreement === true).length;
  const agreementRate = agreementCases.length === 0 ? 1 : agreements / agreementCases.length;
  const passRate = cases.length === 0 ? 1 : passed / cases.length;

  return {
    cases,
    ok: agreementRate >= goldSet.thresholds.minAgreement && passRate >= goldSet.thresholds.minPassRate,
    summary: {
      agreementRate,
      failed: cases.length - passed,
      live: options.live === true,
      passed,
      passRate,
      total: cases.length
    }
  };
};

const assertLiveGate = (): void => {
  const hasSecret =
    Boolean(process.env.DOCSTUBE_LIVE_EVAL_TOKEN) ||
    Boolean(process.env.OPENAI_API_KEY) ||
    Boolean(process.env.ANTHROPIC_API_KEY) ||
    Boolean(process.env.GEMINI_API_KEY);
  if (!hasSecret) {
    throw new Error('Live evals require DOCSTUBE_LIVE_EVAL_TOKEN or a provider API key.');
  }
};

export const runEvalFile = async (input: {
  goldSetPath?: string;
  live?: boolean;
  outputPath?: string;
}): Promise<EvalRunResult> => {
  if (input.live) {
    assertLiveGate();
  }

  const goldSet = parseGoldEvalSet(JSON.parse(await readFile(input.goldSetPath ?? defaultGoldSetPath, 'utf8')));
  const result = runDeterministicEvals(goldSet, { live: input.live });
  const outputPath = input.outputPath ?? defaultOutputPath;
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  return result;
};

const runDirectly = process.argv[1] ? fileURLToPath(import.meta.url) === process.argv[1] : false;

if (runDirectly) {
  const live = process.argv.includes('--live');
  const result = await runEvalFile({ live });
  console.info(
    `docstube evals: ${result.summary.passed}/${result.summary.total} passed, agreement ${result.summary.agreementRate.toFixed(2)}`
  );
  process.exitCode = result.ok ? 0 : 1;
}
