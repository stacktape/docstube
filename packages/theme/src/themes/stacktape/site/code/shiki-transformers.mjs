// Stacktape theme shiki transformers (ThemeBuild.shiki.transformers contract: default export is
// an ARRAY of transformers the kernel spreads into markdown.shikiConfig). Ports the source
// pipeline's [!code highlight] / [!code focus] comment markers (spec §5.6) via the official
// notation transformers; the classes they emit are styled by styles/global.css.
import { transformerNotationFocus, transformerNotationHighlight } from '@shikijs/transformers';

export default [
  transformerNotationHighlight({ matchAlgorithm: 'v3' }),
  transformerNotationFocus({ matchAlgorithm: 'v3' })
];
