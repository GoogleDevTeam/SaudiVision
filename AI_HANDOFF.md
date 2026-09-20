# Imagine Saudi 2050 — Continuation Prompt

Copy the prompt below into the next AI session when continuing this project.

---

## Prompt for the next AI

Continue the existing **Imagine Saudi 2050** project. Do not recreate it from scratch, replace the architecture, remove existing functionality, or change the visual theme without a strong reason.

### Continuity and progress protocol

Do not make the user repeat project context. At the beginning of every session:

1. Read `AI_HANDOFF.md`.
2. Inspect the latest `main` branch and recent commits.
3. Check the current deployment state before assuming a change is live.
4. Compare the current code with the progress log below.
5. Continue from the next unfinished item instead of restarting discovery.

After every meaningful implementation, bug fix, deployment, or verification:

1. Update this file's **Progress log** with what changed.
2. Record the files and commit that changed.
3. Record tests run and whether GitHub Pages or Apps Script still needs deployment.
4. Update **Next recommended step**.
5. Commit the progress update together with the code whenever possible.

In every user-facing response, briefly state:

- Completed
- In progress or blocked
- Next recommended step

Only ask the user for information that cannot be discovered from the repository, deployment, or connected services. Never ask them to paste the organizer key or other secrets.

### Product

This is an interactive future-vision competition for Google Developer Groups on Campus — Shaqra University.

The flow is:

1. A participant submits a group name, strategic track, and Saudi Arabia 2050 vision.
2. The frontend asks the Apps Script backend for one server-generated concept image, then keeps the submission pending until organizer approval. Local demo mode remains available when the backend URL is empty.
3. Every new submission enters `pending`.
4. Organizers review pending submissions.
5. Organizers approve/publish or permanently delete submissions.
6. Only published visions appear in the public gallery.
7. The audience can vote.
8. Each browser voter can have one active vote and can unvote before voting for another vision.

### Repository and architecture

- Repository: https://github.com/GoogleDevTeam/SaudiVision
- Branch: `main`
- Frontend: `index.html`
- Backend: `google-apps-script.gs`
- Frontend architecture: vanilla single-file HTML/CSS/JavaScript
- Backend: Google Apps Script web app
- Database: Google Sheets
- Local demo mode is supported when the Apps Script URL is empty.
- Do not migrate to React, Vue, Tailwind, Firebase, or another backend unless explicitly requested.

### Current visual direction

Preserve these exact core colors:

- Dark green: `#073B35`
- Green: `#2C7562`
- Lavender: `#9B8AC4`
- Light lavender: `#D8D0ED`
- Off-white: `#F7F4EC`

The experience should remain deep green, projector-friendly, modern Saudi, softly geometric, elegant in Arabic, rounded, and futuristic without becoming generic. Do not use “AI Hackathon” wording.

### Current implemented features

- Arabic/English toggle with RTL/LTR switching.
- Responsive layout and reduced-motion support.
- Animated hero, floating cards, ambient background, gallery entrance effects, hover states, count pulse, and demo preview loading state.
- Live Apps Script synchronization.
- Submission form with pending moderation workflow.
- Public gallery limited to published visions.
- Voting and unvoting.
- Organizer access with session-only organizer key storage.
- Organizer controls for opening/closing submissions and voting.
- Pending review queue with search and track filter.
- Published-vision moderation queue.
- CSV export.
- Public gallery search by team, track, and vision text.
- Public gallery track filter.
- Public gallery sorting by featured order, vote count, or newest.
- Clear generated-image and demo-preview labels so the frontend does not confuse live generation with local fallback content.

### Recent fixes

- The organizer access button now opens a visible in-page organizer-key panel instead of relying on a native `prompt()`, which could be blocked or invisible on hosted pages.
- Frontend commit: `490cb3a52ddc7abf4ef7c5b6289abc7034b63907`
- Gallery feature commit: `e19180bfd4613d16e5d1f45187e1dab5bf29e442`
- Backend safeguard commit: `dae1131189617dc15331fd7c6f99a12409d80c2f`
- Apps Script settings parsing accepts boolean values and string values such as `TRUE` and `FALSE`.
- Duplicate published vision records are rejected.
- Deleting a published vision deactivates its active votes and records unvotes, preventing voters from becoming permanently stuck on a deleted vision.

### Important live services

- Apps Script web app:
  https://script.google.com/macros/s/AKfycbxHwpo0Y6fjMjZcHQ1i0tblhfRKODpMLwAsO5fMoKxkucX9GGBnboMkZXh51xuYiDfC/exec
- Health check:
  https://script.google.com/macros/s/AKfycbxHwpo0Y6fjMjZcHQ1i0tblhfRKODpMLwAsO5fMoKxkucX9GGBnboMkZXh51xuYiDfC/exec?action=health
- GitHub Pages site:
  https://googledevteam.github.io/SaudiVision/
- Google Sheet workbook:
  https://docs.google.com/spreadsheets/d/1aA6vWqJWlcOGwZgoWVqoe0E0vu9o7BJZQoA9Z5_72Pw/edit

The Apps Script health endpoint should return:

```json
{"ok":true,"service":"Imagine Saudi 2050","status":"ready"}
```

The Apps Script backend is deployed separately from GitHub. If `google-apps-script.gs` changes, copy the latest file into Apps Script and deploy a new version while preserving:

- Execute as: Me
- Who has access: Anyone
- The existing `/exec` URL

Never ask for, print, commit, or expose `ADMIN_KEY`. It is stored in Apps Script Script Properties and must remain server-side.

### Data safety rules

- Do not manually overwrite `Visions`, `Submissions`, `Votes`, or `Unvotes`.
- Do not replace existing competition data.
- New public submissions must remain pending until approved.
- Pending submissions must never appear in the public gallery.
- Only published records can be voted on.
- Preserve the existing Google Sheet tabs and workflow.
- Use small, targeted changes.
- Run JavaScript syntax checks after frontend or Apps Script changes.
- Do not claim local fallback images are AI-generated; live submissions use `imageSource: generated` only after the backend succeeds.

## Recommended next implementation

Build the next feature as an **Organizer Results and Operations dashboard** inside the existing organizer menu. Keep the current visual language and single-file architecture.

### Organizer menu roadmap

Implement in this order:

1. **Overview dashboard**
   - Pending count
   - Published count
   - Total active votes
   - Top three published visions
   - Last synchronization time

2. **Improved review cards**
   - Show preview image, team, track, full prompt, submission time, and image source.
   - Add a clear approve/delete confirmation state.
   - Keep search and track filtering.
   - Add keyboard-accessible actions.

3. **Results mode**
   - Show ranked published visions.
   - Show vote totals and percentages.
   - Add a “freeze voting” control.
   - Add an organizer-only winner state.
   - Handle ties explicitly instead of silently choosing one.

4. **Export center**
   - Export all submissions.
   - Export published results ranked by votes.
   - Export JSON as well as CSV.
   - Include timestamps and image source metadata.

5. **Competition settings**
   - Editable competition title/subtitle.
   - Submission and voting opening/closing times.
   - Optional public countdown.
   - Preview of what the public page will show.

6. **Audit and safety**
   - Organizer action history for approve, delete, settings changes, and winner selection.
   - Session timeout and explicit lock state.
   - Visible confirmation after every destructive action.

### Other product features worth adding

- Public countdown to the submission or voting deadline.
- A dedicated public results/winner section after voting closes.
- Stronger voter identity through Google Sign-In or Firebase Auth when strict one-person-one-vote enforcement is required.
- Backend image-generation statuses: `pending`, `generating`, `ready`, `failed`, `published`, `deleted`.
- A backend queue for slow image generation.
- Server-side image storage in Google Drive, Firebase Storage, or Cloud Storage; store only URLs and metadata in Sheets.
- Participant confirmation state with a private submission reference.
- Better accessibility: focus-visible states, keyboard review controls, screen-reader status messages, and stronger color contrast checks.
- Rate limiting or abuse protection for public submissions and voting.
- A post-event archive of the winning visions.

### Acceptance criteria for the next change

- Existing public submission, moderation, publishing, voting, unvoting, bilingual, local-demo, and filtering behavior still works.
- The organizer key never appears in the URL, DOM text, logs, Google Sheets, GitHub, or screenshots.
- Pending visions remain hidden from the public gallery.
- Published vision vote counts remain accurate after vote, unvote, and delete operations.
- Frontend syntax passes.
- Apps Script syntax passes.
- The existing colors, layout direction, and visual identity remain intact.
- The final response clearly states which files changed, what was tested, and whether GitHub Pages or Apps Script still needs deployment.

Before coding, inspect the latest `main` branch and the live deployment state. Then make the smallest complete improvement rather than rebuilding the project.

## Progress log

### Current state

- The repository contains the working vanilla HTML frontend and Google Apps Script backend.
- The organizer access flow uses a visible in-page key panel rather than a native browser prompt.
- The public gallery supports search, track filtering, and sorting by featured order, votes, or newest.
- Moderation and vote-cleanup safeguards are implemented in the backend.
- `AI_HANDOFF.md` now contains the continuation protocol and feature roadmap.
- The organizer panel now includes a live results board with ranked published visions, vote percentages, leader status, and tie detection.
- Organizer exports now include both CSV and JSON, with ranked published results and competition settings metadata.
- Public visitors now see the current competition phase, an optional deadline countdown, and a public ranked-results view after voting closes.

### Completed recently

- Fixed the organizer menu appearing unresponsive when native `prompt()` was blocked or invisible.
- Added organizer-key input, Unlock, and Cancel controls.
- Preserved session-only organizer-key storage.
- Added public gallery search/filter/sort controls.
- Added duplicate-publish protection.
- Deactivated active votes when a published vision is deleted.
- Added this living handoff and progress protocol.
- Added the Organizer Overview + Live Results dashboard.
- Added optional submission/voting deadlines, public countdown state, public results mode, and JSON export.
- Fixed English hero line spacing and gradient-word margin to match the Arabic lockup rhythm on desktop and mobile.
- Increased the English hero title gap and subtitle offset again after visual review so the words have unmistakable breathing room.

### Verification and deployment

- Frontend JavaScript syntax has been checked with Node.
- Apps Script syntax has been checked with Node-compatible parsing.
- The organizer dashboard markup and inline JavaScript passed static wiring checks for the new export, deadline, countdown, and results controls.
- The environment used for this change did not include Node, so runtime syntax verification remains a follow-up check before deployment.
- Apps Script health endpoint has returned `{ ok: true, status: "ready" }`.
- GitHub Pages deployment is separate from Apps Script deployment.
- Apps Script changes require copying the backend into Apps Script and deploying a new version.

### Deployment verification — 2026-09-19

- GitHub Pages is serving the latest frontend commit `573aad3253487783a80c22f8cb455932c4f73665`; the Pages workflow completed successfully.

- The Apps Script health endpoint is live and returns `{ ok: true, service: "Imagine Saudi 2050", status: "ready" }`.

- The live `/exec?action=visions` response currently includes only `submissionsOpen` and `votingOpen`; it does not include the new deadline fields from the current backend source. The Apps Script deployment is therefore behind GitHub and still needs the latest backend copied and deployed.

### Follow-up fix — 2026-09-19

- A cache-busting live request reached the updated Apps Script code but exposed a repeat-initialization error: `You cannot add alternating background colors to a range that already has alternating background colors.`

- Patched `google-apps-script.gs` so row banding is applied only when the sheet has no existing banding.

- Backend fix commit: `471370d067cfbaee2221506f9cc821af2b05862b`.

- Apps Script source syntax parse passed after the patch.

- Deployed verification now passes: health is ready, `/visions` includes both deadline fields, and repeated initialization no longer returns the banding error.

- Organizer auth diagnostics reject an intentionally invalid key as expected; no secret was exposed or tested.

- Frontend auth feedback was clarified without placing the internal configuration name in the DOM. Frontend commit: `f3f657f68e8168efc89e16ece702c341e999076c`.

### Visual update — 2026-09-19

- Replaced the hero’s circular accent, floating blob, and counter ring with a low-contrast branded background system.

- Added six repeated Google Developers logo marks, repeated as a controlled 3×2 background pattern, plus an oversized `96` motif and an accurate simplified Saudi Arabia boundary.

- Preserved the deep-green/lavender theme, hero readability, mobile layout, and Arabic RTL mirroring.

- Replaced the rough gear-like map placeholder with a real simplified boundary path, separated the logo/map/96 areas, removed the remaining flow-card rings, and removed the unused orbit animation. Final frontend commit: `faa228e6fb9e0932b1f5716c42ad5472dd5beca1`.

### Performance and access update — 2026-09-19

- Replaced the browser/app icon with the Shaqra University logo assets: shaqra-university-favicon.png and shaqra-university-logo.png.
- Converted the top Google Developers mark into the organizer access trigger and removed the separate visible organizer button.
- Added a short-lived public session cache, GET-based public vision reads, in-flight request deduplication, change detection, async image decoding, and reduced decorative DOM work. The gallery no longer rebuilds and reloads every image when no data changed.
- Added the organizerSnapshot backend route so organizer refresh loads settings, pending submissions, and published results in one authenticated request.
- Removed the repeated full workbook initialization from normal sheet reads; formatting/setup remains on the health/setup path.
- Frontend commits: b55a2bc2d8951a99b326057d39de7d5ba5fd3749, 95b05debc1897bf1c1c9c9d5fb1703e2dffcc274.
- Backend commit: 0723ed9f5f6f12b6bb8604a2c7b55e09d99cb0e8. Brand asset commits: a4709d2468a647939f850cd7a1dcae45ca3f8f3f, a291f5daa4265fac6b4c4785e704756d6f9da317.
- Source-level verification confirmed the new favicon, top-logo organizer trigger, 5-second polling, public GET path, snapshot route, and fast sheet lookup. GitHub Pages was still building the latest frontend at verification time.
- The Apps Script source is updated in GitHub but still requires copying into Apps Script and deploying a new version to activate the faster organizer route.

### Organizer unlock fix — 2026-09-19

- Restored the original Google Developers favicon/apple icon treatment while keeping the top Google mark as the organizer access trigger.
- The deployed Apps Script still returns Unknown action for organizerSnapshot until the updated backend is deployed. The frontend now falls back to the existing pending + public visions routes automatically.
- Added a 12-second request timeout, AbortController cleanup, and clearer bilingual timeout messaging so organizer unlock cannot wait indefinitely.
- Frontend fix commit: 824ba9f7ab16c023bb8f0bffa05ad550b9492e04.

### Structured submission upgrade — 2026-09-19

- Expanded the `Visions` and `Submissions` schemas with `title`, `problem`, `impact`, `beneficiaries`, and `tags`; existing sheets migrate by appending missing headers during health/setup.
- Added server-side validation and deadline enforcement for submissions and voting.
- Made row serialization header-aware so older spreadsheets keep their original column order and data when new headers are appended.
- Added organizer analytics: total submissions, pending count, published count, active votes, and per-track breakdown.
- Improved Gemini image prompts with the new structured context so generated concepts reflect the team’s title, challenge, impact, and beneficiaries.
- Upgraded the participant form and gallery/review cards to surface the richer details in English and Arabic.
- Moved **تخيّل السعودية** beside the language switch on the opposite side of the header.
- Added a five-metric organizer summary including all submissions and active votes.
- Backend commits: `f83dbfb67c6dbd43d43c012a0ac78d39f03e2e9a` and migration-safety fix `a690311fd5886313e20162560198b3e703dc34fc`.
- Frontend commit: `9443e4bd2115a69c0c0d0fd9ab86b6f75703c15f`.
- Direct syntax validation passed for both the Apps Script source and the inline frontend JavaScript; static field/DOM wiring checks passed.
- GitHub source is updated. The Apps Script web app still needs the latest backend copied into Apps Script and redeployed before the new columns, analytics, and deadline enforcement are live.

### Organizer access and form stabilization — 2026-09-19

- Replaced organizer unlock with single-flight verification so rapid clicks and duplicate submissions cannot race each other.
- The typed organizer key is now verified before it is stored in sessionStorage; invalid attempts clear stale sessions and reset the organizer panel.
- Removed the duplicate details-toggle refresh path, deduplicated organizer queue loads, added invalid-response handling, and made backend key comparison trim harmless surrounding whitespace.
- Enlarged the Strategic track control and removed Problem or opportunity, Expected impact, Who benefits, and Keywords from the public submission form.
- Frontend commit: `727374a6a21d202e3549844783dadbae5b2312ab`. Backend commit: `a0d04c1651803979c0900fb19cc0db4a4e68299e`.
- Frontend and Apps Script source syntax checks passed after the change.
- Live smoke test passed after deployment: `/health` returned workbook format `2026-09-19-v7`, and an intentionally invalid organizer key was rejected with `Unauthorized: invalid organizer key.` The static frontend still needs its hosting deployment/cache to refresh before users see the new access flow.

### Category prompts and participant round reset — 2026-09-19

- Expanded the Strategic track selector from 8 to 15 practical categories, including Future Food & Agriculture, Health & Wellbeing, Education & Skills, Tourism & Culture, Digital Society & Governance, Advanced Energy & Industry, and Other.
- Added a bilingual prompt enhancer for every category. The selected enhancer is shown to participants and applied server-side to Gemini image generation.
- Hardened image generation instructions so every accepted submission requests exactly one single image, never a collage, variation set, or text response.
- Added a server-owned submission round and anonymous browser participant identifier. Each participant can submit once per round; the organizer menu now has Reset participant submissions, which increments the round without deleting existing records.
- Frontend commit: 7be0ae45b0d79c569fd8a5b0536dda8fbd9e2f30. Backend commit: 5def846b07a82a7e56b245aae26906771e781a3f.
- Static source wiring checks passed. This environment does not include a JavaScript runtime, so Node syntax checks remain unavailable here.

### Spreadsheet device metadata — 2026-09-19

- Added readable device metadata to both Submissions and Visions: anonymous device ID, browser, browser version, operating system, device type, platform, screen size/pixel ratio, timezone, language, and truncated user-agent.
- The anonymous device ID is derived from the existing browser participant token, so organizers can distinguish repeated activity from the same browser without exposing account credentials.
- Device metadata is available in organizer review records but is not exposed in the public gallery.
- Frontend commit: 750513eaf285a731bcea6a23be101c8e53b69657. Backend commit: 8b73b3ad269ec4af9f75a5b36b30684d564c33b3.
- Existing spreadsheets will receive the additional headers when the updated Apps Script health/setup path runs.

### Live verification — 2026-09-19

- Confirmed the live Apps Script health endpoint responds with workbook format version \"2026-09-19-v7\" and all expected sheets: Visions, Submissions, Settings, Votes, Unvotes, and START HERE.
- Attempted one clearly labeled live verification submission after user approval. The request reached the backend but returned \"Live AI is not configured. Add GEMINI_API_KEY in Apps Script Project Settings.\"
- The backend generates the image before appending the submission, so this failed before creating a spreadsheet row. No test submission was created.
- Apps Script deployment is serving the current backend; add GEMINI_API_KEY in Apps Script Project Settings, then retry the same submission verification.

### Consolidated strategic tracks — 2026-09-19

- Reduced the public Strategic track selector from 15 overlapping suggestions to 8 clearer canonical choices: Green Tech & Energy; Smart Mobility & Future Cities; Heritage, Culture & Tourism; Human Potential & Wellbeing; Water & Oceans; Future Food & Agriculture; Digital Society & Governance; and Other.
- Merged Water Security + Blue Economy into Water & Oceans, Heritage AI + Tourism & Culture into Heritage, Culture & Tourism, Human Potential + Health & Wellbeing + Education & Skills into Human Potential & Wellbeing, Green Tech + Advanced Energy & Industry into Green Tech & Energy, and Smart Mobility + NEOM + Circular Cities into Smart Mobility & Future Cities.
- Kept a dedicated bilingual frontend and server-side prompt enhancer for every canonical choice. Legacy backend labels remain supported for existing records.
- Updated demo gallery tracks, submission color mapping, and the AI handoff. Frontend and backend source changes are ready for deployment; GitHub Pages and the Apps Script web app still need their normal deployment/verification cycle.

### Gemini readiness and visual prompt upgrade — 2026-09-19

- Reworked every canonical track enhancer into a more specific visual brief with one focal scene, a clear human benefit, and stronger Saudi environmental, cultural, or civic context.
- Added a live aiStatus endpoint and imageGeneration readiness details to health. The backend reads and trims GEMINI_API_KEY from Apps Script Project Settings on every request; adding the key takes effect immediately without redeploying code.
- The frontend checks aiStatus immediately before submission and shows a direct setup message instead of waiting for a failed image request.
- Added stronger image-generation constraints: one coherent 16:9 editorial scene, plausible near-future design, restrained local palette, one focal subject, and no text, logos, flags, collages, or variations.
- Source files updated: index.html and google-apps-script.gs. Apps Script still needs the updated backend source deployed once; after that, future API-key changes only require updating the Script property.

### Professional hardening and motion pass — 2026-09-19

- Fixed deadline consistency across the frontend and backend: expired submission deadlines now close the form, expired voting deadlines now show results mode, and unvote is rejected after the voting deadline.
- Fixed a submission-state bug where the “submitting” pulse could remain active forever after success or failure.
- Removed the forced 45-frame scroll-to-top loop so browser back/forward restoration and deep links behave normally.
- Set the initial document direction to Arabic/RTL to match the default rendered language and reduce first-paint layout and screen-reader mismatch.
- Added logical RTL-safe positioning, visible keyboard focus states, live submission status announcements, responsive countdown stacking, and a subtle IntersectionObserver reveal layer with reduced-motion support.
- Prepared `.github/workflows/quality.yml` to validate inline frontend JavaScript, Apps Script syntax, and required brand assets on pushes and pull requests, but GitHub's connected contents API blocked creation of the `.github/workflows` path with a Cloudflare 403; it is not yet in the repository.
- The three functional source changes are ready in GitHub. The Apps Script backend must be copied and redeployed for the unvote deadline guard to become live; GitHub Pages will build the frontend from the latest commit.

### Spreadsheet operations and burst-safety upgrade — 2026-09-19

- Added useful generation and moderation fields to Visions and Submissions: generation status, start/completion timestamps, attempts, safe error text, prompt version, Gemini model, image MIME type, Drive file ID, reviewed time, and reviewer role.
- Added an Activity Log sheet for submission received, generation succeeded/failed, and moderation events. It stores safe operational details without secrets.
- Submission handling now reserves a row under a short script lock before calling Gemini, so simultaneous requests cannot duplicate the same participant or race spreadsheet writes. Image generation happens outside the sheet lock but through a server-side generation slot, so ten simultaneous requests do not burst Gemini calls at once. Each request gets up to three retries for transient Gemini/API failures.
- Failed generations remain recorded with a retryable failed status instead of disappearing or crashing the workflow. The frontend submit request now allows normal image-generation latency.
- Workbook format version is now v8. The health/setup path adds all new headers and formats the operational columns automatically.

### Description-led prompt enhancer update — 2026-09-19

- Changed the eight canonical enhancers from detailed scene instructions into broad thematic lenses.
- Gemini now treats the participant description as the primary creative brief, preserves its concrete details, and combines related ideas instead of replacing them with a track-specific storyline.
- The selected track supplies context only; it cannot narrow, contradict, or add an unrelated concept to the participant's idea.
- Bumped the prompt version to v5 so the spreadsheet shows which submissions used the new description-led behavior.

### Visual copy update — 2026-09-19

- Updated the three public event-flow cards to match the supplied Arabic reference: imagine and describe the Saudi 2050 idea, turn it into an AI image, then vote for the design that best reflects the Kingdom's future.
- Kept the English translations aligned with the Arabic copy and changed no submission, moderation, voting, or backend behavior.
- Frontend commit: `afe33d25a978135e77ef4441516e0f676bff307d`.
- GitHub Pages should build the updated frontend from the new commit; Apps Script does not need redeployment for this copy-only change.

### Exact reference wording update — 2026-09-19

- Corrected the event-flow cards to match the latest supplied reference word for word: **تخيلوا**, **تصوّروا الفكرة**, **وصفًا دقيقًا**, and the exact AI-image and voting descriptions.
- Frontend commit: `3aebf142998bba271c03475f42c5c543939a7150`.
- This remains a copy-only frontend change; Apps Script does not need redeployment.

### Shaqra affiliation footer — 2026-09-19

- Kept the exact existing footer line **مجموعات مطوري Google في الجامعة — جامعة شقراء** and added the supplied affiliation line directly beneath it: **كلية الحاسب الآلي وتقنية المعلومات - مجموعة مطوري قوقل شقراء**.
- Added an aligned English translation and a small stacked-footer style without changing application behavior.
- Frontend commit: `ec91f8d5648e002e461b8f74733f7f989e88ceb9`.
- GitHub Pages should rebuild the frontend; Apps Script does not need redeployment for this copy/layout-only change.

### Temporary footer removal — 2026-09-19

- Removed the footer line **مجموعات مطوري Google في الجامعة — جامعة شقراء** at the user's request.
- Kept the college affiliation line **كلية الحاسب الآلي وتقنية المعلومات - مجموعة مطوري قوقل شقراء**.
- Frontend commit: `ca1530e8b319b14f470b616471db112c2f442fa1`.

### White institution logo in header — 2026-09-19

- Added the supplied transparent white College of Computer and Information Technology + Shaqra University logo as `college-shaqra-logo-white.png`.
- Placed it in the RTL header beside the existing Imagine Saudi branding, with responsive sizing for mobile; the Google Developers organizer-access button remains separate.
- Asset commit: `48a507dac91130f5acf2dcf2739fb0bb7d1bd956`. Frontend commit: `4b0901c9ddc0731c11aed7350bd726b51dbd8513`.
- Apps Script does not need redeployment; GitHub Pages should rebuild the frontend.

### Header logo visibility refinement — 2026-09-19

- Moved the white College + Shaqra University logo into a dedicated header identity block with enough visual space to be noticeable.
- Increased its desktop size, gave it a subtle framed background, and made the block full-width on smaller screens; the language switch and organizer access remain functional.
- Frontend commit: `7e830fd3038de6191b3a0f1e01c2fddf64a56424`.
- Apps Script does not need redeployment; GitHub Pages should rebuild the frontend.

### Mobile header height fix — 2026-09-19

- Kept the institution logo inline in the top bar at mobile widths instead of forcing it into a full-width second row.
- Reduced the mobile logo size and header padding while preserving the larger, noticeable desktop treatment.
- Frontend commit: `3a3846483e8475ec4bfac2e9a81c1a3d2f0ffc9f`.

### Narrow-phone language switch fix — 2026-09-19

- Prevented the language switch from shrinking or being pushed into the logo on narrow phones.
- Added a stable touch target, allowed only the logo to compress, and removed duplicate mobile logo sizing rules.
- Frontend commit: `296582a2b3116013397dd4d1d5529e5f32680944`.

### Language control layout refinement — 2026-09-19

- Moved the language switch out of the institution-logo cluster into its own compact header utility control.
- Added a narrow-phone fallback below 380px so the control wraps cleanly instead of being squeezed into the logo row.
- Frontend commit: `d289aa593c86ffde77df8d8751347d1dcd7c4413`.

### Hero language control placement — 2026-09-19

- Moved the language switch out of the header row and into a dedicated floating utility pill at the upper edge of the hero, opposite the Arabic headline.
- It now has independent space and a larger readable touch target without changing header height or competing with the institution logo.
- Frontend commit: `6809bd787e3f05888f76b964ef48b54a0675a5d3`.

### Top header cleanup — 2026-09-19

- Removed the top header label **مسابقة رؤى المستقبل / 2050** to create more breathing room.
- Kept the main hero title, institution logo, language switch, and organizer controls unchanged.
- Frontend commit: `59e370648365361b60fb5e2a538307ca25b3a54f`.

### Performance and background decoration update — 2026-09-20

- Removed motion only from the 20 background decorative marks; all other site animations remain unchanged.
- Reworked the decorative placement into shuffled, unique grid cells with a rotation safety margin, so marks do not share a cell or drift over one another.
- Added resize-safe regeneration for the 20 marks without continuous animation work.
- Changed public polling from every 5 seconds to every 15 seconds, paused it while the tab is hidden, and avoided rebuilding public results every countdown tick.
- Added a 5-second Apps Script public-response cache with cache invalidation after settings, moderation, delete, vote, and unvote writes. This collapses simultaneous public reads before they reach Google Sheets.
- Files changed: `index.html`, `google-apps-script.gs`.
- Frontend commit: `b43fb6f3707b3859655938ccf90a39ceea92972f`.
- Backend commit: `e24a48ed5298fc2fbfb030c47df85fbeee743449`.
- Direct Node syntax checks passed for the inline frontend JavaScript and Apps Script source.
- GitHub Pages will rebuild the frontend from the new source. The Apps Script source must be copied into Apps Script and redeployed for the public-response cache to become active.

### Next recommended step

Deploy the updated google-apps-script.gs once, then test descriptions that intentionally combine two or three ideas. Confirm the generated image follows the participant's wording while using the selected track only as a broad lens.
