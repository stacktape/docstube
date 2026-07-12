// Assemble the rendered slide PNGs into a .pptx with speaker notes.
// Each slide is one full-bleed 16:9 image; the HTML/CSS in this folder is the
// editable source. Run shoot.mjs first to (re)generate ./assets, then this.
// Usage: node build.mjs [outFile]
//
// ORDER maps deck position -> source file number. File numbers do NOT match
// deck order (slides were inserted/moved across rounds); ORDER is the source of
// truth for sequence, and each HTML footer carries its own sequential page number.
import pptxgen from 'pptxgenjs';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const HERE = import.meta.dirname;
const ASSETS = resolve(HERE, 'assets');
const OUT = process.argv[2] || resolve(HERE, '..', 'docstube-pitch-deck-v2.pptx');

const ORDER = [1, 2, 3, 15, 5, 6, 7, 8, 4, 9, 10, 12, 16, 11, 13, 14];

// Speaker notes per deck position (16). Plain, spoken voice; no em-dashes.
const notes = [
  'The whole thesis in one line: verified docs, generated from your code, running on your own AI, that you own. Every slide after this proves those four claims.',
  'This is not a tooling gap. It is structural. Humans cannot keep docs correct, complete, and written for the reader at the speed code moves now. Every team has all three problems.',
  'One model or one prompt can write docs that look right. It cannot reliably find its own mistakes. That is the hard part. docstube runs a supervised, multi-step, agentic checking process, so finding the wrong parts and fixing them becomes reliable. This screen is the drift report, where docs disagree with code. It is also the artifact the go-to-market uses later. Everyone else generates and hopes. docstube finds the problems, then fixes or flags them.',
  'The 2026 row is the key beat. Docs got a second reader: AI agents are now 45.3% of requests to popular docs (Mintlify, March 2026), and an agent that follows a wrong page breaks things, it does not just get annoyed. That turns verification from a nice-to-have into infrastructure. The trust gap is real too: 96% of developers do not fully trust AI-written code (Sonar, 2026). The bottom line carries the origin story, do not expand it on the slide. We hit this documenting Stacktape, and the pipeline we built to survive it is where docstube comes from.',
  'This is the moat. Three layers. Deterministic checks are mechanical truth, true or false no matter how smart the model is. AI review is the soft correctness a compiler cannot check. Persona review is audience fit. The deterministic layer is the one no competitor has. Remember it for the comparison slide.',
  'The loop is the product. Generation is cheap. The value is the review-and-verify cycle that fixes a page or flags it for a human. You configure once. It keeps the docs current after that.',
  'This answers a fair question: is the output actually good, or just generated markdown? It is a real, fast, good-looking docs site you own, with search, API reference, and diagrams. It is also machine-readable, with llms.txt and an MCP server. The conversational "Ask AI over your docs" is a hosted Cloud feature, so we keep it off this screen to protect the runs-on-your-AI, source-stays-local story.',
  'This is the efficiency moat, and it sets up the objections later. Better models do not remove it. Regenerating everything on every commit is always wasteful. Symbol-level provenance makes docstube cheaper to run, on whatever model you bring. The GitHub Action opens a real pull request, with the diff, the checks that passed, and the token savings, so a human still approves the merge.',
  'Two audiences, two jobs. Public docs for open-source maintainers are the distribution engine: free, viral, and every published site advertises the tool. Internal wikis are the real target and where the money is: land free in as many companies as possible, then upsell to Cloud. Public is not a side project. It is how we reach the companies that internal monetizes.',
  'This is the payoff slide. One row, deterministic verification, is blank for every shipping competitor. That blank row is the space docstube is built to own. Pre-product or not, this is the position.',
  'The point is why this specific market is winnable, not a general law about startups. Three real reasons. First, we are the open-source option in a market of paid, closed tools, and open tools tend to win developer categories. Second, verification is genuinely new and unclaimed, so we get a first-mover position plus an open-source lead that compounds before others catch up. Third, it fits our strengths, real DevTools experience and strong developer-experience instinct, with a real head start of five weeks already spent on it while building Stacktape docs. Keep it grounded and specific.',
  'The one-year goal is to become the default open-source docs tool. The argument: open-source is structurally cheaper and easier to grow than paid SaaS. It gets free exposure on the channels developers actually use, has near-zero friction and no procurement barriers to try, and spreads by word of mouth and contributors, so the marketing burden is low, which suits a small team. The drift report is the first concrete growth play, presented as our opening move, not the only one. Do not overclaim it as a guaranteed viral engine.',
  'The model is open-core. The MIT tool is genuinely free and drives adoption; Cloud sells what a single repo cannot have: one brain across all your projects, an Ask agent and a coding-agent MCP over every repo, a fleet docs-health view, and governance. We never mark up tokens, so revenue comes from the cross-repo layer, not from reselling AI. The Cloud floor of about $10k to $15k a year is within open-core norms (Grafana publishes $25k, Read the Docs $10k) and doubles as a mid-market filter, since the buyer is mid-market and up.',
  'The posture is confidence, not defense. First objection: verification does not depend on the model getting worse, it scales with how much gets generated. Second: this is paradigm and business-model lock-in, not just inertia. Third: it turns the platform-risk worry into the efficiency story. The point investors should leave with: the trend everyone worries about, AI everywhere, is the tailwind under this company.',
  "Whoever owns the machine-readable documentation layer owns a piece of every AI product built on top. That is the logic behind these deals. docstube's job is to become that default through adoption. Ubiquity then converts, either by getting acquired or by building a standalone Cloud business on open-core. We don't have to choose now; wide adoption is what makes either one possible. Label the numbers honestly: the Stainless price is reported at about $300M (The Information), Mintlify's $500M was co-led by a16z and Salesforce, and Cognition's $26B is a post-money round. Do not overstate the reported ones.",
  'This ends on vision plus near-term momentum. The plan mirrors the strategy: free adoption first, revenue later. "Adopted by real teams" and "first paying customers" are directional goals, not forecasts, so keep them unquantified. The .docstube-folder line is the close: docstube becomes the default way docs work, which is the ubiquity the exit rests on.'
];

const missing = ORDER.map((i) => resolve(ASSETS, `slide-${String(i).padStart(2, '0')}.png`)).filter((p) => !existsSync(p));
if (missing.length) {
  console.error('Missing slide PNGs (run `node shoot.mjs` first):\n' + missing.join('\n'));
  process.exit(1);
}

const pptx = new pptxgen();
pptx.layout = 'LAYOUT_WIDE'; // 13.333 x 7.5 in, true 16:9
pptx.author = 'docstube';
pptx.company = 'docstube';
pptx.title = 'docstube Pitch Deck';
pptx.subject = 'Verified docs, generated from your code';

ORDER.forEach((fileNum, k) => {
  const n = String(fileNum).padStart(2, '0');
  const slide = pptx.addSlide();
  slide.background = { color: 'F5FAF9' };
  slide.addImage({ path: resolve(ASSETS, `slide-${n}.png`), x: 0, y: 0, w: 13.333, h: 7.5 });
  slide.addNotes(notes[k]);
});

await pptx.writeFile({ fileName: OUT });
console.log('wrote', OUT, '(' + ORDER.length + ' slides)');
