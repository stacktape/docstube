// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NavTreeNode } from './nav-tree.tsx';
import { NavTree } from './nav-tree.tsx';

afterEach(cleanup);

const nodes: NavTreeNode[] = [
  {
    id: 'pg_root',
    title: 'Getting started',
    status: 'passed',
    statusTone: 'success',
    findingsCount: 2,
    costUsd: 0.42,
    children: [{ id: 'pg_child', title: 'Installation', status: 'writing', statusTone: 'active' }]
  },
  { id: 'pg_flagged', title: 'Configuration', status: 'flagged', statusTone: 'danger' }
];

describe('NavTree', () => {
  it('renders titles, status badges, findings count, and cost for nested nodes', () => {
    render(<NavTree nodes={nodes} />);
    expect(screen.getByText('Getting started')).toBeDefined();
    expect(screen.getByText('Installation')).toBeDefined();
    expect(screen.getByText('passed')).toBeDefined();
    expect(screen.getByText('writing')).toBeDefined();
    expect(screen.getByText('flagged')).toBeDefined();
    expect(screen.getByText('2 findings')).toBeDefined();
    expect(screen.getByText('$0.42')).toBeDefined();
  });

  it('invokes onSelect with the clicked node and marks the selection', () => {
    const onSelect = vi.fn<(node: NavTreeNode) => void>();
    render(<NavTree nodes={nodes} selectedId="pg_child" onSelect={onSelect} />);
    fireEvent.click(screen.getByText('Configuration'));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0]?.[0]).toMatchObject({ id: 'pg_flagged', title: 'Configuration' });

    const selected = screen.getAllByRole('treeitem').find((item) => item.getAttribute('aria-selected') === 'true');
    expect(selected?.textContent).toContain('Installation');
  });

  it('renders a custom right-side adornment when the slot is provided', () => {
    render(<NavTree nodes={nodes} renderAdornment={(node) => <em>slot:{node.id}</em>} />);
    expect(screen.getByText('slot:pg_flagged')).toBeDefined();
    expect(screen.queryByText('2 findings')).toBeNull();
  });
});
