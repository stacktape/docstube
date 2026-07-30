import type { DocType, DocstubeConfig, Ia, IaNode, Persona, TransportId } from '@docstube/contracts';
// Type-only imports straight from core source (same rationale as trpc-client.ts): erased at build
// time, so the core export map pointing at built output never matters here.
import type { OnboardingDraft, OnboardingDraftPatch } from '../../../packages/core/src/config/onboarding-draft.ts';
import type { ProjectDetection } from '../../../packages/core/src/detect/detect-project.ts';
import type { IaProposal, IaProposalId } from '../../../packages/core/src/pipeline/propose-ia.ts';

// The wizard store (PRODUCT §3.9.2): one reducer over all ten steps. The wizard is one editor
// among others — in edit mode it hydrates from the parsed config family and writes back diffs
// only; in scaffold mode it pre-fills from the deterministic detection engine (confident
// detections pre-fill, ambiguous fields stay blank — never guessed).

// Mirrors themeTokenNames in packages/core/src/pipeline/extract-theme-tokens.ts (type-only
// imports keep the bundle clean, so the value list is copied — keep the two in sync).
export const themeTokenNames = [
  'surface',
  'surface-muted',
  'surface-raised',
  'text',
  'text-muted',
  'border',
  'accent',
  'accent-strong',
  'success',
  'warning',
  'danger',
  'font-family'
] as const;
export type ThemeTokenName = (typeof themeTokenNames)[number];

// Mirrors builtinComponents in packages/theme/src/components.ts (names + one-line descriptions).
export const registryComponents: Array<{ name: string; description: string }> = [
  { name: 'Callout', description: 'Highlighted note, warning, success, or danger block.' },
  { name: 'CodeBlock', description: 'Single code sample with optional language and title.' },
  { name: 'CodeGroup', description: 'Grouped code samples for alternate languages or package managers.' },
  { name: 'Terminal', description: 'Terminal command and output block.' },
  { name: 'Card', description: 'Compact link or summary card.' },
  { name: 'CardGrid', description: 'Responsive grid for cards.' },
  { name: 'Steps', description: 'Ordered implementation or setup steps.' },
  { name: 'Tabs', description: 'Small mutually exclusive content panels.' },
  { name: 'FileTree', description: 'Repository file tree.' },
  { name: 'Badge', description: 'Inline status or category badge.' },
  { name: 'ParamTable', description: 'Parameter, option, or field table.' },
  { name: 'ComparisonTable', description: 'Feature or behavior comparison matrix.' }
];

// 'readme-com' is the ReadMe.com docs platform (mirrors importSourceKindSchema in contracts).
export type ImportSourceKind = 'mintlify' | 'gitbook' | 'readme-com' | 'confluence';
export const importSourceKinds: ImportSourceKind[] = ['mintlify', 'gitbook', 'readme-com', 'confluence'];
export type ImportSource = { kind: ImportSourceKind; location: string };

export type DepthBudget = 'overview' | 'standard' | 'deep';
export const depthBudgets: DepthBudget[] = ['overview', 'standard', 'deep'];

// Editor-side IA node: same shape as the contracts IaNode plus a stable uid the NavTree and the
// editing ops key off (IaNode itself has no id; slugs are user-editable so they cannot be one).
export type WizardIaNode = {
  uid: string;
  title: string;
  slug: string;
  brief: string;
  depth?: DepthBudget | undefined;
  pageId?: string | undefined;
  children: WizardIaNode[];
};

let uidCounter = 0;
export const mintUid = (): string => {
  uidCounter += 1;
  return `ia-${uidCounter}`;
};

export const slugify = (title: string): string => {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : 'page';
};

export const toEditorTree = (nodes: readonly IaNode[]): WizardIaNode[] =>
  nodes.map((node) => ({
    uid: mintUid(),
    title: node.title,
    slug: node.slug,
    brief: node.brief ?? '',
    depth: node.depth,
    pageId: node.pageId,
    children: toEditorTree(node.children ?? [])
  }));

export const toIaTree = (nodes: readonly WizardIaNode[]): IaNode[] =>
  nodes.map((node) => ({
    title: node.title,
    slug: node.slug,
    ...(node.brief.trim().length === 0 ? {} : { brief: node.brief }),
    ...(node.depth === undefined ? {} : { depth: node.depth }),
    ...(node.pageId === undefined ? {} : { pageId: node.pageId }),
    ...(node.children.length === 0 ? {} : { children: toIaTree(node.children) })
  }));

export const findIaNode = (nodes: readonly WizardIaNode[], uid: string): WizardIaNode | undefined => {
  for (const node of nodes) {
    if (node.uid === uid) {
      return node;
    }
    const inChildren = findIaNode(node.children, uid);
    if (inChildren !== undefined) {
      return inChildren;
    }
  }
  return undefined;
};

export const countIaNodes = (nodes: readonly WizardIaNode[]): number =>
  nodes.reduce((sum, node) => sum + 1 + countIaNodes(node.children), 0);

export type IaEditOp =
  | { kind: 'update'; uid: string; patch: Partial<Pick<WizardIaNode, 'title' | 'slug' | 'brief' | 'depth'>> }
  // uid undefined = add a new top-level node.
  | { kind: 'add-child'; uid: string | undefined }
  | { kind: 'add-sibling'; uid: string }
  | { kind: 'remove'; uid: string }
  | { kind: 'move'; uid: string; direction: 'up' | 'down' }
  // Button-based reparenting (drag-and-drop is a later polish pass): indent makes the node a
  // child of its previous sibling; outdent lifts it next to its parent.
  | { kind: 'indent'; uid: string }
  | { kind: 'outdent'; uid: string };

const newIaNode = (): WizardIaNode => ({
  uid: mintUid(),
  title: 'New page',
  slug: 'new-page',
  brief: '',
  children: []
});

const mapNodes = (nodes: WizardIaNode[], fn: (node: WizardIaNode) => WizardIaNode): WizardIaNode[] =>
  nodes.map((node) => {
    const mapped = fn(node);
    return { ...mapped, children: mapNodes(mapped.children, fn) };
  });

// Finds the sibling list containing `uid` (at any depth) and replaces it with `edit(list, index)`.
const editSiblingList = (
  nodes: WizardIaNode[],
  uid: string,
  edit: (list: WizardIaNode[], index: number) => WizardIaNode[]
): WizardIaNode[] => {
  const index = nodes.findIndex((node) => node.uid === uid);
  if (index !== -1) {
    return edit(nodes, index);
  }
  return nodes.map((node) => {
    const children = editSiblingList(node.children, uid, edit);
    return children === node.children ? node : { ...node, children };
  });
};

const outdentNode = (nodes: WizardIaNode[], uid: string): WizardIaNode[] => {
  const parentIndex = nodes.findIndex((node) => node.children.some((child) => child.uid === uid));
  if (parentIndex !== -1) {
    const parent = nodes[parentIndex] as WizardIaNode;
    const childIndex = parent.children.findIndex((child) => child.uid === uid);
    const child = parent.children[childIndex] as WizardIaNode;
    const withoutChild = { ...parent, children: parent.children.toSpliced(childIndex, 1) };
    return nodes.toSpliced(parentIndex, 1, withoutChild).toSpliced(parentIndex + 1, 0, child);
  }
  return nodes.map((node) => {
    const children = outdentNode(node.children, uid);
    return children === node.children ? node : { ...node, children };
  });
};

export const applyIaOp = (tree: WizardIaNode[], op: IaEditOp): WizardIaNode[] => {
  switch (op.kind) {
    case 'update':
      return mapNodes(tree, (node) => (node.uid === op.uid ? { ...node, ...op.patch } : node));
    case 'add-child':
      if (op.uid === undefined) {
        return [...tree, newIaNode()];
      }
      return mapNodes(tree, (node) =>
        node.uid === op.uid ? { ...node, children: [...node.children, newIaNode()] } : node
      );
    case 'add-sibling':
      return editSiblingList(tree, op.uid, (list, index) => list.toSpliced(index + 1, 0, newIaNode()));
    case 'remove':
      return editSiblingList(tree, op.uid, (list, index) => list.toSpliced(index, 1));
    case 'move':
      return editSiblingList(tree, op.uid, (list, index) => {
        const target = op.direction === 'up' ? index - 1 : index + 1;
        if (target < 0 || target >= list.length) {
          return list;
        }
        const moved = list[index] as WizardIaNode;
        return list.toSpliced(index, 1).toSpliced(target, 0, moved);
      });
    case 'indent':
      return editSiblingList(tree, op.uid, (list, index) => {
        if (index === 0) {
          return list;
        }
        const previous = list[index - 1] as WizardIaNode;
        const moved = list[index] as WizardIaNode;
        const merged = { ...previous, children: [...previous.children, moved] };
        return list.toSpliced(index - 1, 2, merged);
      });
    case 'outdent':
      return outdentNode(tree, op.uid);
  }
};

export type IaChoice = IaProposalId | 'custom' | undefined;

// Mirrors defaultModels in packages/core/src/pipeline/task-runner.ts: every other transport makes
// createTransportFromConfig throw without an explicit model, so setup must ask for one rather than
// let the user reach Generate with a config that cannot build a transport.
export const transportsWithDefaultModel: readonly TransportId[] = ['claude-cli', 'anthropic-api'];

export const wizardStepIds = [
  'doc-type',
  'context',
  'personas',
  'sources',
  // The provider comes BEFORE the IA step: proposing an IA is an agent call, and it runs on
  // whatever the draft says the provider is.
  'agent',
  'ia',
  'versions',
  'theme',
  'metadata',
  'components',
  'start'
] as const;
export type WizardStepId = (typeof wizardStepIds)[number];

export const wizardStepTitles: Record<WizardStepId, string> = {
  'doc-type': 'Doc type',
  context: 'Project context',
  personas: 'Personas',
  sources: 'Sources',
  agent: 'Agent provider',
  ia: 'Information architecture',
  versions: 'Versions & locales',
  theme: 'Theme',
  metadata: 'Site metadata',
  components: 'Components',
  start: 'Start'
};

export type AgentDraftState = {
  transport: TransportId | undefined;
  model: string;
  apiKeyEnv: string;
  baseUrl: string;
};

export type WizardState = {
  hydrated: boolean;
  mode: 'scaffold' | 'edit';
  step: number;
  agent: AgentDraftState;
  // Last preflight outcome, shown on the Generate step. Never faked: undefined until one ran.
  preflight: { ok: boolean; detail: string } | undefined;
  docType: DocType | undefined;
  projectContext: string;
  personas: Persona[];
  openapi: string[];
  asyncapi: string[];
  imports: ImportSource[];
  iaTree: WizardIaNode[];
  iaChoice: IaChoice;
  proposals: IaProposal[];
  proposalWarnings: string[];
  pageCountTarget: number | undefined;
  selectedIaUid: string | undefined;
  currentVersion: string;
  frozenVersions: string[];
  sourceLocale: string;
  targetLocales: string[];
  themeTokens: Record<string, string>;
  siteTitle: string;
  siteDescription: string;
  logo: string;
  favicon: string;
  components: string[];
  // Edit-mode diff bases, captured at hydration.
  baselineConfig: Record<string, string> | undefined;
  baselineIa: string | undefined;
};

const emptyTokens = (): Record<string, string> => Object.fromEntries(themeTokenNames.map((name) => [name, '']));

export const emptyAgentDraft = (): AgentDraftState => ({
  transport: undefined,
  model: '',
  apiKeyEnv: '',
  baseUrl: ''
});

export const initialWizardState = (): WizardState => ({
  hydrated: false,
  mode: 'scaffold',
  step: 0,
  agent: emptyAgentDraft(),
  preflight: undefined,
  docType: undefined,
  projectContext: '',
  personas: [],
  openapi: [],
  asyncapi: [],
  imports: [],
  iaTree: [],
  iaChoice: undefined,
  proposals: [],
  proposalWarnings: [],
  pageCountTarget: undefined,
  selectedIaUid: undefined,
  currentVersion: 'latest',
  frozenVersions: [],
  sourceLocale: 'en',
  targetLocales: [],
  themeTokens: emptyTokens(),
  siteTitle: '',
  siteDescription: '',
  logo: '',
  favicon: '',
  components: registryComponents.map((component) => component.name),
  baselineConfig: undefined,
  baselineIa: undefined
});

export type HydrationInput = {
  family: { config: DocstubeConfig; ia: Ia } | undefined;
  detection: { detection: ProjectDetection; suggestedPersonas: Persona[] } | undefined;
  // The autosaved onboarding draft. Wins over detection (it IS the user's own in-progress intent)
  // and loses to committed config (which is the shared truth).
  draft?: OnboardingDraft | undefined;
};

export type WizardAction =
  | ({ type: 'hydrate' } & HydrationInput)
  | { type: 'go-to-step'; step: number }
  | { type: 'set-transport'; transport: TransportId; model?: string | undefined; apiKeyEnv?: string | undefined }
  | { type: 'set-agent-field'; field: 'model' | 'apiKeyEnv' | 'baseUrl'; value: string }
  | { type: 'set-preflight'; result: { ok: boolean; detail: string } | undefined }
  | { type: 'set-doc-type'; docType: DocType }
  | { type: 'set-project-context'; value: string }
  | { type: 'set-personas'; personas: Persona[] }
  | { type: 'set-source-paths'; field: 'openapi' | 'asyncapi'; values: string[] }
  | { type: 'set-imports'; imports: ImportSource[] }
  | { type: 'set-proposals'; proposals: IaProposal[]; warnings: string[] }
  | { type: 'adopt-proposal'; proposal: IaProposal }
  | { type: 'mark-ia-custom' }
  | { type: 'select-ia-node'; uid: string | undefined }
  | { type: 'ia-edit'; op: IaEditOp }
  | { type: 'set-version'; value: string }
  | { type: 'set-source-locale'; value: string }
  | { type: 'set-target-locales'; values: string[] }
  | { type: 'set-theme-token'; name: string; value: string }
  | { type: 'merge-theme-tokens'; tokens: Record<string, string> }
  | { type: 'set-site-field'; field: 'siteTitle' | 'siteDescription' | 'logo' | 'favicon'; value: string }
  | { type: 'toggle-component'; name: string };

const filteredTokens = (tokens: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(tokens).filter(([, value]) => value.trim().length > 0));

type ConfigPair = { path: Array<string | number>; value: unknown };

// Intent only: fields the user never touched stay absent so docstube.yml carries the choice, not
// an expanded default. The credential itself is never here — only the env-var NAME.
export const agentsValue = (agent: AgentDraftState): Record<string, string> => ({
  ...(agent.transport === undefined ? {} : { transport: agent.transport }),
  ...(agent.model.trim().length === 0 ? {} : { model: agent.model.trim() }),
  ...(agent.apiKeyEnv.trim().length === 0 ? {} : { apiKeyEnv: agent.apiKeyEnv.trim() }),
  ...(agent.baseUrl.trim().length === 0 ? {} : { baseUrl: agent.baseUrl.trim() })
});

// The full set of config values the wizard owns, as comment-preserving update paths. Edit mode
// diffs these against the hydration baseline and sends only what changed.
export const configPairs = (state: WizardState): ConfigPair[] => [
  { path: ['docType'], value: state.docType },
  { path: ['projectContext'], value: state.projectContext },
  { path: ['personas'], value: state.personas },
  { path: ['sources', 'openapi'], value: state.openapi },
  { path: ['sources', 'asyncapi'], value: state.asyncapi },
  { path: ['sources', 'imports'], value: state.imports },
  ...Object.entries(agentsValue(state.agent)).map(([key, value]) => ({ path: ['agents', key], value })),
  { path: ['versions', 'current'], value: state.currentVersion },
  { path: ['locales', 'source'], value: state.sourceLocale },
  { path: ['locales', 'targets'], value: state.targetLocales },
  { path: ['theme', 'tokens'], value: filteredTokens(state.themeTokens) },
  ...(state.logo.trim().length === 0 ? [] : [{ path: ['site', 'logo'], value: state.logo }]),
  ...(state.favicon.trim().length === 0 ? [] : [{ path: ['site', 'favicon'], value: state.favicon }]),
  { path: ['site', 'title'], value: state.siteTitle },
  { path: ['site', 'description'], value: state.siteDescription },
  { path: ['components'], value: state.components }
];

const snapshotOf = (state: WizardState): Record<string, string> =>
  Object.fromEntries(configPairs(state).map((pair) => [pair.path.join('.'), JSON.stringify(pair.value)]));

export const buildConfigUpdates = (state: WizardState): ConfigPair[] =>
  configPairs(state).filter((pair) => state.baselineConfig?.[pair.path.join('.')] !== JSON.stringify(pair.value));

export const buildIa = (state: WizardState): Ia => ({
  schemaVersion: 1,
  tree: toIaTree(state.iaTree),
  ...(state.pageCountTarget === undefined ? {} : { pageCountTarget: state.pageCountTarget })
});

export const iaChanged = (state: WizardState): boolean => JSON.stringify(buildIa(state)) !== state.baselineIa;

// Scaffold seed: intent only — optional groups are omitted when untouched so the written
// docstube.yml carries what the user chose, not expanded defaults.
export const buildConfigInput = (state: WizardState): Record<string, unknown> => {
  const tokens = filteredTokens(state.themeTokens);
  const hasSources = state.openapi.length > 0 || state.asyncapi.length > 0 || state.imports.length > 0;
  const agents = agentsValue(state.agent);
  return {
    schemaVersion: 1,
    docType: state.docType,
    ...(state.projectContext.trim().length === 0 ? {} : { projectContext: state.projectContext }),
    personas: state.personas,
    ...(hasSources ? { sources: { openapi: state.openapi, asyncapi: state.asyncapi, imports: state.imports } } : {}),
    ...(Object.keys(agents).length === 0 ? {} : { agents }),
    versions: { current: state.currentVersion, frozen: state.frozenVersions },
    locales: { source: state.sourceLocale, targets: state.targetLocales },
    // The theme name is always written explicitly (knowledge/design/theming.md): a later change
    // of the shipped default must never restyle an already-scaffolded repo.
    theme: { name: 'basic', ...(Object.keys(tokens).length > 0 ? { tokens } : {}) },
    // logo/favicon are SITE metadata (matching configPairs above); the strict theme schema is
    // tokens-only and rejects them.
    site: {
      title: state.siteTitle,
      ...(state.siteDescription.trim().length === 0 ? {} : { description: state.siteDescription }),
      ...(state.logo.trim().length === 0 ? {} : { logo: state.logo }),
      ...(state.favicon.trim().length === 0 ? {} : { favicon: state.favicon })
    },
    components: state.components
  };
};

const personaIdPattern = /^[a-z][a-z0-9-]*$/;
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const versionLabelPattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
// Mirrors localeCodeSchema in contracts: language, optional script subtag, optional region.
const localePattern = /^[a-z]{2,3}(-[A-Z][a-z]{3})?(-[A-Z]{2})?$/;

const isRepoRelativePath = (value: string): boolean =>
  value.length > 0 && !value.includes('\\') && !value.startsWith('/') && !/^[A-Za-z]:/.test(value);

const iaTreeIssues = (nodes: readonly WizardIaNode[]): string[] => {
  const issues: string[] = [];
  for (const node of nodes) {
    if (node.title.trim().length === 0) {
      issues.push('Every IA node needs a title.');
    }
    if (!slugPattern.test(node.slug)) {
      issues.push(`Slug "${node.slug}" must be lowercase and hyphen-separated (a-z, 0-9).`);
    }
    issues.push(...iaTreeIssues(node.children));
  }
  return issues;
};

// Per-step validation. The rail allows free navigation; Next and Start are gated on these.
export const stepIssues = (state: WizardState, stepId: WizardStepId): string[] => {
  switch (stepId) {
    case 'doc-type':
      return state.docType === undefined ? ['Choose a doc type.'] : [];
    case 'personas': {
      if (state.personas.length === 0) {
        return ['Add at least one persona.'];
      }
      const issues: string[] = [];
      for (const persona of state.personas) {
        if (!personaIdPattern.test(persona.id)) {
          issues.push(`Persona id "${persona.id}" must be lowercase letters, digits, and hyphens.`);
        }
        if (persona.description.trim().length === 0) {
          issues.push(`Persona "${persona.id}" needs a description.`);
        }
      }
      return issues;
    }
    case 'sources': {
      const issues: string[] = [];
      for (const path of [...state.openapi, ...state.asyncapi]) {
        if (!isRepoRelativePath(path)) {
          issues.push(`Spec path "${path}" must be a repo-relative POSIX path.`);
        }
      }
      for (const entry of state.imports) {
        if (entry.location.trim().length === 0) {
          issues.push('Every importer entry needs a location.');
        }
      }
      return issues;
    }
    case 'agent': {
      if (state.agent.transport === undefined) {
        return ['Choose the agent provider docstube should run on.'];
      }
      const issues: string[] = [];
      if (!transportsWithDefaultModel.includes(state.agent.transport) && state.agent.model.trim().length === 0) {
        issues.push(`The ${state.agent.transport} transport has no default model — name the model to use.`);
      }
      if (state.agent.apiKeyEnv.trim().length > 0 && !/^[A-Z][A-Z0-9_]*$/.test(state.agent.apiKeyEnv.trim())) {
        issues.push('The credential env var must be an UPPER_SNAKE_CASE name (the name, never the key itself).');
      }
      return issues;
    }
    case 'ia':
      if (state.iaTree.length === 0) {
        return ['Add at least one page to the information architecture.'];
      }
      return [...new Set(iaTreeIssues(state.iaTree))];
    case 'versions': {
      const issues: string[] = [];
      if (!versionLabelPattern.test(state.currentVersion)) {
        issues.push('Current version must be a path-safe label like "latest", "1.x", or "v2".');
      }
      if (!localePattern.test(state.sourceLocale)) {
        issues.push('Source locale must look like "en" or "pt-BR".');
      }
      for (const locale of state.targetLocales) {
        if (!localePattern.test(locale)) {
          issues.push(`Target locale "${locale}" must look like "en" or "pt-BR".`);
        }
      }
      return issues;
    }
    case 'metadata':
      return state.siteTitle.trim().length === 0 ? ['Give the site a title.'] : [];
    default:
      return [];
  }
};

export const allIssues = (state: WizardState): Array<{ stepId: WizardStepId; issue: string }> =>
  wizardStepIds.flatMap((stepId) => stepIssues(state, stepId).map((issue) => ({ stepId, issue })));

const hydrateFromFamily = (state: WizardState, config: DocstubeConfig, ia: Ia): WizardState => {
  const next: WizardState = {
    ...state,
    hydrated: true,
    mode: 'edit',
    agent: {
      transport: config.agents.transport,
      model: config.agents.model ?? '',
      apiKeyEnv: config.agents.apiKeyEnv ?? '',
      baseUrl: config.agents.baseUrl ?? ''
    },
    docType: config.docType,
    projectContext: config.projectContext,
    personas: config.personas.map((persona) => ({ ...persona })),
    openapi: [...config.sources.openapi],
    asyncapi: [...config.sources.asyncapi],
    imports: config.sources.imports.map((entry) => ({ ...entry })),
    iaTree: toEditorTree(ia.tree),
    // An existing IA is user-owned — never re-attributed to a proposal.
    iaChoice: 'custom',
    pageCountTarget: ia.pageCountTarget,
    currentVersion: config.versions.current,
    frozenVersions: [...config.versions.frozen],
    sourceLocale: config.locales.source,
    targetLocales: [...config.locales.targets],
    themeTokens: { ...emptyTokens(), ...config.theme.tokens },
    logo: config.site.logo ?? '',
    favicon: config.site.favicon ?? '',
    siteTitle: config.site.title,
    siteDescription: config.site.description,
    components: [...config.components]
  };
  return { ...next, baselineConfig: snapshotOf(next), baselineIa: JSON.stringify(buildIa(next)) };
};

const hydrateFromDetection = (
  state: WizardState,
  detection: ProjectDetection | undefined,
  suggestedPersonas: Persona[]
): WizardState => ({
  ...state,
  hydrated: true,
  mode: 'scaffold',
  docType: detection?.docType,
  projectContext: detection?.projectContext ?? '',
  personas: suggestedPersonas.map((persona) => ({ ...persona })),
  openapi: detection?.openapiSpecs ?? [],
  asyncapi: detection?.asyncapiSpecs ?? [],
  siteTitle: detection?.siteTitle ?? ''
});

// Resume from the autosaved draft. Detection has already pre-filled `state`, so this only
// overlays what the user actually decided — a refresh or a crash mid-setup resumes instead of
// restarting, which is the whole point of the draft.
const hydrateFromDraft = (state: WizardState, draft: OnboardingDraft): WizardState => {
  type ConfigIntent = {
    docType?: DocType;
    projectContext?: string;
    personas?: Persona[];
    sources?: { openapi?: string[]; asyncapi?: string[]; imports?: ImportSource[] };
    versions?: { current?: string; frozen?: string[] };
    locales?: { source?: string; targets?: string[] };
    theme?: { tokens?: Record<string, string> };
    site?: { title?: string; description?: string; logo?: string; favicon?: string };
    components?: string[];
  };
  const intent = draft.config as ConfigIntent;
  const ia = draft.ia as { tree?: IaNode[]; pageCountTarget?: number } | undefined;
  return {
    ...state,
    step: draft.step ?? state.step,
    agent: {
      transport: draft.agents.transport ?? state.agent.transport,
      model: draft.agents.model ?? state.agent.model,
      apiKeyEnv: draft.agents.apiKeyEnv ?? state.agent.apiKeyEnv,
      baseUrl: draft.agents.baseUrl ?? state.agent.baseUrl
    },
    preflight:
      draft.preflight === undefined ? state.preflight : { ok: draft.preflight.ok, detail: draft.preflight.detail },
    docType: intent.docType ?? state.docType,
    projectContext: intent.projectContext ?? state.projectContext,
    personas: intent.personas ?? state.personas,
    openapi: intent.sources?.openapi ?? state.openapi,
    asyncapi: intent.sources?.asyncapi ?? state.asyncapi,
    imports: intent.sources?.imports ?? state.imports,
    iaTree: ia?.tree === undefined ? state.iaTree : toEditorTree(ia.tree),
    iaChoice: ia?.tree === undefined ? state.iaChoice : 'custom',
    pageCountTarget: ia?.pageCountTarget ?? state.pageCountTarget,
    currentVersion: intent.versions?.current ?? state.currentVersion,
    frozenVersions: intent.versions?.frozen ?? state.frozenVersions,
    sourceLocale: intent.locales?.source ?? state.sourceLocale,
    targetLocales: intent.locales?.targets ?? state.targetLocales,
    themeTokens: { ...state.themeTokens, ...intent.theme?.tokens },
    siteTitle: intent.site?.title ?? state.siteTitle,
    siteDescription: intent.site?.description ?? state.siteDescription,
    logo: intent.site?.logo ?? state.logo,
    favicon: intent.site?.favicon ?? state.favicon,
    components: intent.components ?? state.components
  };
};

// What the setup UI autosaves after every change. `config`/`ia` are the same intent the commit
// step will write — held machine-locally until the user actually commits.
export const draftPatch = (state: WizardState): OnboardingDraftPatch => ({
  step: state.step,
  agents: {
    ...(state.agent.transport === undefined ? {} : { transport: state.agent.transport }),
    ...(state.agent.model.trim().length === 0 ? {} : { model: state.agent.model.trim() }),
    ...(state.agent.apiKeyEnv.trim().length === 0 ? {} : { apiKeyEnv: state.agent.apiKeyEnv.trim() }),
    ...(state.agent.baseUrl.trim().length === 0 ? {} : { baseUrl: state.agent.baseUrl.trim() })
  },
  config: buildConfigInput(state),
  ia: buildIa(state) as unknown as Record<string, unknown>
});

export const wizardReducer = (state: WizardState, action: WizardAction): WizardState => {
  switch (action.type) {
    case 'hydrate': {
      if (state.hydrated) {
        return state;
      }
      // Committed config is the shared truth: when it exists the wizard is an EDITOR of it, and a
      // leftover draft must never shadow the file everything else reads.
      if (action.family !== undefined) {
        return hydrateFromFamily(state, action.family.config, action.family.ia);
      }
      const detected = hydrateFromDetection(
        state,
        action.detection?.detection,
        action.detection?.suggestedPersonas ?? []
      );
      return action.draft === undefined ? detected : hydrateFromDraft(detected, action.draft);
    }
    case 'set-transport':
      return {
        ...state,
        agent: {
          ...state.agent,
          transport: action.transport,
          model: action.model ?? state.agent.model,
          apiKeyEnv: action.apiKeyEnv ?? state.agent.apiKeyEnv
        },
        // A different provider invalidates the previous provider's proof.
        preflight: undefined
      };
    case 'set-agent-field':
      return { ...state, agent: { ...state.agent, [action.field]: action.value }, preflight: undefined };
    case 'set-preflight':
      return { ...state, preflight: action.result };
    case 'go-to-step':
      return { ...state, step: Math.min(Math.max(action.step, 0), wizardStepIds.length - 1) };
    case 'set-doc-type':
      return { ...state, docType: action.docType };
    case 'set-project-context':
      return { ...state, projectContext: action.value };
    case 'set-personas':
      return { ...state, personas: action.personas };
    case 'set-source-paths':
      return { ...state, [action.field]: action.values };
    case 'set-imports':
      return { ...state, imports: action.imports };
    case 'set-proposals':
      return { ...state, proposals: action.proposals, proposalWarnings: action.warnings };
    case 'adopt-proposal':
      return {
        ...state,
        iaTree: toEditorTree(action.proposal.ia.tree),
        iaChoice: action.proposal.id,
        pageCountTarget: action.proposal.ia.pageCountTarget,
        selectedIaUid: undefined
      };
    case 'mark-ia-custom':
      return { ...state, iaChoice: 'custom' };
    case 'select-ia-node':
      return { ...state, selectedIaUid: action.uid };
    case 'ia-edit': {
      const iaTree = applyIaOp(state.iaTree, action.op);
      const selectedIaUid =
        action.op.kind === 'remove' && state.selectedIaUid === action.op.uid ? undefined : state.selectedIaUid;
      // ANY edit forks the segmented control to "Custom" (PRODUCT §3.9.2 step 5).
      return { ...state, iaTree, iaChoice: 'custom', selectedIaUid };
    }
    case 'set-version':
      return { ...state, currentVersion: action.value };
    case 'set-source-locale':
      return { ...state, sourceLocale: action.value };
    case 'set-target-locales':
      return { ...state, targetLocales: action.values };
    case 'set-theme-token':
      return { ...state, themeTokens: { ...state.themeTokens, [action.name]: action.value } };
    case 'merge-theme-tokens':
      return { ...state, themeTokens: { ...state.themeTokens, ...action.tokens } };
    case 'set-site-field':
      return { ...state, [action.field]: action.value };
    case 'toggle-component':
      return {
        ...state,
        components: state.components.includes(action.name)
          ? state.components.filter((name) => name !== action.name)
          : [...state.components, action.name]
      };
  }
};
