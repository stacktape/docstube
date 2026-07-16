import type { DocType, Persona } from '@docstube/contracts';
import type { ImportSource, ImportSourceKind, WizardAction, WizardState } from './wizard-state.ts';
import { importSourceKinds, registryComponents } from './wizard-state.ts';

// The simple wizard steps (PRODUCT §3.9.2 steps 1-4, 6, 8, 9). Steps 5 (IA), 7 (theme) and 10
// (start) have their own modules.

export type StepProps = {
  state: WizardState;
  dispatch: (action: WizardAction) => void;
};

export const fieldClasses =
  'w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100 focus:border-neutral-500 focus:outline-none';

export const smallButtonClasses =
  'rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:border-neutral-500 hover:text-neutral-100';

export function StepHeading({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="space-y-1">
      <h2 className="text-base font-semibold text-neutral-100">{title}</h2>
      <p className="text-sm text-neutral-400">{hint}</p>
    </div>
  );
}

const docTypeCards: Array<{ docType: DocType; title: string; description: string }> = [
  {
    docType: 'internal',
    title: 'Internal',
    description: 'Docs for engineers working inside this codebase: architecture, modules, onboarding.'
  },
  {
    docType: 'external-library',
    title: 'External · Library',
    description: 'Docs for developers integrating a library, SDK, or API into their own application.'
  },
  {
    docType: 'external-product',
    title: 'External · Product',
    description: 'Docs for people using and operating a product: guides, configuration, administration.'
  }
];

export function DocTypeStep({ state, dispatch }: StepProps) {
  return (
    <div className="space-y-4">
      <StepHeading title="Doc type" hint="Detected from manifest signals when unambiguous — otherwise pick one." />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {docTypeCards.map((card) => {
          const selected = state.docType === card.docType;
          return (
            <button
              key={card.docType}
              type="button"
              aria-pressed={selected}
              onClick={() => dispatch({ type: 'set-doc-type', docType: card.docType })}
              className={`rounded-lg border p-4 text-left ${
                selected
                  ? 'border-sky-500 bg-sky-950/40 text-neutral-100'
                  : 'border-neutral-800 text-neutral-300 hover:border-neutral-600'
              }`}
            >
              <span className="block text-sm font-semibold">{card.title}</span>
              <span className="mt-1 block text-xs text-neutral-400">{card.description}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function ContextStep({ state, dispatch }: StepProps) {
  return (
    <div className="space-y-4">
      <StepHeading
        title="Project context"
        hint="What the project is and who it is for. Pre-filled from your README/manifest — extracted, never generated."
      />
      <textarea
        aria-label="Project context"
        className={`${fieldClasses} min-h-32`}
        value={state.projectContext}
        onChange={(event) => dispatch({ type: 'set-project-context', value: event.target.value })}
      />
    </div>
  );
}

export function PersonasStep({ state, dispatch }: StepProps) {
  const setPersona = (index: number, patch: Partial<Persona>) => {
    dispatch({
      type: 'set-personas',
      personas: state.personas.map((persona, i) => (i === index ? { ...persona, ...patch } : persona))
    });
  };
  return (
    <div className="space-y-4">
      <StepHeading
        title="Personas"
        hint="The audiences the docs are written and reviewed for. Suggestions come from a static per-doc-type catalog — edit freely."
      />
      <div className="space-y-2">
        {state.personas.map((persona, index) => (
          <div key={index} className="flex items-start gap-2">
            <input
              aria-label={`Persona ${index + 1} id`}
              className={`${fieldClasses} w-48`}
              placeholder="persona-id"
              value={persona.id}
              onChange={(event) => setPersona(index, { id: event.target.value })}
            />
            <input
              aria-label={`Persona ${index + 1} description`}
              className={fieldClasses}
              placeholder="Who they are and what they need from the docs"
              value={persona.description}
              onChange={(event) => setPersona(index, { description: event.target.value })}
            />
            <button
              type="button"
              className={smallButtonClasses}
              onClick={() => dispatch({ type: 'set-personas', personas: state.personas.filter((_, i) => i !== index) })}
            >
              Remove
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        className={smallButtonClasses}
        onClick={() => dispatch({ type: 'set-personas', personas: [...state.personas, { id: '', description: '' }] })}
      >
        + Add persona
      </button>
    </div>
  );
}

function PathListEditor({
  label,
  values,
  onChange
}: {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
}) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-neutral-200">{label}</h3>
      {values.map((value, index) => (
        <div key={index} className="flex gap-2">
          <input
            aria-label={`${label} path ${index + 1}`}
            className={fieldClasses}
            value={value}
            onChange={(event) => onChange(values.map((v, i) => (i === index ? event.target.value : v)))}
          />
          <button
            type="button"
            className={smallButtonClasses}
            onClick={() => onChange(values.filter((_, i) => i !== index))}
          >
            Remove
          </button>
        </div>
      ))}
      <button type="button" className={smallButtonClasses} onClick={() => onChange([...values, ''])}>
        + Add path
      </button>
    </div>
  );
}

export function SourcesStep({ state, dispatch }: StepProps) {
  const setImport = (index: number, patch: Partial<ImportSource>) => {
    dispatch({
      type: 'set-imports',
      imports: state.imports.map((entry, i) => (i === index ? { ...entry, ...patch } : entry))
    });
  };
  return (
    <div className="space-y-6">
      <StepHeading
        title="Sources (optional)"
        hint="OpenAPI/AsyncAPI specs are first-class truth sources next to code. Existing docs can be imported as reference context."
      />
      <PathListEditor
        label="OpenAPI specs"
        values={state.openapi}
        onChange={(values) => dispatch({ type: 'set-source-paths', field: 'openapi', values })}
      />
      <PathListEditor
        label="AsyncAPI specs"
        values={state.asyncapi}
        onChange={(values) => dispatch({ type: 'set-source-paths', field: 'asyncapi', values })}
      />
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-neutral-200">Import existing docs</h3>
        <p className="rounded border border-amber-900/60 bg-amber-950/40 px-3 py-2 text-xs text-amber-200">
          Imported claims are unverified until re-grounded against the codebase.
        </p>
        {state.imports.map((entry, index) => (
          <div key={index} className="flex gap-2">
            <select
              aria-label={`Import ${index + 1} kind`}
              className={`${fieldClasses} w-40`}
              value={entry.kind}
              onChange={(event) => setImport(index, { kind: event.target.value as ImportSourceKind })}
            >
              {importSourceKinds.map((kind) => (
                <option key={kind} value={kind}>
                  {kind}
                </option>
              ))}
            </select>
            <input
              aria-label={`Import ${index + 1} location`}
              className={fieldClasses}
              placeholder="URL or path of the existing docs"
              value={entry.location}
              onChange={(event) => setImport(index, { location: event.target.value })}
            />
            <button
              type="button"
              className={smallButtonClasses}
              onClick={() => dispatch({ type: 'set-imports', imports: state.imports.filter((_, i) => i !== index) })}
            >
              Remove
            </button>
          </div>
        ))}
        <button
          type="button"
          className={smallButtonClasses}
          onClick={() =>
            dispatch({ type: 'set-imports', imports: [...state.imports, { kind: 'mintlify', location: '' }] })
          }
        >
          + Add importer
        </button>
      </div>
    </div>
  );
}

function LocaleChips({ locales, onRemove }: { locales: string[]; onRemove: (locale: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {locales.map((locale) => (
        <span
          key={locale}
          className="flex items-center gap-1 rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-200"
        >
          {locale}
          <button type="button" aria-label={`Remove locale ${locale}`} onClick={() => onRemove(locale)}>
            ×
          </button>
        </span>
      ))}
    </div>
  );
}

export function VersionsStep({ state, dispatch }: StepProps) {
  return (
    <div className="space-y-6">
      <StepHeading
        title="Versions & locales"
        hint="Declare the current version label and the locales the docs ship in."
      />
      <label className="block max-w-xs space-y-1 text-xs text-neutral-400">
        <span>Current version label</span>
        <input
          className={fieldClasses}
          value={state.currentVersion}
          onChange={(event) => dispatch({ type: 'set-version', value: event.target.value })}
        />
      </label>
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-neutral-200">Frozen versions</h3>
        {state.frozenVersions.length === 0 ? (
          <p className="text-xs text-neutral-500">None yet.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {state.frozenVersions.map((label) => (
              <span key={label} className="rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-300">
                {label}
              </span>
            ))}
          </div>
        )}
        <p className="text-xs text-neutral-500">
          Read-only — frozen versions are cut at release time, not from the wizard.
        </p>
      </div>
      <label className="block max-w-xs space-y-1 text-xs text-neutral-400">
        <span>Source locale</span>
        <input
          className={fieldClasses}
          value={state.sourceLocale}
          onChange={(event) => dispatch({ type: 'set-source-locale', value: event.target.value })}
        />
      </label>
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-neutral-200">Target locales</h3>
        <LocaleChips
          locales={state.targetLocales}
          onRemove={(locale) =>
            dispatch({ type: 'set-target-locales', values: state.targetLocales.filter((l) => l !== locale) })
          }
        />
        <AddLocale
          onAdd={(locale) => {
            if (!state.targetLocales.includes(locale)) {
              dispatch({ type: 'set-target-locales', values: [...state.targetLocales, locale] });
            }
          }}
        />
      </div>
    </div>
  );
}

function AddLocale({ onAdd }: { onAdd: (locale: string) => void }) {
  return (
    <form
      className="flex max-w-xs gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const input = event.currentTarget.elements.namedItem('locale') as HTMLInputElement;
        const value = input.value.trim();
        if (value.length > 0) {
          onAdd(value);
          input.value = '';
        }
      }}
    >
      <input name="locale" aria-label="Add target locale" placeholder="de, pt-BR, …" className={fieldClasses} />
      <button type="submit" className={smallButtonClasses}>
        Add
      </button>
    </form>
  );
}

export function MetadataStep({ state, dispatch }: StepProps) {
  const field = (
    label: string,
    fieldName: 'siteTitle' | 'siteDescription' | 'logo' | 'favicon',
    placeholder: string
  ) => (
    <label className="block max-w-lg space-y-1 text-xs text-neutral-400">
      <span>{label}</span>
      <input
        className={fieldClasses}
        placeholder={placeholder}
        value={state[fieldName]}
        onChange={(event) => dispatch({ type: 'set-site-field', field: fieldName, value: event.target.value })}
      />
    </label>
  );
  return (
    <div className="space-y-4">
      <StepHeading
        title="Site metadata"
        hint="Title and description of the generated docs site, plus branding assets."
      />
      {field('Site title', 'siteTitle', 'My Project Docs')}
      {field('Description', 'siteDescription', 'One sentence for search engines and link previews')}
      {field('Logo path (repo-relative)', 'logo', 'assets/logo.svg')}
      {field('Favicon path (repo-relative)', 'favicon', 'assets/favicon.ico')}
    </div>
  );
}

export function ComponentsStep({ state, dispatch }: StepProps) {
  return (
    <div className="space-y-4">
      <StepHeading
        title="Components"
        hint="MDX components the writer may use. Each one is a registered block type with verified props."
      />
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        {registryComponents.map((component) => (
          <label
            key={component.name}
            className="flex cursor-pointer items-start gap-2 rounded border border-neutral-800 p-3 hover:border-neutral-600"
          >
            <input
              type="checkbox"
              className="mt-0.5"
              checked={state.components.includes(component.name)}
              onChange={() => dispatch({ type: 'toggle-component', name: component.name })}
            />
            <span>
              <span className="block text-sm font-semibold text-neutral-100">{component.name}</span>
              <span className="block text-xs text-neutral-400">{component.description}</span>
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}
