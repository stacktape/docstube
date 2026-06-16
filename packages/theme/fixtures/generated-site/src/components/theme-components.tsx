import type { ReactNode } from 'react';

type Tone = 'info' | 'note' | 'success' | 'warning' | 'danger';

type CalloutProps = {
  children?: ReactNode;
  title?: string;
  tone?: Tone;
};

export function Callout({ children, title, tone = 'info' }: CalloutProps) {
  return (
    <aside className={`dt-callout dt-callout--${tone}`} data-component="Callout">
      {title ? <strong>{title}</strong> : null}
      <div>{children}</div>
    </aside>
  );
}

type CardProps = {
  description?: string;
  href?: string;
  title: string;
};

export function Card({ description, href, title }: CardProps) {
  const content = (
    <>
      <strong>{title}</strong>
      {description ? <span>{description}</span> : null}
    </>
  );

  return href ? (
    <a className="dt-card" data-component="Card" href={href}>
      {content}
    </a>
  ) : (
    <section className="dt-card" data-component="Card">
      {content}
    </section>
  );
}

type CardGridProps = {
  children?: ReactNode;
  columns?: number;
};

export function CardGrid({ children, columns = 2 }: CardGridProps) {
  const columnCount = Math.min(Math.max(columns, 1), 4);

  return (
    <div
      className="dt-card-grid"
      data-component="CardGrid"
      style={{ gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))` }}
    >
      {children}
    </div>
  );
}

type CodeBlockProps = {
  code?: string;
  language?: string;
  title?: string;
};

export function CodeBlock({ code, language, title }: CodeBlockProps) {
  return (
    <figure className="dt-code-block" data-component="CodeBlock">
      {title ? <figcaption>{title}</figcaption> : null}
      <pre>
        <code data-language={language}>{code}</code>
      </pre>
    </figure>
  );
}

export function CodeGroup({ children, title }: { children?: ReactNode; title?: string }) {
  return (
    <section className="dt-code-group" data-component="CodeGroup">
      {title ? <h3>{title}</h3> : null}
      {children}
    </section>
  );
}

type StepsProps = {
  items?: string[];
};

export function Steps({ items = [] }: StepsProps) {
  return (
    <ol className="dt-steps" data-component="Steps">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ol>
  );
}

type TabsProps = {
  defaultValue?: string;
  tabs: { label: string; value: string }[];
};

export function Tabs({ defaultValue, tabs }: TabsProps) {
  const activeValue = defaultValue ?? tabs[0]?.value;

  return (
    <div className="dt-tabs" data-component="Tabs">
      <div className="dt-tab-list" role="tablist">
        {tabs.map((tab) => (
          <button aria-selected={tab.value === activeValue} key={tab.value} role="tab" type="button">
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  );
}

type TerminalProps = {
  command?: string;
  output?: string;
  title?: string;
};

export function Terminal({ command, output, title }: TerminalProps) {
  return (
    <figure className="dt-terminal" data-component="Terminal">
      {title ? <figcaption>{title}</figcaption> : null}
      <pre>
        {command ? <code>$ {command}</code> : null}
        {output ? <code>{output}</code> : null}
      </pre>
    </figure>
  );
}

export function FileTree({ entries }: { entries: { path: string; kind?: 'file' | 'directory' }[] }) {
  return (
    <ul className="dt-file-tree" data-component="FileTree">
      {entries.map((entry) => (
        <li data-kind={entry.kind ?? 'file'} key={`${entry.kind ?? 'file'}:${entry.path}`}>
          {entry.path}
        </li>
      ))}
    </ul>
  );
}

export function PreviousNext({
  next,
  previous
}: {
  next?: { title: string; href?: string; description?: string };
  previous?: { title: string; href?: string; description?: string };
}) {
  return (
    <nav className="dt-previous-next" data-component="PreviousNext">
      {previous ? <a href={previous.href}>{previous.title}</a> : <span />}
      {next ? <a href={next.href}>{next.title}</a> : <span />}
    </nav>
  );
}

export function ComparisonTable({ columns, rows }: { columns: string[]; rows: (string | number | boolean)[][] }) {
  return (
    <table className="dt-comparison-table" data-component="ComparisonTable">
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
              <td key={cellIndex}>{String(cell)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ParamTable({
  params
}: {
  params: { name: string; type?: string; required?: boolean; description: string }[];
}) {
  return (
    <table className="dt-param-table" data-component="ParamTable">
      <tbody>
        {params.map((param) => (
          <tr key={param.name}>
            <th>
              {param.name}
              {param.required ? ' *' : ''}
            </th>
            <td>{param.type ? <code>{param.type}</code> : null}</td>
            <td>{param.description}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function DecisionTree({
  decisions,
  title
}: {
  decisions: { title: string; href?: string; description?: string }[];
  title?: string;
}) {
  return (
    <section className="dt-decision-tree" data-component="DecisionTree">
      {title ? <h3>{title}</h3> : null}
      <ul>
        {decisions.map((decision) => (
          <li key={decision.title}>
            {decision.href ? <a href={decision.href}>{decision.title}</a> : <strong>{decision.title}</strong>}
            {decision.description ? <p>{decision.description}</p> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function Badge({ children, label, tone = 'info' }: { children?: ReactNode; label?: string; tone?: Tone }) {
  return (
    <span className={`dt-badge dt-badge--${tone}`} data-component="Badge">
      {label ?? children}
    </span>
  );
}

export function ApiReference({
  children,
  kind,
  signature,
  sourcePath,
  symbol
}: {
  children?: ReactNode;
  kind?: string;
  signature?: string;
  sourcePath?: string;
  symbol: string;
}) {
  return (
    <section className="dt-api-reference" data-component="ApiReference">
      <h3>
        <code>{symbol}</code>
        {kind ? <span> {kind}</span> : null}
      </h3>
      {signature ? (
        <pre>
          <code>{signature}</code>
        </pre>
      ) : null}
      {sourcePath ? <p>{sourcePath}</p> : null}
      {children}
    </section>
  );
}

export function Term({ children, id, label }: { children?: ReactNode; id: string; label?: string }) {
  return (
    <a className="dt-term" data-component="Term" href={`/glossary/#${id}`}>
      {label ?? children ?? id}
    </a>
  );
}

export function Divider({ label }: { label?: string }) {
  return (
    <div className="dt-divider" data-component="Divider">
      {label ? <span>{label}</span> : null}
    </div>
  );
}

type DiagramProps = {
  svg: string;
  title?: string;
};

export function Diagram({ svg, title }: DiagramProps) {
  return (
    <figure className="dt-diagram" data-component="Diagram">
      {title ? <figcaption>{title}</figcaption> : null}
      <div dangerouslySetInnerHTML={{ __html: svg }} />
    </figure>
  );
}
