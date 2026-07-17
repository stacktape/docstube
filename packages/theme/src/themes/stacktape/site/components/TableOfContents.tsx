import { useEffect, useMemo, useState } from 'react';

// Table of contents island — near-verbatim port of the source TableOfContents.tsx
// (theme-spec-stacktape.md §4): the curved SVG rail with the dash-offset "snake" that follows the
// active heading, IntersectionObserver active tracking, exact geometry constants. Adapted input:
// Astro's MDX `headings` ({ depth, slug, text }) instead of the source's TableOfContentsItem[].

export type TocHeading = { depth: number; slug: string; text: string };

const ROW_HEIGHT = 26;
const INDENT_PX = 12;
const PATH_X_OFFSET = 8;
const TRANSITION_ZONE = 8;
const TEXT_GAP = 14;
const SNAKE_LENGTH = 18;

type Point = { x: number; y: number };

const sampleBezierLength = (p0: Point, p1: Point, p2: Point, p3: Point, samples = 16) => {
  let total = 0;
  let prev = p0;
  for (let i = 1; i <= samples; i++) {
    const t = i / samples;
    const t1 = 1 - t;
    const x = t1 * t1 * t1 * p0.x + 3 * t1 * t1 * t * p1.x + 3 * t1 * t * t * p2.x + t * t * t * p3.x;
    const y = t1 * t1 * t1 * p0.y + 3 * t1 * t1 * t * p1.y + 3 * t1 * t * t * p2.y + t * t * t * p3.y;
    total += Math.hypot(x - prev.x, y - prev.y);
    prev = { x, y };
  }
  return total;
};

const AlignRightIcon = () => (
  <svg
    width="15"
    height="15"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <line x1="21" y1="10" x2="7" y2="10" />
    <line x1="21" y1="6" x2="3" y2="6" />
    <line x1="21" y1="14" x2="3" y2="14" />
    <line x1="21" y1="18" x2="7" y2="18" />
  </svg>
);

export function TableOfContents({ headings }: { headings: TocHeading[] }) {
  const [activeId, setActiveId] = useState<string>('');

  // Skip depth 1: the page heading already renders as the page title above the body.
  const items = useMemo(() => headings.filter((item) => (item.depth || 1) > 1), [headings]);

  useEffect(() => {
    const headingElements = items
      .map((item) => document.getElementById(item.slug))
      .filter((element): element is HTMLElement => element !== null);
    if (headingElements.length === 0) {
      return undefined;
    }

    const setInitialActiveHeading = () => {
      const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
      if (scrollTop < 100) {
        setActiveId(headingElements[0]!.id);
        return;
      }
      const above = headingElements
        .map((el) => ({ id: el.id, top: el.getBoundingClientRect().top }))
        .filter((heading) => heading.top < 75)
        .toSorted((a, b) => b.top - a.top);
      setActiveId(above[0]?.id ?? headingElements[0]!.id);
    };

    const rafId = requestAnimationFrame(setInitialActiveHeading);

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .toSorted((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible.length > 0) {
          setActiveId(visible[0]!.target.id);
          return;
        }
        const above = headingElements
          .map((el) => ({ id: el.id, top: el.getBoundingClientRect().top }))
          .filter((heading) => heading.top < 75)
          .toSorted((a, b) => b.top - a.top);
        if (above.length > 0) {
          setActiveId(above[0]!.id);
        }
      },
      { rootMargin: '-75px 0% -80% 0%', threshold: 0 }
    );
    for (const element of headingElements) {
      observer.observe(element);
    }

    return () => {
      cancelAnimationFrame(rafId);
      observer.disconnect();
    };
  }, [items]);

  const { pathD, svgWidth, svgHeight, minLevel, cumLen } = useMemo(() => {
    if (items.length === 0) {
      return { pathD: '', svgWidth: 0, svgHeight: 0, minLevel: 1, cumLen: [] as number[] };
    }
    const minLvl = Math.min(...items.map((item) => item.depth || 1));
    const maxLvl = Math.max(...items.map((item) => item.depth || 1));
    const pts = items.map((item, i) => ({
      x: PATH_X_OFFSET + ((item.depth || 0) - minLvl) * INDENT_PX,
      y: i * ROW_HEIGHT + ROW_HEIGHT / 2
    }));

    // Build the path AND the cumulative length at each item's center, so the active "snake" can
    // be positioned along the curve with stroke-dashoffset (which animates along the path).
    let d = `M ${pts[0]!.x} 0`;
    let len = pts[0]!.y;
    d += ` L ${pts[0]!.x} ${pts[0]!.y}`;
    const lengths: number[] = [len];

    for (let i = 0; i < pts.length - 1; i++) {
      const cur = pts[i]!;
      const next = pts[i + 1]!;
      if (next.x === cur.x) {
        d += ` L ${next.x} ${next.y}`;
        len += next.y - cur.y;
      } else {
        const midY = (cur.y + next.y) / 2;
        d += ` L ${cur.x} ${midY - TRANSITION_ZONE}`;
        len += midY - TRANSITION_ZONE - cur.y;
        const c0 = { x: cur.x, y: midY - TRANSITION_ZONE };
        const c1 = { x: cur.x, y: midY };
        const c2 = { x: next.x, y: midY };
        const c3 = { x: next.x, y: midY + TRANSITION_ZONE };
        d += ` C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${c3.x} ${c3.y}`;
        len += sampleBezierLength(c0, c1, c2, c3);
        d += ` L ${next.x} ${next.y}`;
        len += next.y - (midY + TRANSITION_ZONE);
      }
      lengths.push(len);
    }
    d += ` L ${pts[pts.length - 1]!.x} ${pts.length * ROW_HEIGHT}`;

    return {
      pathD: d,
      svgWidth: PATH_X_OFFSET + (maxLvl - minLvl) * INDENT_PX + 4,
      svgHeight: pts.length * ROW_HEIGHT,
      minLevel: minLvl,
      cumLen: lengths
    };
  }, [items]);

  const activeIndex = items.findIndex((item) => activeId === item.slug);
  const hasActive = activeIndex >= 0 && cumLen[activeIndex] !== undefined;
  const activeLen = hasActive ? cumLen[activeIndex]! : 0;

  if (items.length === 0) {
    return null;
  }

  return (
    <div className="stp-toc">
      <p className="stp-toc-header">
        <AlignRightIcon />
        <span>Contents</span>
      </p>
      <div className="stp-toc-body">
        <svg className="stp-toc-svg" width={svgWidth} height={svgHeight}>
          <path d={pathD} stroke="#2F3434" strokeWidth={1} fill="none" />
          {hasActive && (
            <path
              className="stp-toc-snake"
              d={pathD}
              stroke="rgba(255,255,255,0.87)"
              strokeWidth={2}
              strokeLinecap="round"
              fill="none"
              strokeDasharray={`${SNAKE_LENGTH} 99999`}
              strokeDashoffset={SNAKE_LENGTH / 2 - activeLen}
            />
          )}
        </svg>
        <ul className="stp-toc-list">
          {items.map((item) => {
            const isActive = activeId === item.slug;
            const itemX = PATH_X_OFFSET + ((item.depth || 0) - minLevel) * INDENT_PX;
            return (
              <li key={item.slug} className="stp-toc-item">
                <a
                  href={`#${item.slug}`}
                  className={isActive ? 'stp-toc-link is-active' : 'stp-toc-link'}
                  style={{ paddingLeft: itemX + TEXT_GAP }}
                >
                  {item.text}
                </a>
              </li>
            );
          })}
        </ul>
      </div>
      <div style={{ height: 20 }} />
    </div>
  );
}
