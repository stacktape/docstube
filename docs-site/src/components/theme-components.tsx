import type { ReactNode } from 'react';

type Tone = 'info' | 'note' | 'success' | 'warning' | 'danger';

export function Callout({ children, title, tone = 'info' }: { children?: ReactNode; title?: string; tone?: Tone }) {
  return <aside className={`dt-callout dt-callout--${tone}`} data-component="Callout">{title ? <strong>{title}</strong> : null}<div>{children}</div></aside>;
}

export function CodeBlock({ code, language, title }: { code?: string; language?: string; title?: string }) {
  return <figure className="dt-code-block" data-component="CodeBlock">{title ? <figcaption>{title}</figcaption> : null}<pre><code data-language={language}>{code}</code></pre></figure>;
}

export function CodeGroup({ children, title }: { children?: ReactNode; title?: string }) {
  return <section className="dt-code-group" data-component="CodeGroup">{title ? <h3>{title}</h3> : null}{children}</section>;
}

export function Terminal({ command, output, title }: { command?: string; output?: string; title?: string }) {
  return <figure className="dt-terminal" data-component="Terminal">{title ? <figcaption>{title}</figcaption> : null}<pre>{command ? <code>$ {command}</code> : null}{output ? <code>{output}</code> : null}</pre></figure>;
}

export function Card({ description, href, title }: { description?: string; href?: string; title: string }) {
  const content = <><strong>{title}</strong>{description ? <span>{description}</span> : null}</>;
  return href ? <a className="dt-card" data-component="Card" href={href}>{content}</a> : <section className="dt-card" data-component="Card">{content}</section>;
}

export function CardGrid({ children, columns = 2 }: { children?: ReactNode; columns?: number }) {
  const columnCount = Math.min(Math.max(columns, 1), 4);
  return <div className="dt-card-grid" data-component="CardGrid" style={{ gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))` }}>{children}</div>;
}

export function Steps({ items = [] }: { items?: string[] }) {
  return <ol className="dt-steps" data-component="Steps">{items.map((item) => <li key={item}>{item}</li>)}</ol>;
}

export function Tabs({ defaultValue, tabs }: { defaultValue?: string; tabs: { label: string; value: string }[] }) {
  const activeValue = defaultValue ?? tabs[0]?.value;
  return <div className="dt-tabs" data-component="Tabs"><div className="dt-tab-list" role="tablist">{tabs.map((tab) => <button aria-selected={tab.value === activeValue} key={tab.value} role="tab" type="button">{tab.label}</button>)}</div></div>;
}

export function FileTree({ entries }: { entries: { path: string; kind?: "file" | "directory" }[] }) {
  return <ul className="dt-file-tree" data-component="FileTree">{entries.map((entry) => <li data-kind={entry.kind ?? "file"} key={`${entry.kind ?? "file"}:${entry.path}`}>{entry.path}</li>)}</ul>;
}

export function Badge({ children, label, tone = "info" }: { children?: ReactNode; label?: string; tone?: Tone }) {
  return <span className={`dt-badge dt-badge--${tone}`} data-component="Badge">{label ?? children}</span>;
}

export function ParamTable({ params }: { params: { name: string; type?: string; required?: boolean; description: string }[] }) {
  return <table className="dt-param-table" data-component="ParamTable"><tbody>{params.map((param) => <tr key={param.name}><th>{param.name}{param.required ? " *" : ""}</th><td>{param.type ? <code>{param.type}</code> : null}</td><td>{param.description}</td></tr>)}</tbody></table>;
}

export function ComparisonTable({ columns, rows }: { columns: string[]; rows: (string | number | boolean)[][] }) {
  return <table className="dt-comparison-table" data-component="ComparisonTable"><thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex}>{String(cell)}</td>)}</tr>)}</tbody></table>;
}
