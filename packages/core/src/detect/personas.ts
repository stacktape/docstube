import type { DocType, Persona } from '@docstube/contracts';

// Static per-doc-type persona catalog (PRODUCT §3.9.2: templates, not inference). Suggestions are
// starting points the wizard shows for the detected doc type; users edit freely.

const personaCatalog: Record<DocType, Persona[]> = {
  internal: [
    {
      id: 'backend-engineer',
      description: 'Engineer working in this codebase who needs architecture and module docs.'
    },
    { id: 'new-team-member', description: 'Developer onboarding onto the project for the first time.' }
  ],
  'external-library': [
    { id: 'app-developer', description: 'Developer integrating the library into their own application.' },
    { id: 'library-evaluator', description: 'Developer deciding whether the library fits their use case.' }
  ],
  'external-product': [
    { id: 'end-user', description: 'Person using the product to accomplish their day-to-day tasks.' },
    { id: 'administrator', description: 'Operator installing, configuring, and maintaining the product.' }
  ]
};

export const suggestPersonas = (docType: DocType): Persona[] =>
  personaCatalog[docType].map((persona) => ({ ...persona }));
