import { Check, FolderTree, Palette, Plus, Save, Settings2, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { DocstubeConfig, DocsType, Ia, IaNode, Layout, Persona } from '@docstube/contracts';

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

const firstPersona = (personas: readonly Persona[]): Persona => personas[0] ?? { id: 'developer', title: 'Developer' };

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

export function SetupWizard(props: SetupWizardProps) {
  const initialPersona = firstPersona(props.initialConfig.personas);
  const [siteName, setSiteName] = useState(props.initialConfig.site.name);
  const [docsType, setDocsType] = useState<DocsType>(props.initialConfig.docsType);
  const [outputDir, setOutputDir] = useState(props.initialConfig.output.dir);
  const [layout, setLayout] = useState<Layout>(props.initialConfig.output.layout);
  const [personaTitle, setPersonaTitle] = useState(initialPersona.title);
  const [nav, setNav] = useState<IaNode[]>(props.initialIa.nav);
  const [tokens, setTokens] = useState<ThemeTokensDraft>(
    props.initialThemeTokens ?? props.initialConfig.theme?.tokens ?? defaultThemeTokens
  );
  const [saveState, setSaveState] = useState<'idle' | 'saved' | 'saving'>('idle');

  const pageCount = useMemo(() => {
    const countNodes = (nodes: readonly IaNode[]): number =>
      nodes.reduce((sum, node) => sum + 1 + countNodes(node.children ?? []), 0);
    return countNodes(nav);
  }, [nav]);

  const save = async () => {
    setSaveState('saving');
    const persona: Persona = { ...initialPersona, title: personaTitle };
    const config: DocstubeConfig = {
      ...props.initialConfig,
      site: { ...props.initialConfig.site, name: siteName },
      docsType,
      output: { ...props.initialConfig.output, dir: outputDir, layout },
      personas: [persona, ...props.initialConfig.personas.slice(1)],
      theme: { ...props.initialConfig.theme, tokens, credit: props.initialConfig.theme?.credit ?? true }
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
          <label className="field-row">
            <span>Persona</span>
            <input className="field" value={personaTitle} onChange={(event) => setPersonaTitle(event.target.value)} />
          </label>
          <div className="summary-strip" data-testid="wizard-summary">
            <span>{pageCount} pages</span>
            <span>{layout}</span>
          </div>
        </section>

        <NavTree
          nodes={nav}
          onAddChild={(path) => setNav((current) => addChildNode(current, path))}
          onRemove={(path) => setNav((current) => removeNode(current, path))}
          onUpdate={(path, value) => setNav((current) => updateNode(current, path, value))}
        />

        <ThemeTokenEditor tokens={tokens} onChange={setTokens} />
      </div>
    </main>
  );
}
