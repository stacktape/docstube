// Section marker convention for generated MDX pages.
//
// Generated pages embed machine-readable section markers as MDX/JSX comments so the
// incremental engine and verifiers can locate a section's bounds without parsing prose. The
// convention is a balanced start/end pair around each section:
//
//   {/* docstube:section:start id=getting-started */}
//   ...section body...
//   {/* docstube:section:end id=getting-started */}
//
// These helpers are the single source of truth for building and parsing those markers.

export const sectionMarkerNamespace = 'docstube:section';

export const sectionMarkerKinds = ['start', 'end'] as const;

export type SectionMarkerKind = (typeof sectionMarkerKinds)[number];

export type SectionMarker = {
  kind: SectionMarkerKind;
  sectionId: string;
};

// A single kebab-case section ID segment, matching `sectionIdSchema` in `page-schema.ts`.
const sectionIdSource = '[a-z0-9]+(?:-[a-z0-9]+)*';

const markerSource = `\\{/\\*\\s*${sectionMarkerNamespace}:(start|end)\\s+id=(${sectionIdSource})\\s*\\*/\\}`;

const singleMarkerPattern = new RegExp(`^${markerSource}$`);

// Build a section marker comment for the given kind and section ID.
export const buildSectionMarker = (kind: SectionMarkerKind, sectionId: string): string =>
  `{/* ${sectionMarkerNamespace}:${kind} id=${sectionId} */}`;

// Parse a single trimmed line into a section marker, or null when it is not a marker.
export const parseSectionMarker = (text: string): SectionMarker | null => {
  const match = singleMarkerPattern.exec(text.trim());
  if (!match) {
    return null;
  }

  return { kind: match[1] as SectionMarkerKind, sectionId: match[2]! };
};

// Extract every section marker from MDX text, in document order.
export const extractSectionMarkers = (mdx: string): SectionMarker[] => {
  const pattern = new RegExp(markerSource, 'g');
  const markers: SectionMarker[] = [];

  for (const match of mdx.matchAll(pattern)) {
    markers.push({ kind: match[1] as SectionMarkerKind, sectionId: match[2]! });
  }

  return markers;
};
