// Miniature live preview for wizard step 7 (PRODUCT §3.9.2): a styled in-page mock of the doc
// layout (heading, prose, code block, callout) that restyles instantly from the token values.
// TODO(later wave): replace this div mock with the real sample page in a scaled iframe so the
// preview is pixel-faithful to the emitted theme.

const fallbacks: Record<string, string> = {
  surface: '#0f1115',
  'surface-muted': '#171a21',
  'surface-raised': '#1d212b',
  text: '#e6e8ee',
  'text-muted': '#9aa1af',
  border: '#2a2f3a',
  accent: '#38bdf8',
  'accent-strong': '#0284c7',
  success: '#34d399',
  warning: '#fbbf24',
  danger: '#fb7185',
  'font-family': 'ui-sans-serif, system-ui, sans-serif'
};

export function ThemePreview({ tokens }: { tokens: Record<string, string> }) {
  const value = (name: string): string => {
    const set = tokens[name];
    return set !== undefined && set.trim().length > 0 ? set : (fallbacks[name] ?? '');
  };
  return (
    <div
      data-testid="theme-preview"
      className="overflow-hidden rounded-lg border"
      style={{
        backgroundColor: value('surface'),
        color: value('text'),
        borderColor: value('border'),
        fontFamily: value('font-family')
      }}
    >
      <div
        className="flex items-center justify-between border-b px-4 py-2 text-xs"
        style={{ backgroundColor: value('surface-muted'), borderColor: value('border') }}
      >
        <span className="font-semibold">Sample Docs</span>
        <span style={{ color: value('text-muted') }}>v1.0 · en</span>
      </div>
      <div className="space-y-3 p-4">
        <h4 className="text-base font-semibold">Getting started</h4>
        <p className="text-sm" style={{ color: value('text-muted') }}>
          Install the CLI, point it at your repository, and generate a verified documentation site.
        </p>
        <pre
          className="rounded border px-3 py-2 text-xs"
          style={{
            backgroundColor: value('surface-raised'),
            borderColor: value('border'),
            color: value('text'),
            fontFamily: 'ui-monospace, monospace'
          }}
        >
          npm install -g docstube
        </pre>
        <div
          className="rounded border-l-2 px-3 py-2 text-xs"
          style={{
            backgroundColor: value('surface-muted'),
            borderColor: value('accent'),
            color: value('text-muted')
          }}
        >
          <span className="font-semibold" style={{ color: value('text') }}>
            Note:
          </span>{' '}
          every claim on this page carries provenance back to source.
        </div>
        <div className="flex items-center gap-2 text-[11px]">
          <span
            className="rounded px-1.5 py-0.5"
            style={{ backgroundColor: value('success'), color: value('surface') }}
          >
            proven
          </span>
          <span
            className="rounded px-1.5 py-0.5"
            style={{ backgroundColor: value('warning'), color: value('surface') }}
          >
            scored
          </span>
          <span className="rounded px-1.5 py-0.5" style={{ backgroundColor: value('danger'), color: value('surface') }}>
            flagged
          </span>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <a data-testid="preview-accent-link" href="#preview" style={{ color: value('accent') }}>
            Read the quickstart →
          </a>
          <span
            className="rounded px-2 py-1 text-xs"
            style={{ backgroundColor: value('accent-strong'), color: value('text') }}
          >
            Get started
          </span>
        </div>
      </div>
    </div>
  );
}
