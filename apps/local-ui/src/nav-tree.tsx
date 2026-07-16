import type { ReactNode } from 'react';

// THE NavTree (PRODUCT §3.9.1): one reusable component across all four surfaces. This wave uses
// it for dashboard progress mode; the wizard (IA editing) and review UI (navigation) reuse the
// same component later — hence the generic payload and the adornment slot instead of anything
// dashboard-specific baked in.

export type NavTreeStatusTone = 'neutral' | 'active' | 'success' | 'warning' | 'danger';

export type NavTreeNode<T = unknown> = {
  id: string;
  title: string;
  // Optional badge text (dashboard: page status; wizard: depth budget; review: guarantee level).
  status?: string;
  statusTone?: NavTreeStatusTone;
  findingsCount?: number;
  costUsd?: number;
  // Surface-specific data carried through to onSelect / renderAdornment untouched.
  payload?: T;
  children?: NavTreeNode<T>[];
};

const toneClasses: Record<NavTreeStatusTone, string> = {
  neutral: 'bg-neutral-800 text-neutral-300',
  active: 'bg-sky-950 text-sky-300',
  success: 'bg-emerald-950 text-emerald-300',
  warning: 'bg-amber-950 text-amber-300',
  danger: 'bg-rose-950 text-rose-300'
};

type NavTreeProps<T> = {
  nodes: NavTreeNode<T>[];
  selectedId?: string;
  onSelect?: (node: NavTreeNode<T>) => void;
  // Right-side slot; when omitted, findings count and cost render by default.
  renderAdornment?: (node: NavTreeNode<T>) => ReactNode;
};

function DefaultAdornment<T>({ node }: { node: NavTreeNode<T> }) {
  return (
    <span className="flex items-center gap-2 text-xs text-neutral-500">
      {node.findingsCount !== undefined && node.findingsCount > 0 && (
        <span aria-label={`${node.findingsCount} findings`}>{node.findingsCount} findings</span>
      )}
      {node.costUsd !== undefined && node.costUsd > 0 && <span>${node.costUsd.toFixed(2)}</span>}
    </span>
  );
}

function NavTreeItem<T>({ node, depth, props }: { node: NavTreeNode<T>; depth: number; props: NavTreeProps<T> }) {
  const selected = props.selectedId === node.id;
  return (
    <li role="treeitem" aria-selected={selected}>
      <button
        type="button"
        onClick={() => props.onSelect?.(node)}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        className={`flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm ${
          selected ? 'bg-neutral-800 text-neutral-100' : 'text-neutral-300 hover:bg-neutral-900'
        }`}
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate">{node.title}</span>
          {node.status !== undefined && (
            <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] ${toneClasses[node.statusTone ?? 'neutral']}`}>
              {node.status}
            </span>
          )}
        </span>
        {props.renderAdornment ? props.renderAdornment(node) : <DefaultAdornment node={node} />}
      </button>
      {node.children !== undefined && node.children.length > 0 && (
        <ul role="group">
          {node.children.map((child) => (
            <NavTreeItem key={child.id} node={child} depth={depth + 1} props={props} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function NavTree<T = unknown>(props: NavTreeProps<T>) {
  return (
    <ul role="tree" className="space-y-0.5">
      {props.nodes.map((node) => (
        <NavTreeItem key={node.id} node={node} depth={0} props={props} />
      ))}
    </ul>
  );
}
