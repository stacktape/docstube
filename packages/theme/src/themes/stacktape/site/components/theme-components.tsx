import type { ReactNode } from 'react';

// Registry component renderers in the source theme's visual language (theme-spec-stacktape.md
// §6). Prop contracts match the docstube component registry (same shapes as the basic theme);
// all styling lives in styles/global.css (stp-* classes). These render statically — the layout's
// delegated inline scripts add tab switching and copy buttons.

type Tone = 'info' | 'note' | 'success' | 'warning' | 'danger';

export function Callout({ children, title, tone = 'info' }: { children?: ReactNode; title?: string; tone?: Tone }) {
  return (
    <aside className={`stp-callout stp-callout--${tone}`} data-component="Callout">
      <div className="stp-callout-body stp-typography">
        {title ? <strong className="stp-callout-title">{title}</strong> : null}
        {children}
      </div>
    </aside>
  );
}

export function CodeBlock({ code, language, title }: { code?: string; language?: string; title?: string }) {
  const lineCount = (code ?? '').split('\n').length;
  return (
    <figure className="stp-code-figure" data-component="CodeBlock">
      {title ? <figcaption className="stp-code-title">{title}</figcaption> : null}
      <div className={lineCount <= 2 ? 'stp-code-shell is-compact' : 'stp-code-shell'}>
        <pre className="stp-plain-pre">
          <code data-language={language}>
            {(code ?? '').split('\n').map((line, index) => (
              <span key={index} className="line">
                {line}
              </span>
            ))}
          </code>
        </pre>
      </div>
    </figure>
  );
}

export function CodeGroup({ children, title }: { children?: ReactNode; title?: string }) {
  // The delegated script in DocLayout builds the sliding-pill tab strip from the child
  // CodeBlock titles; before it runs (or without JS) the first panel shows via CSS.
  return (
    <section className="stp-code-group" data-component="CodeGroup" data-title={title}>
      <div className="stp-code-group-panels">{children}</div>
    </section>
  );
}

export function Terminal({ command, output, title }: { command?: string; output?: string; title?: string }) {
  return (
    <figure className="stp-terminal" data-component="Terminal">
      {title ? <figcaption className="stp-code-title">{title}</figcaption> : null}
      <div className="stp-code-shell is-compact">
        <pre className="stp-plain-pre">
          {command ? (
            <code className="stp-terminal-line" data-kind="command">
              {command}
            </code>
          ) : null}
          {output ? (
            <code className="stp-terminal-line" data-kind="output">
              {output}
            </code>
          ) : null}
        </pre>
      </div>
    </figure>
  );
}

const CardChevron = () => (
  <svg
    className="stp-card-chevron"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

export function Card({ description, href, title }: { description?: string; href?: string; title: string }) {
  const body = (
    <div className="stp-card-body">
      <span className="stp-card-title">{title}</span>
      {description ? <span className="stp-card-description">{description}</span> : null}
    </div>
  );
  return href ? (
    <a className="stp-card stp-clickable-box" data-component="Card" href={href}>
      {body}
      <CardChevron />
    </a>
  ) : (
    <section className="stp-card stp-box" data-component="Card">
      {body}
    </section>
  );
}

export function CardGrid({ children, columns = 2 }: { children?: ReactNode; columns?: number }) {
  const columnCount = Math.min(Math.max(columns, 1), 4);
  return (
    <div
      className="stp-card-grid"
      data-component="CardGrid"
      style={{ gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))` }}
    >
      {children}
    </div>
  );
}

export function Steps({ items = [] }: { items?: string[] }) {
  return (
    <ol className="stp-steps" data-component="Steps">
      {items.map((item) => (
        <li key={item} className="stp-step">
          <span className="stp-step-number" aria-hidden="true" />
          <span className="stp-step-rail" aria-hidden="true" />
          <div className="stp-step-body stp-typography">{item}</div>
        </li>
      ))}
    </ol>
  );
}

export function Tabs({ defaultValue, tabs }: { defaultValue?: string; tabs: { label: string; value: string }[] }) {
  const activeValue = defaultValue ?? tabs[0]?.value;
  return (
    <div className="stp-content-tabs" data-component="Tabs">
      <div className="stp-content-tab-list" role="tablist">
        {tabs.map((tab) => (
          <button
            className="stp-content-tab"
            aria-selected={tab.value === activeValue}
            key={tab.value}
            role="tab"
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function FileTree({ entries }: { entries: { path: string; kind?: 'file' | 'directory' }[] }) {
  return (
    <ul className="stp-file-tree stp-box" data-component="FileTree">
      {entries.map((entry) => (
        <li data-kind={entry.kind ?? 'file'} key={`${entry.kind ?? 'file'}:${entry.path}`}>
          {entry.path}
        </li>
      ))}
    </ul>
  );
}

export function Badge({ children, label, tone = 'info' }: { children?: ReactNode; label?: string; tone?: Tone }) {
  return (
    <span className={`stp-badge stp-badge--${tone}`} data-component="Badge">
      {label ?? children}
    </span>
  );
}

export function ParamTable({
  params
}: {
  params: { name: string; type?: string; required?: boolean; description: string }[];
}) {
  return (
    <table className="stp-param-table" data-component="ParamTable">
      <tbody>
        {params.map((param) => (
          <tr key={param.name}>
            <th>
              <span className="stp-param-name">{param.name}</span>
              {param.required ? <span className="stp-param-required">*</span> : null}
            </th>
            <td>{param.type ? <code>{param.type}</code> : null}</td>
            <td>{param.description}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ComparisonTable({ columns, rows }: { columns: string[]; rows: (string | number | boolean)[][] }) {
  return (
    <div className="stp-comparison-wrapper">
      <table data-component="ComparisonTable">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex}>
                  {cell === true ? (
                    <span className="stp-comparison-check">✓</span>
                  ) : cell === false ? (
                    <span className="stp-comparison-cross">✕</span>
                  ) : (
                    String(cell)
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
