import { useEffect, useState } from 'react';

// Sidebar navigation island — port of the source SidebarNavigation/ContentTree*
// (theme-spec-stacktape.md §3) adapted to the kernel's nav shape: flat groups of entries from
// site-data.mjs instead of the source's deep frontmatter tree. Group rows use the uppercase
// header treatment, entries the raised-pill rows; expansion animates grid-template-rows over
// 220ms and user overrides persist in localStorage under the source's key.

export type SidebarEntry = { label: string; href: string };
export type SidebarGroup = { label: string | null; entries: SidebarEntry[] };

const EXPANSION_STORAGE_KEY = 'stacktape-docs-nav-state-v1';
const SCROLL_STORAGE_KEY = '_stp-sidebar-scroll-pos';

const readStoredExpansion = (): Record<string, boolean> => {
  try {
    return JSON.parse(window.localStorage.getItem(EXPANSION_STORAGE_KEY) ?? '{}') as Record<string, boolean>;
  } catch {
    return {};
  }
};

const writeStoredExpansion = (state: Record<string, boolean>) => {
  try {
    window.localStorage.setItem(EXPANSION_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // storage quota / sandbox — ignore
  }
};

const getScroller = (): HTMLElement | null =>
  [...document.querySelectorAll<HTMLElement>('[data-stp-sidebar-scroller]')].find((el) => el.offsetParent !== null) ??
  null;

// Sidebar scroll persistence across <ClientRouter /> navigations, wired once at module scope
// like the source: the island is transition:persist-ed but Astro resets scrollTop during the
// swap, so capture before and re-apply after (immediately and again once animations settle).
if (typeof window !== 'undefined' && !(window as Window & { stpSidebarScrollInit?: boolean }).stpSidebarScrollInit) {
  (window as Window & { stpSidebarScrollInit?: boolean }).stpSidebarScrollInit = true;
  let saved = 0;
  try {
    saved = parseInt(window.sessionStorage.getItem(SCROLL_STORAGE_KEY) ?? '0', 10) || 0;
  } catch {
    saved = 0;
  }
  const applySaved = () => {
    const el = getScroller();
    if (el && saved > 0 && Math.abs(el.scrollTop - saved) > 1) {
      el.scrollTop = saved;
    }
  };
  document.addEventListener(
    'scroll',
    (event) => {
      const el = getScroller();
      if (el && event.target === el) {
        saved = el.scrollTop;
        try {
          window.sessionStorage.setItem(SCROLL_STORAGE_KEY, String(saved));
        } catch {
          // ignore
        }
      }
    },
    true
  );
  document.addEventListener('astro:after-swap', () => {
    requestAnimationFrame(applySaved);
    setTimeout(applySaved, 300);
  });
  document.addEventListener('astro:page-load', () => {
    requestAnimationFrame(applySaved);
  });
}

const normalizePath = (path: string): string => (path.endsWith('/') ? path : `${path}/`);

const ChevronIcon = ({ expanded }: { expanded: boolean }) => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    style={{
      opacity: 0.5,
      flexShrink: 0,
      transition: 'transform 220ms ease',
      transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)'
    }}
  >
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

function SidebarRow({ entry, active }: { entry: SidebarEntry; active: boolean }) {
  return (
    <a
      href={entry.href}
      className={active ? 'stp-nav-row is-active' : 'stp-nav-row'}
      style={{ margin: '1px 8px' }}
      aria-current={active ? 'page' : undefined}
    >
      <span className="stp-nav-row-label">{entry.label}</span>
    </a>
  );
}

const slugifyLabel = (label: string): string =>
  label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

function SidebarGroupSection({
  group,
  expanded,
  currentPath,
  navId,
  onToggle
}: {
  group: SidebarGroup;
  expanded: boolean;
  currentPath: string;
  navId: string;
  onToggle: () => void;
}) {
  const rows = group.entries.map((entry) => (
    <SidebarRow key={entry.href} entry={entry} active={normalizePath(entry.href) === currentPath} />
  ));
  // The root (unlabeled) group renders without a header and never collapses — mirrors the
  // source's `__root` group holding the introduction page.
  if (group.label === null) {
    return <div style={{ marginBottom: 8 }}>{rows}</div>;
  }
  // navId disambiguates the desktop and mobile sidebar instances so aria-controls ids stay unique.
  const childrenId = `stp-nav-${navId}-${slugifyLabel(group.label)}`;
  return (
    <div style={{ position: 'relative', marginBottom: 8 }}>
      <div
        className="stp-nav-group-header"
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        aria-controls={childrenId}
        onClick={onToggle}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onToggle();
          }
        }}
      >
        <span style={{ flex: 1 }}>{group.label}</span>
        <ChevronIcon expanded={expanded} />
      </div>
      {/* inert drops collapsed links out of the tab order and accessibility tree while they
          animate closed and stay in the DOM (spec §3.5 collapsed-state semantics). */}
      <div
        id={childrenId}
        aria-hidden={!expanded}
        inert={!expanded}
        className="stp-nav-children"
        style={{ gridTemplateRows: expanded ? '1fr' : '0fr' }}
      >
        <div>
          <span className="stp-nav-guide" />
          {rows}
        </div>
      </div>
    </div>
  );
}

export function Sidebar({ groups, pathname, navId }: { groups: SidebarGroup[]; pathname: string; navId: string }) {
  // All groups start expanded (docstube sites have no configured default-open set); stored user
  // overrides load after mount so SSR markup and first client render always match.
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [currentPath, setCurrentPath] = useState(normalizePath(pathname));

  useEffect(() => {
    setOverrides(readStoredExpansion());
  }, []);

  // The island persists across <ClientRouter /> navigations, so the active pill must track the
  // URL itself — the pathname prop stays frozen at the first-rendered page.
  useEffect(() => {
    const sync = () => setCurrentPath(normalizePath(window.location.pathname));
    document.addEventListener('astro:page-load', sync);
    return () => document.removeEventListener('astro:page-load', sync);
  }, []);

  const toggle = (label: string) => {
    setOverrides((previous) => {
      const next = { ...previous, [label]: !(previous[label] ?? true) };
      writeStoredExpansion(next);
      return next;
    });
  };

  return (
    <div data-stp-sidebar-scroller className="stp-sidebar-scroller stp-pretty-scrollbar">
      {groups.map((group, index) => (
        <SidebarGroupSection
          key={group.label ?? `root-${index}`}
          group={group}
          expanded={group.label === null ? true : (overrides[group.label] ?? true)}
          currentPath={currentPath}
          navId={navId}
          onToggle={() => group.label !== null && toggle(group.label)}
        />
      ))}
      <div style={{ height: 25 }} />
    </div>
  );
}
