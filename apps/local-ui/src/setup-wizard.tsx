import { Check, FolderTree, Palette, Plus, Save, Settings2, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import type {
  AgentAdapterKind,
  AgentChoice,
  AgentsConfig,
  ApiProvider,
  DocstubeConfig,
  DocsType,
  Ia,
  IaNode,
  Layout,
  Persona,
  SourceReference,
  UsageCaps
} from '@docstube/contracts';

export type ThemeTokensDraft = Record<string, string | number>;

export type SetupWizardSaveInput = {
  config: DocstubeConfig;
  ia: Ia;
  themeTokens: ThemeTokensDraft;
};

export type SetupWizardProps = {
  initialConfig: DocstubeConfig;
  initialIa: Ia;
  initialThemeTokens?: ThemeTokensDraft;
  onSave?: (input: SetupWizardSaveInput) => Promise<void> | void;
};

type NodePath = readonly number[];

type NavTreeProps = {
  nodes: readonly IaNode[];
  onAddChild: (path: NodePath) => void;
  onRemove: (path: NodePath) => void;
  onUpdate: (path: NodePath, value: Partial<IaNode>) => void;
};

type ThemeTokenEditorProps = {
  onChange: (tokens: ThemeTokensDraft) => void;
  tokens: ThemeTokensDraft;
};

const defaultThemeTokens: ThemeTokensDraft = {
  accent: '#2563eb',
  surface: '#f8fafc',
  radius: 8
};

const docsTypeOptions = ['library', 'application', 'api', 'cli', 'service'] as const satisfies readonly DocsType[];
const layoutOptions = ['single-tree', 'sectioned'] as const satisfies readonly Layout[];
const agentAdapters = ['codex', 'claude', 'gemini', 'api'] as const satisfies readonly AgentAdapterKind[];
const apiProviders = ['openai', 'anthropic'] as const satisfies readonly ApiProvider[];
const sourceKinds = ['path', 'git', 'mcp'] as const satisfies readonly SourceReference['kind'][];
const agentRoles = ['writer', 'reviewer', 'verifier'] as const satisfies readonly (keyof AgentsConfig)[];
const stableThemeComponentNames = [
  'Callout',
  'CodeBlock',
  'CodeGroup',
  'Terminal',
  'Card',
  'CardGrid',
  'Steps',
  'Tabs',
  'FileTree',
  'PreviousNext',
  'Divider',
  'ComparisonTable',
  'ParamTable',
  'DecisionTree',
  'Badge',
  'ApiReference',
  'Diagram',
  'Term'
] as const;

type AgentRole = (typeof agentRoles)[number];

const nodeIdFromTitle = (title: string): string => {
  const id = title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return id || 'page';
};

const replaceNode = (
  nodes: readonly IaNode[],
  path: NodePath,
  edit: (node: IaNode, index: number) => IaNode | null
): IaNode[] =>
  nodes.flatMap((node, index) => {
    if (path.length === 0) {
      return [node];
    }

    if (path[0] !== index) {
      return [node];
    }

    if (path.length === 1) {
      const nextNode = edit(node, index);
      return nextNode ? [nextNode] : [];
    }

    return [
      {
        ...node,
        children: replaceNode(node.children ?? [], path.slice(1), edit)
      }
    ];
  });

const addChildNode = (nodes: readonly IaNode[], path: NodePath): IaNode[] =>
  replaceNode(nodes, path, (node) => {
    const nextIndex = (node.children ?? []).length + 1;
    const child: IaNode = {
      id: `new-page-${nextIndex}`,
      title: `New page ${nextIndex}`,
      path: `new-page-${nextIndex}.mdx`
    };
    return { ...node, children: [...(node.children ?? []), child] };
  });

const updateNode = (nodes: readonly IaNode[], path: NodePath, value: Partial<IaNode>): IaNode[] =>
  replaceNode(nodes, path, (node) => ({ ...node, ...value }));

const removeNode = (nodes: readonly IaNode[], path: NodePath): IaNode[] => replaceNode(nodes, path, () => null);

const linesFromText = (text: string): string[] | undefined => {
  const lines = text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return lines.length > 0 ? lines : undefined;
};

const textFromLines = (lines: readonly string[] | undefined): string => lines?.join('\n') ?? '';

const optionalText = (value: string): string | undefined => {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const numberOrUndefined = (value: string): number | undefined => {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const number = Number(trimmed);
  return Number.isFinite(number) && number > 0 ? number : undefined;
};

const nextUniqueId = (base: string, existingIds: readonly string[]): string => {
  let index = 1;
  let candidate = base;
  while (existingIds.includes(candidate)) {
    index += 1;
    candidate = `${base}-${index}`;
  }
  return candidate;
};

const blankSource = (kind: SourceReference['kind']): SourceReference => {
  if (kind === 'git') {
    return { kind, url: 'https://example.com/repo.git' };
  }
  if (kind === 'mcp') {
    return { kind, server: 'docs' };
  }
  return { kind, path: 'src' };
};

const sourceValue = (source: SourceReference): string => {
  if (source.kind === 'git') {
    return source.url;
  }
  if (source.kind === 'mcp') {
    return source.server;
  }
  return source.path;
};

const updateSourceValue = (source: SourceReference, value: string): SourceReference => {
  if (source.kind === 'git') {
    return { ...source, url: value };
  }
  if (source.kind === 'mcp') {
    return { ...source, server: value };
  }
  return { ...source, path: value };
};

const defaultAgentChoice = (adapter: AgentAdapterKind = 'codex'): AgentChoice =>
  adapter === 'api' ? { adapter, provider: 'openai' } : { adapter };

const defaultCaps = (caps: UsageCaps | undefined): Record<keyof UsageCaps, string> => ({
  maxPages: caps?.maxPages?.toString() ?? '',
  maxTokens: caps?.maxTokens?.toString() ?? '',
  maxUsd: caps?.maxUsd?.toString() ?? ''
});

const capsFromDraft = (draft: Record<keyof UsageCaps, string>): UsageCaps | undefined => {
  const caps: UsageCaps = {
    maxPages: numberOrUndefined(draft.maxPages),
    maxTokens: numberOrUndefined(draft.maxTokens),
    maxUsd: numberOrUndefined(draft.maxUsd)
  };
  return Object.values(caps).some((value) => value !== undefined) ? caps : undefined;
};

function NavNode(props: NavTreeProps & { node: IaNode; path: NodePath }) {
  const children = props.node.children ?? [];
  const nodeTestId = `nav-node-${props.node.id}`;

  return (
    <li className="nav-node" data-testid={nodeTestId}>
      <div className="nav-node-row">
        <input
          aria-label={`${props.node.title} title`}
          className="field nav-title-field"
          value={props.node.title}
          onChange={(event) =>
            props.onUpdate(props.path, {
              title: event.target.value,
              id: nodeIdFromTitle(event.target.value)
            })
          }
        />
        <input
          aria-label={`${props.node.title} path`}
          className="field nav-path-field"
          placeholder="page.mdx"
          value={props.node.path ?? ''}
          onChange={(event) => props.onUpdate(props.path, { path: event.target.value || undefined })}
        />
        <button
          className="icon-button"
          title="Add child page"
          type="button"
          onClick={() => props.onAddChild(props.path)}
        >
          <Plus aria-hidden="true" size={16} />
        </button>
        <button
          className="icon-button danger"
          title="Remove page"
          type="button"
          onClick={() => props.onRemove(props.path)}
        >
          <Trash2 aria-hidden="true" size={16} />
        </button>
      </div>
      <textarea
        aria-label={`${props.node.title} brief`}
        className="field nav-brief-field"
        placeholder="Brief"
        value={props.node.brief ?? ''}
        onChange={(event) => props.onUpdate(props.path, { brief: event.target.value || undefined })}
      />
      {children.length > 0 ? (
        <ol className="nav-children">
          {children.map((child, index) => (
            <NavNode key={`${child.id}-${index}`} {...props} node={child} path={[...props.path, index]} />
          ))}
        </ol>
      ) : null}
    </li>
  );
}

export function NavTree(props: NavTreeProps) {
  return (
    <section className="setup-panel" data-testid="nav-tree">
      <div className="panel-heading">
        <FolderTree aria-hidden="true" size={18} />
        <h2>Information architecture</h2>
      </div>
      <ol className="nav-tree-list">
        {props.nodes.map((node, index) => (
          <NavNode key={`${node.id}-${index}`} {...props} node={node} path={[index]} />
        ))}
      </ol>
    </section>
  );
}

export function ThemeTokenEditor(props: ThemeTokenEditorProps) {
  const entries = Object.entries(props.tokens);
  const updateToken = (name: string, value: string | number) => {
    props.onChange({ ...props.tokens, [name]: value });
  };

  return (
    <section className="setup-panel" data-testid="theme-token-editor">
      <div className="panel-heading">
        <Palette aria-hidden="true" size={18} />
        <h2>Theme tokens</h2>
      </div>
      <div className="token-grid">
        {entries.map(([name, value]) => (
          <label key={name} className="token-row">
            <span>{name}</span>
            {typeof value === 'number' ? (
              <input
                className="field"
                min="0"
                type="number"
                value={value}
                onChange={(event) => updateToken(name, Number(event.target.value))}
              />
            ) : (
              <span className="color-control">
                <span className="swatch" style={{ background: value }} />
                <input
                  className="field"
                  type={value.startsWith('#') ? 'color' : 'text'}
                  value={value}
                  onChange={(event) => updateToken(name, event.target.value)}
                />
              </span>
            )}
          </label>
        ))}
      </div>
      <div
        className="theme-preview"
        data-testid="theme-preview"
        style={{
          background: String(props.tokens.surface ?? '#f8fafc'),
          borderColor: String(props.tokens.accent ?? '#2563eb'),
          borderRadius: Number(props.tokens.radius ?? 8)
        }}
      >
        <span>Docs preview</span>
        <strong style={{ color: String(props.tokens.accent ?? '#2563eb') }}>Current theme</strong>
      </div>
    </section>
  );
}

function PersonaEditor(props: {
  onAdd: () => void;
  onRemove: (index: number) => void;
  onUpdate: (index: number, value: Partial<Persona>) => void;
  personas: readonly Persona[];
}) {
  return (
    <section className="setup-panel" data-testid="persona-editor">
      <div className="panel-heading">
        <Settings2 aria-hidden="true" size={18} />
        <h2>Personas</h2>
      </div>
      <div className="stack-list">
        {props.personas.map((persona, index) => (
          <div key={`${persona.id}-${index}`} className="nested-panel" data-testid={`persona-row-${index}`}>
            <label className="field-row">
              <span>ID</span>
              <input
                className="field"
                data-testid={`persona-id-${index}`}
                value={persona.id}
                onChange={(event) => props.onUpdate(index, { id: nodeIdFromTitle(event.target.value) })}
              />
            </label>
            <label className="field-row">
              <span>Title</span>
              <input
                className="field"
                data-testid={`persona-title-${index}`}
                value={persona.title}
                onChange={(event) => props.onUpdate(index, { title: event.target.value })}
              />
            </label>
            <label className="field-row">
              <span>Audience notes</span>
              <textarea
                className="field"
                data-testid={`persona-description-${index}`}
                value={persona.description ?? ''}
                onChange={(event) => props.onUpdate(index, { description: optionalText(event.target.value) })}
              />
            </label>
            <label className="field-row">
              <span>Goals</span>
              <textarea
                className="field"
                data-testid={`persona-goals-${index}`}
                value={textFromLines(persona.goals)}
                onChange={(event) => props.onUpdate(index, { goals: linesFromText(event.target.value) })}
              />
            </label>
            <button
              className="secondary-button"
              disabled={props.personas.length === 1}
              type="button"
              onClick={() => props.onRemove(index)}
            >
              <Trash2 aria-hidden="true" size={16} />
              Remove
            </button>
          </div>
        ))}
      </div>
      <button
        className="primary-button full-width-button"
        data-testid="add-persona"
        type="button"
        onClick={props.onAdd}
      >
        <Plus aria-hidden="true" size={18} />
        Add persona
      </button>
    </section>
  );
}

function SourceEditor(props: {
  onAdd: () => void;
  onRemove: (index: number) => void;
  onUpdate: (index: number, source: SourceReference) => void;
  sources: readonly SourceReference[];
}) {
  return (
    <section className="setup-panel" data-testid="source-editor">
      <div className="panel-heading">
        <FolderTree aria-hidden="true" size={18} />
        <h2>Source context</h2>
      </div>
      <div className="stack-list">
        {props.sources.map((source, index) => (
          <div key={`${source.kind}-${index}`} className="nested-panel source-row" data-testid={`source-row-${index}`}>
            <label className="field-row">
              <span>Kind</span>
              <select
                className="field"
                data-testid={`source-kind-${index}`}
                value={source.kind}
                onChange={(event) => props.onUpdate(index, blankSource(event.target.value as SourceReference['kind']))}
              >
                {sourceKinds.map((kind) => (
                  <option key={kind} value={kind}>
                    {kind}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-row">
              <span>{source.kind === 'mcp' ? 'Server' : source.kind === 'git' ? 'URL' : 'Path'}</span>
              <input
                className="field"
                data-testid={`source-value-${index}`}
                value={sourceValue(source)}
                onChange={(event) => props.onUpdate(index, updateSourceValue(source, event.target.value))}
              />
            </label>
            {source.kind === 'git' ? (
              <label className="field-row">
                <span>Ref</span>
                <input
                  className="field"
                  data-testid={`source-ref-${index}`}
                  value={source.ref ?? ''}
                  onChange={(event) => props.onUpdate(index, { ...source, ref: optionalText(event.target.value) })}
                />
              </label>
            ) : null}
            <button className="secondary-button" type="button" onClick={() => props.onRemove(index)}>
              <Trash2 aria-hidden="true" size={16} />
              Remove
            </button>
          </div>
        ))}
      </div>
      <button className="primary-button full-width-button" data-testid="add-source" type="button" onClick={props.onAdd}>
        <Plus aria-hidden="true" size={18} />
        Add source
      </button>
    </section>
  );
}

function AgentChoiceEditor(props: {
  choice?: AgentChoice;
  onChange: (choice: AgentChoice | undefined) => void;
  required?: boolean;
  role: AgentRole;
}) {
  const choice = props.choice;
  return (
    <div className="nested-panel" data-testid={`agent-${props.role}`}>
      <label className="field-row">
        <span>{props.role}</span>
        <select
          className="field"
          data-testid={`agent-${props.role}-adapter`}
          value={choice?.adapter ?? ''}
          onChange={(event) => {
            const adapter = event.target.value as AgentAdapterKind | '';
            props.onChange(adapter ? defaultAgentChoice(adapter) : undefined);
          }}
        >
          {props.required ? null : <option value="">same as writer</option>}
          {agentAdapters.map((adapter) => (
            <option key={adapter} value={adapter}>
              {adapter}
            </option>
          ))}
        </select>
      </label>
      {choice ? (
        <>
          <label className="field-row">
            <span>Model</span>
            <input
              className="field"
              data-testid={`agent-${props.role}-model`}
              value={choice.model ?? ''}
              onChange={(event) => props.onChange({ ...choice, model: optionalText(event.target.value) })}
            />
          </label>
          {choice.adapter === 'api' ? (
            <>
              <label className="field-row">
                <span>Provider</span>
                <select
                  className="field"
                  data-testid={`agent-${props.role}-provider`}
                  value={choice.provider ?? ''}
                  onChange={(event) =>
                    props.onChange({
                      ...choice,
                      provider: optionalText(event.target.value) as ApiProvider | undefined
                    })
                  }
                >
                  <option value="">custom base URL</option>
                  {apiProviders.map((provider) => (
                    <option key={provider} value={provider}>
                      {provider}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field-row">
                <span>Base URL</span>
                <input
                  className="field"
                  data-testid={`agent-${props.role}-base-url`}
                  value={choice.baseUrl ?? ''}
                  onChange={(event) => props.onChange({ ...choice, baseUrl: optionalText(event.target.value) })}
                />
              </label>
            </>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function AgentEditor(props: {
  agents: AgentsConfig;
  onChange: (role: AgentRole, choice: AgentChoice | undefined) => void;
}) {
  return (
    <section className="setup-panel" data-testid="agent-editor">
      <div className="panel-heading">
        <Settings2 aria-hidden="true" size={18} />
        <h2>Agents</h2>
      </div>
      <div className="stack-list">
        <AgentChoiceEditor
          role="writer"
          required
          choice={props.agents.writer}
          onChange={(choice) => props.onChange('writer', choice)}
        />
        <AgentChoiceEditor
          role="reviewer"
          choice={props.agents.reviewer}
          onChange={(choice) => props.onChange('reviewer', choice)}
        />
        <AgentChoiceEditor
          role="verifier"
          choice={props.agents.verifier}
          onChange={(choice) => props.onChange('verifier', choice)}
        />
      </div>
    </section>
  );
}

function ComponentSelector(props: { components: readonly string[]; onToggle: (component: string) => void }) {
  return (
    <section className="setup-panel" data-testid="component-selector">
      <div className="panel-heading">
        <Settings2 aria-hidden="true" size={18} />
        <h2>Components</h2>
      </div>
      <div className="component-grid">
        {stableThemeComponentNames.map((component) => (
          <label key={component} className="component-option">
            <input
              checked={props.components.includes(component)}
              data-testid={`component-${component}`}
              type="checkbox"
              onChange={() => props.onToggle(component)}
            />
            <span>{component}</span>
          </label>
        ))}
      </div>
    </section>
  );
}

function CapsEditor(props: {
  caps: Record<keyof UsageCaps, string>;
  onChange: (key: keyof UsageCaps, value: string) => void;
}) {
  return (
    <section className="setup-panel" data-testid="caps-editor">
      <div className="panel-heading">
        <Settings2 aria-hidden="true" size={18} />
        <h2>Usage caps</h2>
      </div>
      <label className="field-row">
        <span>Max USD</span>
        <input
          className="field"
          data-testid="cap-max-usd"
          min="0"
          type="number"
          value={props.caps.maxUsd}
          onChange={(event) => props.onChange('maxUsd', event.target.value)}
        />
      </label>
      <label className="field-row">
        <span>Max tokens</span>
        <input
          className="field"
          data-testid="cap-max-tokens"
          min="0"
          type="number"
          value={props.caps.maxTokens}
          onChange={(event) => props.onChange('maxTokens', event.target.value)}
        />
      </label>
      <label className="field-row">
        <span>Max pages</span>
        <input
          className="field"
          data-testid="cap-max-pages"
          min="0"
          type="number"
          value={props.caps.maxPages}
          onChange={(event) => props.onChange('maxPages', event.target.value)}
        />
      </label>
    </section>
  );
}

export function SetupWizard(props: SetupWizardProps) {
  const [siteName, setSiteName] = useState(props.initialConfig.site.name);
  const [siteDescription, setSiteDescription] = useState(props.initialConfig.site.description ?? '');
  const [siteUrl, setSiteUrl] = useState(props.initialConfig.site.url ?? '');
  const [locale, setLocale] = useState(props.initialConfig.site.locale);
  const [docsType, setDocsType] = useState<DocsType>(props.initialConfig.docsType);
  const [outputDir, setOutputDir] = useState(props.initialConfig.output.dir);
  const [layout, setLayout] = useState<Layout>(props.initialConfig.output.layout);
  const [personas, setPersonas] = useState<Persona[]>(props.initialConfig.personas);
  const [sources, setSources] = useState<SourceReference[]>(props.initialConfig.sources ?? []);
  const [agents, setAgents] = useState<AgentsConfig>(props.initialConfig.agents);
  const [caps, setCaps] = useState<Record<keyof UsageCaps, string>>(defaultCaps(props.initialConfig.caps));
  const [nav, setNav] = useState<IaNode[]>(props.initialIa.nav);
  const [tokens, setTokens] = useState<ThemeTokensDraft>(
    props.initialThemeTokens ?? props.initialConfig.theme?.tokens ?? defaultThemeTokens
  );
  const [components, setComponents] = useState<string[]>(
    props.initialConfig.theme?.components ?? [...stableThemeComponentNames]
  );
  const [saveState, setSaveState] = useState<'idle' | 'saved' | 'saving'>('idle');

  const pageCount = useMemo(() => {
    const countNodes = (nodes: readonly IaNode[]): number =>
      nodes.reduce((sum, node) => sum + 1 + countNodes(node.children ?? []), 0);
    return countNodes(nav);
  }, [nav]);

  const addPersona = () => {
    setPersonas((current) => {
      const id = nextUniqueId(
        'persona',
        current.map((persona) => persona.id)
      );
      return [...current, { id, title: 'New persona' }];
    });
  };

  const updatePersona = (index: number, value: Partial<Persona>) => {
    setPersonas((current) =>
      current.map((persona, personaIndex) => (personaIndex === index ? { ...persona, ...value } : persona))
    );
  };

  const removePersona = (index: number) => {
    setPersonas((current) =>
      current.length === 1 ? current : current.filter((_, personaIndex) => personaIndex !== index)
    );
  };

  const addSource = () => {
    setSources((current) => [...current, blankSource('path')]);
  };

  const updateSource = (index: number, source: SourceReference) => {
    setSources((current) => current.map((item, sourceIndex) => (sourceIndex === index ? source : item)));
  };

  const removeSource = (index: number) => {
    setSources((current) => current.filter((_, sourceIndex) => sourceIndex !== index));
  };

  const updateAgent = (role: AgentRole, choice: AgentChoice | undefined) => {
    setAgents((current) => {
      if (role === 'writer') {
        return { ...current, writer: choice ?? defaultAgentChoice() };
      }
      return { ...current, [role]: choice };
    });
  };

  const toggleComponent = (component: string) => {
    setComponents((current) =>
      current.includes(component) ? current.filter((item) => item !== component) : [...current, component]
    );
  };

  const save = async () => {
    setSaveState('saving');
    const config: DocstubeConfig = {
      ...props.initialConfig,
      site: {
        ...props.initialConfig.site,
        name: siteName,
        description: optionalText(siteDescription),
        url: optionalText(siteUrl),
        locale
      },
      docsType,
      output: { ...props.initialConfig.output, dir: outputDir, layout },
      personas,
      agents,
      sources: sources.length > 0 ? sources : undefined,
      caps: capsFromDraft(caps),
      theme: {
        ...props.initialConfig.theme,
        tokens,
        components: components.length > 0 ? components : undefined,
        credit: props.initialConfig.theme?.credit ?? true
      }
    };
    const ia: Ia = { ...props.initialIa, layout, nav };

    await props.onSave?.({ config, ia, themeTokens: tokens });
    setSaveState('saved');
  };

  return (
    <main className="setup-shell" data-testid="setup-wizard-shell">
      <header className="setup-header" data-testid="setup-wizard-header">
        <div>
          <p className="eyebrow">docstube</p>
          <h1>{siteName}</h1>
        </div>
        <button className="primary-button" data-testid="wizard-save" type="button" onClick={save}>
          {saveState === 'saved' ? <Check aria-hidden="true" size={18} /> : <Save aria-hidden="true" size={18} />}
          {saveState === 'saving' ? 'Saving' : saveState === 'saved' ? 'Saved' : 'Save'}
        </button>
      </header>

      <div className="setup-grid">
        <section className="setup-panel" data-testid="project-settings">
          <div className="panel-heading">
            <Settings2 aria-hidden="true" size={18} />
            <h2>Project</h2>
          </div>
          <label className="field-row">
            <span>Site name</span>
            <input
              className="field"
              data-testid="site-name-input"
              value={siteName}
              onChange={(event) => setSiteName(event.target.value)}
            />
          </label>
          <label className="field-row">
            <span>Description</span>
            <textarea
              className="field"
              data-testid="site-description-input"
              value={siteDescription}
              onChange={(event) => setSiteDescription(event.target.value)}
            />
          </label>
          <label className="field-row">
            <span>Canonical URL</span>
            <input
              className="field"
              data-testid="site-url-input"
              value={siteUrl}
              onChange={(event) => setSiteUrl(event.target.value)}
            />
          </label>
          <label className="field-row">
            <span>Locale</span>
            <input
              className="field"
              data-testid="site-locale-input"
              value={locale}
              onChange={(event) => setLocale(event.target.value)}
            />
          </label>
          <label className="field-row">
            <span>Doc type</span>
            <select
              className="field"
              data-testid="docs-type-select"
              value={docsType}
              onChange={(event) => setDocsType(event.target.value as DocsType)}
            >
              {docsTypeOptions.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </label>
          <label className="field-row">
            <span>Output</span>
            <input className="field" value={outputDir} onChange={(event) => setOutputDir(event.target.value)} />
          </label>
          <label className="field-row">
            <span>Layout</span>
            <select className="field" value={layout} onChange={(event) => setLayout(event.target.value as Layout)}>
              {layoutOptions.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <div className="summary-strip" data-testid="wizard-summary">
            <span>{pageCount} pages</span>
            <span>{personas.length} personas</span>
            <span>{layout}</span>
          </div>
        </section>

        <PersonaEditor personas={personas} onAdd={addPersona} onRemove={removePersona} onUpdate={updatePersona} />

        <AgentEditor agents={agents} onChange={updateAgent} />

        <SourceEditor sources={sources} onAdd={addSource} onRemove={removeSource} onUpdate={updateSource} />

        <NavTree
          nodes={nav}
          onAddChild={(path) => setNav((current) => addChildNode(current, path))}
          onRemove={(path) => setNav((current) => removeNode(current, path))}
          onUpdate={(path, value) => setNav((current) => updateNode(current, path, value))}
        />

        <ThemeTokenEditor tokens={tokens} onChange={setTokens} />

        <ComponentSelector components={components} onToggle={toggleComponent} />

        <CapsEditor caps={caps} onChange={(key, value) => setCaps((current) => ({ ...current, [key]: value }))} />
      </div>
    </main>
  );
}
