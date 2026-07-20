# Release scope & DX v2 — founder decisions (2026-07-19)

Source: Sol xhigh design review domains 06-09, adjudicated by the founder. Binding for 0.1.0.

## Decisions

1. **Versioned docs are CUT from 0.1.0.** No cut command, no version switcher, no frozen shards
   in the release. docstube 0.1.0 documents `latest` only. The complete snapshot lifecycle
   (cut → store → render → switch → sealed + explicit repair, per i18n-lifecycle-v2 decision 6)
   ships whole as a v1.x headline. Config keeps `versions.current` for forward-compat; the
   half-built version-cut/state code is parked, not deleted.

2. **Primary persona per page.** ia.yml nodes carry a primary persona (wizard infers defaults:
   getting-started → newcomer-type persona, plugin-authoring → integrator; hand-editable). The
   writer targets the primary persona; ONLY the primary persona's review gates the page.
   Secondary personas run as advisory reviews on a sampled subset; refine may act on their
   findings. Kills the persona-multiplier on review cost and the "for everyone" prose mush.

3. **Immediate targeted regeneration on answers/feedback.** The moment a maintainer answers a
   tribal question or accepts feedback, a diff-edit task runs on exactly the affected pages
   (the pipeline-v2 minimal-edit machinery makes this cheap) — answer-to-effect in minutes, no
   dirty queue. Feedback defaults to entity-scoped (the block/page it was given on); promotion
   to a project-wide rule is an explicit choice.

4. **Deployment: local artifact only for 0.1.0** (founder chose against the GitHub Pages
   integration). 0.1.0 explicitly stops at the built static site; a first-class "Deploying"
   docs page covers Pages/Netlify/Vercel/S3 patterns. No deployment surface owned or maintained.
   (The GitHub Action still refreshes docs; it just doesn't publish hosting.)
