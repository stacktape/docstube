import type { NavTreeNode } from './nav-tree.tsx';
import { NavTree } from './nav-tree.tsx';
import type { IaEditOp, WizardIaNode } from './wizard-state.ts';
import { depthBudgets, findIaNode, slugify } from './wizard-state.ts';

// The IA editor (PRODUCT §3.9.2 step 5): the reusable NavTree for structure + selection, and an
// editor panel for the selected node (title, slug, brief, depth budget, structural ops). Reorder
// and reparent are buttons this wave — drag-and-drop is a later polish pass on the same ops.

type IaEditorProps = {
  tree: WizardIaNode[];
  selectedUid: string | undefined;
  onSelect: (uid: string | undefined) => void;
  onEdit: (op: IaEditOp) => void;
};

const toNavNodes = (nodes: WizardIaNode[]): NavTreeNode[] =>
  nodes.map((node) => ({
    id: node.uid,
    title: node.title.trim().length > 0 ? node.title : '(untitled)',
    ...(node.depth === undefined ? {} : { status: node.depth, statusTone: 'neutral' as const }),
    children: toNavNodes(node.children)
  }));

const fieldClasses =
  'w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100 focus:border-neutral-500 focus:outline-none';

const opButtonClasses =
  'rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:border-neutral-500 hover:text-neutral-100';

export function IaEditor({ tree, selectedUid, onSelect, onEdit }: IaEditorProps) {
  const selected = selectedUid === undefined ? undefined : findIaNode(tree, selectedUid);
  return (
    <div className="flex gap-4">
      <div className="min-w-0 flex-1 space-y-2 rounded border border-neutral-800 p-3">
        {tree.length === 0 ? (
          <p className="px-2 py-1 text-sm text-neutral-500">
            No pages yet — propose with AI above, or build the tree by hand.
          </p>
        ) : (
          <NavTree
            nodes={toNavNodes(tree)}
            {...(selectedUid === undefined ? {} : { selectedId: selectedUid })}
            onSelect={(node) => onSelect(node.id)}
            renderAdornment={() => null}
          />
        )}
        <button type="button" className={opButtonClasses} onClick={() => onEdit({ kind: 'add-child', uid: undefined })}>
          + Add top-level page
        </button>
        <p className="text-xs text-neutral-600">
          Drag-and-drop reorder is coming — use the move / indent / outdent buttons for now.
        </p>
      </div>
      <aside className="w-80 shrink-0 space-y-3 rounded border border-neutral-800 p-3">
        {selected === undefined ? (
          <p className="text-sm text-neutral-500">Select a node to edit its brief and structure.</p>
        ) : (
          <>
            <label className="block space-y-1 text-xs text-neutral-400">
              <span>Title</span>
              <input
                className={fieldClasses}
                value={selected.title}
                onChange={(event) => {
                  const title = event.target.value;
                  // Follow the title with an auto-slug only while the slug is still the derived
                  // one — a hand-edited slug is user intent and stays put.
                  const patch =
                    selected.slug === slugify(selected.title) || selected.slug === 'new-page'
                      ? { title, slug: slugify(title) }
                      : { title };
                  onEdit({ kind: 'update', uid: selected.uid, patch });
                }}
              />
            </label>
            <label className="block space-y-1 text-xs text-neutral-400">
              <span>Slug</span>
              <input
                className={fieldClasses}
                value={selected.slug}
                onChange={(event) => onEdit({ kind: 'update', uid: selected.uid, patch: { slug: event.target.value } })}
              />
            </label>
            <label className="block space-y-1 text-xs text-neutral-400">
              <span>Page brief (seeds the writer; leave empty for a pure grouping node)</span>
              <textarea
                className={`${fieldClasses} min-h-24`}
                value={selected.brief}
                onChange={(event) =>
                  onEdit({ kind: 'update', uid: selected.uid, patch: { brief: event.target.value } })
                }
              />
            </label>
            <label className="block space-y-1 text-xs text-neutral-400">
              <span>Depth budget</span>
              <select
                className={fieldClasses}
                value={selected.depth ?? ''}
                onChange={(event) =>
                  onEdit({
                    kind: 'update',
                    uid: selected.uid,
                    patch: {
                      depth:
                        event.target.value === '' ? undefined : (event.target.value as (typeof depthBudgets)[number])
                    }
                  })
                }
              >
                <option value="">(unset)</option>
                {depthBudgets.map((budget) => (
                  <option key={budget} value={budget}>
                    {budget}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                className={opButtonClasses}
                onClick={() => onEdit({ kind: 'add-child', uid: selected.uid })}
              >
                Add child
              </button>
              <button
                type="button"
                className={opButtonClasses}
                onClick={() => onEdit({ kind: 'add-sibling', uid: selected.uid })}
              >
                Add sibling
              </button>
              <button
                type="button"
                className={opButtonClasses}
                onClick={() => onEdit({ kind: 'move', uid: selected.uid, direction: 'up' })}
              >
                Move up
              </button>
              <button
                type="button"
                className={opButtonClasses}
                onClick={() => onEdit({ kind: 'move', uid: selected.uid, direction: 'down' })}
              >
                Move down
              </button>
              <button
                type="button"
                className={opButtonClasses}
                onClick={() => onEdit({ kind: 'indent', uid: selected.uid })}
              >
                Indent
              </button>
              <button
                type="button"
                className={opButtonClasses}
                onClick={() => onEdit({ kind: 'outdent', uid: selected.uid })}
              >
                Outdent
              </button>
              <button
                type="button"
                className={`${opButtonClasses} border-rose-900 text-rose-300 hover:border-rose-700 hover:text-rose-200`}
                onClick={() => onEdit({ kind: 'remove', uid: selected.uid })}
              >
                Remove
              </button>
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
