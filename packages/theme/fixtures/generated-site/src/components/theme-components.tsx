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

export function Divider({ label }: { label?: string }) {
  return (
    <div className="dt-divider" data-component="Divider">
      {label ? <span>{label}</span> : null}
    </div>
  );
}
