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
2. The frontend creates a deterministic demo concept preview. It is not real AI image generation yet.
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
- Demo preview labels so the frontend does not falsely claim real AI image generation.

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
- Do not claim real AI image generation works; the current source is `demo-preview`.

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

### Verification and deployment

- Frontend JavaScript syntax has been checked with Node.
- Apps Script syntax has been checked with Node-compatible parsing.
- The organizer dashboard markup and inline JavaScript passed static wiring checks for the new export, deadline, countdown, and results controls.
- The environment used for this change did not include Node, so runtime syntax verification remains a follow-up check before deployment.
- Apps Script health endpoint has returned `{ ok: true, status: "ready" }`.
- GitHub Pages deployment is separate from Apps Script deployment.
- Apps Script changes require copying the backend into Apps Script and deploying a new version.

### Next recommended step

Copy the updated backend into Apps Script, deploy a new web-app version, and verify the public countdown/results response through the live /exec endpoint. Then confirm GitHub Pages serves the new frontend.

---
