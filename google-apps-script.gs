/*
  Imagine Saudi 2050 — Google Apps Script backend

  Spreadsheet setup
  -----------------
  1. Create a Google Sheet for the competition.
  2. In that Sheet, open Extensions → Apps Script and replace the editor
     contents with this file. A bound script can use the active Sheet
     automatically. If this is a standalone Apps Script project instead,
     add a Script Property named SPREADSHEET_ID with the Sheet ID.
   3. In Apps Script, open Project Settings → Script properties and add:
         ADMIN_KEY = a long private organizer password
         CLOUDFLARE_API_TOKEN = a private Cloudflare API token with Workers AI run permission
         CLOUDFLARE_ACCOUNT_ID = your Cloudflare account ID
         CLOUDFLARE_IMAGE_MODEL = optional model path; defaults to @cf/black-forest-labs/flux-1-schnell
         CLOUDFLARE_AI_ENDPOINT = optional full endpoint; otherwise it is built from the account ID and model.
       Do not put ADMIN_KEY or Cloudflare credentials in index.html. The browser asks for
       the organizer key only when needed; Cloudflare Workers AI is called server-side by this script.
  4. Deploy → New deployment → Web app:
        Execute as: Me
        Who has access: Anyone
      Copy the URL ending in /exec, not /dev.
  5. Paste that URL into GOOGLE_APPS_SCRIPT_URL in index.html.
  6. Open the /exec URL once with ?action=health. The script creates and
     professionally formats a START HERE guide plus these data tabs:
        Visions, Submissions, Settings, Votes, Unvotes
  7. Use START HERE as the operating manual. It explains every tab, field,
     status, setting, deployment step, and test procedure without requiring
     this source file to be understood first.

  This backend calls Cloudflare Workers AI image generation server-side for every submission.
  The generated PNG is stored in Google Drive with link viewing enabled, and
  only the public image URL is written to Sheets. Never expose CLOUDFLARE_API_TOKEN
  in the static frontend.

  Optional Firebase path
  ----------------------
  Firebase can be added later for Google Sign-In and Firestore, but it is not
  required for this Sheets version. The safest incremental path is:
    1. Create a Firebase project and enable Authentication → Google.
    2. Add the Firebase web config to the frontend (web config is not a secret).
    3. Send the signed-in user's ID token to a trusted backend/Cloud Function.
    4. Keep moderation and vote writes server-side, protected by Firestore
       Security Rules, App Check, and organizer authorization.
  Do not put ADMIN_KEY, Cloudflare Workers AI keys, or service-account credentials in the
  frontend. Firebase Auth improves identity, but does not by itself authorize
  organizer actions.

  Static-frontend limitation
  --------------------------
  A browser localStorage voter ID is not a strict identity. Users can clear
  storage or use another browser/device. This backend enforces one active vote
  per voter ID and uses LockService for race safety; strict one-person-one-vote
  requires authenticated accounts (for example Google Sign-In) or an
  organizer-controlled identity system.
*/

const SHEETS = {
  visions: {
    name: "Visions",
    headers: ["id", "createdAt", "publishedAt", "status", "team", "title", "track", "prompt", "problem", "impact", "beneficiaries", "tags", "image", "color", "height", "votes", "participantId", "submissionRound", "deviceId", "deviceLabel", "browser", "browserVersion", "operatingSystem", "deviceType", "platform", "screen", "timezone", "language", "userAgent", "imageSource", "generationStatus", "generationStartedAt", "generationCompletedAt", "generationAttempts", "generationError", "promptVersion", "imageModel", "imageMimeType", "driveFileId", "reviewedAt", "reviewedBy"]
  },
  submissions: {
    name: "Submissions",
    headers: ["id", "createdAt", "updatedAt", "status", "team", "title", "track", "prompt", "problem", "impact", "beneficiaries", "tags", "image", "color", "height", "submittedBy", "participantId", "submissionRound", "deviceId", "deviceLabel", "browser", "browserVersion", "operatingSystem", "deviceType", "platform", "screen", "timezone", "language", "userAgent", "imageSource", "generationStatus", "generationStartedAt", "generationCompletedAt", "generationAttempts", "generationError", "promptVersion", "imageModel", "imageMimeType", "driveFileId", "reviewedAt", "reviewedBy"]
  },
  settings: {
    name: "Settings",
    headers: ["key", "value", "updatedAt"]
  },
  votes: {
    name: "Votes",
    headers: ["voterId", "visionId", "votedAt", "active"]
  },
  unvotes: {
    name: "Unvotes",
    headers: ["voterId", "visionId", "unvotedAt"]
  },
  activityLog: {
    name: "Activity Log",
    headers: ["timestamp", "eventId", "action", "status", "submissionId", "participantId", "team", "track", "message", "details"]
  }
};

const GUIDE_SHEET_NAME = "START HERE";
const WORKBOOK_FORMAT_VERSION = "2026-09-20-v9";
const IMAGE_PROMPT_VERSION = "2026-09-21-v9-gemini-ready";
const GENERATION_SLOT_KEY = "IMAGINE_SAUDI_CLOUDFLARE_GENERATION_SLOT";
const PUBLIC_RESPONSE_CACHE_KEY_ = "IMAGINE_SAUDI_PUBLIC_RESPONSE_V1";
const PUBLIC_RESPONSE_CACHE_TTL_SECONDS_ = 5;
const PUBLIC_RESPONSE_CACHE_MAX_BYTES_ = 45000;
const ABUSE_RATE_LIMIT_CACHE_PREFIX_ = "IMAGINE_SAUDI_RATE_V1_";
const ABUSE_RATE_LIMITS_ = {
  submission: { maxRequests: 3, windowSeconds: 600 },
  voting: { maxRequests: 20, windowSeconds: 60 }
};
const CLOUDFLARE_IMAGE_MODEL = "@cf/black-forest-labs/flux-1-schnell";
const CLOUDFLARE_API_BASE_URL = "https://api.cloudflare.com/client/v4";
const GEMINI_IMAGE_MODEL = "gemini-3.1-flash-image";
const GEMINI_API_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions";
const ACTIVE_AI_PROVIDER_PROPERTY_ = "IMAGINE_SAUDI_ACTIVE_AI_PROVIDER_V1";
const ACTIVE_AI_PROVIDER_ERROR_PROPERTY_ = "IMAGINE_SAUDI_ACTIVE_AI_PROVIDER_ERROR_V1";
const DRIVE_IMAGE_THUMBNAIL_SIZE = "w1600";
const THEME = {
  darkGreen: "#073B35",
  green: "#2C7562",
  lavender: "#9B8AC4",
  lightLavender: "#D8D0ED",
  offWhite: "#F7F4EC",
  ink: "#173D37",
  muted: "#667A73",
  paleGreen: "#E4F1EC",
  paleLavender: "#F0ECF8",
  paleRed: "#F8E7EC",
  red: "#A74461"
};

const FIELD_NOTES = {
  id: "Unique record ID. Do not edit manually.",
  createdAt: "When the record was created.",
  publishedAt: "When an organizer approved the vision.",
  updatedAt: "When the submission status or record was last changed.",
  status: "Workflow state: pending, published, or deleted.",
  team: "Participant group name.",
  track: "Strategic competition track selected by the group.",
  prompt: "The group's Saudi 2050 vision description.",
  image: "Preview or generated image URL/data URI.",
  imageSource: "Image origin: demo-preview, generated, uploaded, or curated.",
  generationStatus: "Image workflow state: queued, generating, generated, or failed.",
  generationStartedAt: "When Cloudflare Workers AI image generation started.",
  generationCompletedAt: "When Cloudflare Workers AI image generation finished or failed.",
  generationAttempts: "Number of Cloudflare Workers AI attempts used for this submission.",
  generationError: "Last safe error message when image generation failed.",
  promptVersion: "Version of the server-side image prompt used.",
  imageModel: "Cloudflare Workers AI image model used for generation.",
  imageMimeType: "Generated image MIME type, such as image/png.",
  driveFileId: "Google Drive file ID for the generated image.",
  reviewedAt: "When an organizer approved or deleted the submission.",
  reviewedBy: "Organizer role that performed the moderation action.",
  timestamp: "When an operational event was recorded.",
  eventId: "Unique activity-log event ID.",
  action: "Operational event name, such as submission_received or generation_failed.",
  details: "Safe JSON details for diagnosing the event; never store secrets.",
  color: "Hex accent color used by the gallery.",
  height: "Gallery image height in pixels, constrained by the backend.",
  votes: "Current active vote count for a published vision.",
  submittedBy: "Optional participant or identity reference. Keep personal data minimal.",
  title: "Short memorable title for the vision.",
  problem: "The future problem or opportunity the team is addressing.",
  impact: "Expected benefit for people, the environment, or the economy.",
  beneficiaries: "People or communities who benefit from the idea.",
  tags: "Comma-separated keywords for organizer search and filtering.",
  key: "Settings key. Supported keys are submissionsOpen, votingOpen, submissionDeadline, votingDeadline, and submissionRound.",
  value: "Setting value. Boolean settings are stored as true or false.",
  votedAt: "When the active vote was created.",
  active: "Whether this vote is currently active.",
  unvotedAt: "When a voter removed their vote.",
  participantId: "Anonymous browser participant identifier for one submission per round.",
  submissionRound: "Submission eligibility round. Organizer reset increments this value.",
  deviceId: "Stable anonymous browser ID derived from the participant session token.",
  deviceLabel: "Readable browser/version, operating system, and device type label.",
  browser: "Detected browser family.",
  browserVersion: "Detected browser version.",
  operatingSystem: "Detected operating system family.",
  deviceType: "Desktop, tablet, or mobile.",
  platform: "Browser-reported platform string.",
  screen: "Screen width, height, and pixel ratio.",
  timezone: "Browser timezone.",
  language: "Browser language preference.",
  userAgent: "Browser user-agent string, truncated to 500 characters."
};

const DEFAULT_SETTINGS = {
  submissionsOpen: true,
  votingOpen: true,
  submissionDeadline: "",
  votingDeadline: "",
  submissionRound: "1",
  winnerVisionId: "",
  winnerDeclaredAt: ""
};

const TRACK_PROMPT_ENHANCERS_ = {
  "Green Tech & Energy": "Use sustainability, resilience, resource-aware innovation, and responsible energy as a broad lens. Let the participant decide the technology, setting, people, and visual story.",
  "Smart Mobility & Future Cities": "Use connected places, accessible movement, adaptable neighborhoods, and future urban life as a broad lens. Follow the participant's own journey and priorities.",
  "Heritage, Culture & Tourism": "Use Saudi identity, memory, place, culture, creativity, and responsible exchange as broad context. Let the description determine how heritage or tourism appears.",
  "Human Potential & Wellbeing": "Use people, inclusion, learning, health, creativity, and everyday quality of life as broad context. Let the participant's description determine the human outcome.",
  "Water & Oceans": "Use water, coasts, marine life, resource stewardship, and resilient ecosystems as a broad lens. Preserve the participant's own connection between the ideas.",
  "Future Food & Agriculture": "Use food, agriculture, nourishment, local production, and resource-aware growing as broad context. Let the description define the system and its people.",
  "Digital Society & Governance": "Use trusted technology, participation, access, privacy, and human-centered public life as broad context. Follow the participant's actual problem and proposed change.",
  "Other": "Use the participant's description as the complete creative brief. Carry its meaning into one coherent Saudi 2050 concept without forcing an unrelated track.",
  // Legacy values remain supported for existing submissions and historical records.
  "Green Tech": "Use sustainability, resilience, resource-aware innovation, and responsible energy as a broad lens. Let the participant decide the technology, setting, people, and visual story.",
  "Advanced Energy & Industry": "Use sustainability, resilience, resource-aware innovation, and responsible energy as a broad lens. Let the participant decide the technology, setting, people, and visual story.",
  "Smart Mobility": "Use connected places, accessible movement, adaptable neighborhoods, and future urban life as a broad lens. Follow the participant's own journey and priorities.",
  "NEOM": "Use connected places, accessible movement, adaptable neighborhoods, and future urban life as a broad lens. Follow the participant's own journey and priorities.",
  "Circular Cities": "Use connected places, accessible movement, adaptable neighborhoods, and future urban life as a broad lens. Follow the participant's own journey and priorities.",
  "Heritage AI": "Use Saudi identity, memory, place, culture, creativity, and responsible exchange as broad context. Let the description determine how heritage or tourism appears.",
  "Tourism & Culture": "Use Saudi identity, memory, place, culture, creativity, and responsible exchange as broad context. Let the description determine how heritage or tourism appears.",
  "Human Potential": "Use people, inclusion, learning, health, creativity, and everyday quality of life as broad context. Let the participant's description determine the human outcome.",
  "Health & Wellbeing": "Use people, inclusion, learning, health, creativity, and everyday quality of life as broad context. Let the participant's description determine the human outcome.",
  "Education & Skills": "Use people, inclusion, learning, health, creativity, and everyday quality of life as broad context. Let the participant's description determine the human outcome.",
  "Water Security": "Use water, coasts, marine life, resource stewardship, and resilient ecosystems as a broad lens. Preserve the participant's own connection between the ideas.",
  "Blue Economy": "Use water, coasts, marine life, resource stewardship, and resilient ecosystems as a broad lens. Preserve the participant's own connection between the ideas."
};

function trackPromptEnhancer_(track) {
  return TRACK_PROMPT_ENHANCERS_[String(track || "")] || TRACK_PROMPT_ENHANCERS_.Other;
}


function doGet(event) {
  const action = (event && event.parameter && event.parameter.action) || "health";
  try {
    return jsonResponse_(route_(action, {}, false));
  } catch (error) {
    return jsonResponse_({ ok: false, error: safeErrorMessage_(error) });
  }
}

function doPost(event) {
  let payload = {};
  try {
    const body = event && event.postData && event.postData.contents;
    payload = body ? JSON.parse(body) : {};
  } catch (error) {
    return jsonResponse_({ ok: false, error: "Request body must be valid JSON." });
  }

  const action = payload.action || (event && event.parameter && event.parameter.action) || "";
  try {
    return jsonResponse_(route_(action, payload, true));
  } catch (error) {
    return jsonResponse_({ ok: false, error: safeErrorMessage_(error) });
  }
}

function geminiConfig_() {
  const properties = PropertiesService.getScriptProperties();
  const apiKey = String(properties.getProperty("GEMINI_API_KEY") || "").trim();
  const model = String(properties.getProperty("GEMINI_IMAGE_MODEL") || GEMINI_IMAGE_MODEL).trim();
  return { apiKey: apiKey, model: model, endpoint: GEMINI_API_ENDPOINT };
}

function cloudflareConfig_() {
  const properties = PropertiesService.getScriptProperties();
  const apiToken = String(properties.getProperty("CLOUDFLARE_API_TOKEN") || "").trim();
  const accountId = String(properties.getProperty("CLOUDFLARE_ACCOUNT_ID") || "").trim();
  const model = String(properties.getProperty("CLOUDFLARE_IMAGE_MODEL") || CLOUDFLARE_IMAGE_MODEL).trim();
  const customEndpoint = String(properties.getProperty("CLOUDFLARE_AI_ENDPOINT") || "").trim();
  const endpoint = customEndpoint || (accountId
    ? CLOUDFLARE_API_BASE_URL + "/accounts/" + accountId + "/ai/run/" + model
    : "");
  return { apiToken: apiToken, accountId: accountId, model: model, endpoint: endpoint };
}

function imageGenerationModel_() {
  const gemini = geminiConfig_();
  return gemini.apiKey ? gemini.model : cloudflareConfig_().model;
}

function providerErrorMessage_(error) {
  return safeErrorMessage_(error)
    .replace(/AIza[0-9A-Za-z_-]+/g, "[redacted]")
    .replace(/Bearer\s+[^\s]+/gi, "Bearer [redacted]")
    .slice(0, 240);
}

function setActiveAiProvider_(provider, error) {
  const properties = PropertiesService.getScriptProperties();
  const normalizedProvider = String(provider || "");
  properties.setProperty(ACTIVE_AI_PROVIDER_PROPERTY_, normalizedProvider);
  if (normalizedProvider === "Cloudflare Workers AI" && error) {
    properties.setProperty(ACTIVE_AI_PROVIDER_ERROR_PROPERTY_, providerErrorMessage_(error));
  } else {
    properties.deleteProperty(ACTIVE_AI_PROVIDER_ERROR_PROPERTY_);
  }
}

function cloudflareStatus_() {
  const gemini = geminiConfig_();
  const cloudflare = cloudflareConfig_();
  const geminiAvailable = Boolean(gemini.apiKey);
  const cloudflareAvailable = Boolean(cloudflare.apiToken && cloudflare.endpoint);
  const savedProvider = String(PropertiesService.getScriptProperties().getProperty(ACTIVE_AI_PROVIDER_PROPERTY_) || "");
  const activeProvider = savedProvider === "Cloudflare Workers AI" && cloudflareAvailable
    ? savedProvider
    : geminiAvailable ? "Google Gemini" : cloudflareAvailable ? "Cloudflare Workers AI" : "none";
  return {
    configured: Boolean(geminiAvailable || cloudflareAvailable),
    status: activeProvider === "Cloudflare Workers AI" ? "fallback_active" : activeProvider === "Google Gemini" ? "ready" : "needs_gemini_or_cloudflare_settings",
    provider: activeProvider,
    activeProvider: activeProvider,
    model: activeProvider === "Google Gemini" ? gemini.model : cloudflare.model,
    primaryProvider: "Google Gemini",
    fallbackProvider: cloudflareAvailable ? "Cloudflare Workers AI" : "not_configured",
    fallbackConfigured: cloudflareAvailable
  };
}

function organizerAiStatus_() {
  const status = cloudflareStatus_();
  status.lastFallbackError = status.activeProvider === "Cloudflare Workers AI"
    ? String(PropertiesService.getScriptProperties().getProperty(ACTIVE_AI_PROVIDER_ERROR_PROPERTY_) || "")
    : "";
  return status;
}

function route_(action, payload) {
  switch (action) {
    case "health":
      initializeSheets_();
      return {
        ok: true,
        service: "Imagine Saudi 2050",
        status: "ready"
      };
    case "aiStatus":
      return { ok: true, service: "Imagine Saudi 2050", imageGeneration: cloudflareStatus_() };
    case "visions":
      return getPublicVisions_();
    case "submit":
      return submitVision_(payload);
    case "vote":
      return voteForVision_(payload);
    case "unvote":
      return unvoteVision_(payload);
    case "pending":
      requireAdmin_(payload);
      return { ok: true, visions: getPendingSubmissions_() };
    case "organizerAuth":
      requireAdmin_(payload);
      return { ok: true, authenticated: true };
    case "organizerSnapshot":
      requireAdmin_(payload);
      return getOrganizerSnapshot_();
    case "publish":
      requireAdmin_(payload);
      return moderateSubmission_(payload.visionId, "published");
    case "delete":
      requireAdmin_(payload);
      return moderateSubmission_(payload.visionId, "deleted");
    case "deletePublished":
      requireAdmin_(payload);
      return deletePublishedVision_(payload.visionId);
    case "setSettings":
      requireAdmin_(payload);
      return saveSettings_(payload);
    case "setWinner":
      requireAdmin_(payload);
      return setWinner_(payload.visionId);
    case "clearWinner":
      requireAdmin_(payload);
      return clearWinner_();
    case "resetSubmissions":
      requireAdmin_(payload);
      return resetSubmissionRound_();
    default:
      throw new Error("Unknown action.");
  }
}

function jsonResponse_(value) {
  return ContentService
    .createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}

function safeErrorMessage_(error) {
  return error && error.message ? error.message : "The backend could not complete the request.";
}

function getSpreadsheet_() {
  const spreadsheetId = PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID");
  if (spreadsheetId) return SpreadsheetApp.openById(spreadsheetId);

  const activeSpreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!activeSpreadsheet) {
    throw new Error("No spreadsheet is configured. Bind this script to a Sheet or set SPREADSHEET_ID.");
  }
  return activeSpreadsheet;
}

function initializeSheets_() {
  const spreadsheet = getSpreadsheet_();
  Object.keys(SHEETS).forEach(function(key) {
    const definition = SHEETS[key];
    const sheet = spreadsheet.getSheetByName(definition.name) || spreadsheet.insertSheet(definition.name);
    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, definition.headers.length).setValues([definition.headers]);
      sheet.setFrozenRows(1);
    } else {
      ensureHeaders_(sheet, definition.headers);
    }
  });
  ensureWorkbookPresentation_(spreadsheet);
  return spreadsheet;
}

function ensureHeaders_(sheet, expectedHeaders) {
  const existingHeaders = sheet.getRange(1, 1, 1, Math.max(1, sheet.getLastColumn())).getValues()[0];
  const missingHeaders = expectedHeaders.filter(function(header) {
    return existingHeaders.indexOf(header) === -1;
  });
  if (!missingHeaders.length) return;
  sheet.getRange(1, existingHeaders.length + 1, 1, missingHeaders.length).setValues([missingHeaders]);
  sheet.setFrozenRows(1);
}

function ensureWorkbookPresentation_(spreadsheet) {
  const properties = PropertiesService.getScriptProperties();
  const guide = spreadsheet.getSheetByName(GUIDE_SHEET_NAME);
  const needsSetup = properties.getProperty("WORKBOOK_FORMAT_VERSION") !== WORKBOOK_FORMAT_VERSION ||
    !guide ||
    String(guide.getRange("A1").getValue()) !== "IMAGINE SAUDI 2050 | CONTROL CENTER" ||
    guide.getLastRow() < 72;
  if (!needsSetup) return;

  const guideSheet = guide || spreadsheet.insertSheet(GUIDE_SHEET_NAME, 0);
  buildGuideSheet_(guideSheet);
  Object.keys(SHEETS).forEach(function(key) {
    formatDataSheet_(spreadsheet.getSheetByName(SHEETS[key].name), SHEETS[key]);
  });
  properties.setProperty("WORKBOOK_FORMAT_VERSION", WORKBOOK_FORMAT_VERSION);
}

function buildGuideSheet_(sheet) {
  sheet.getRange(1, 1, sheet.getMaxRows(), Math.min(sheet.getMaxColumns(), 4)).breakApart();
  sheet.clear();
  const rows = [
    ["IMAGINE SAUDI 2050 | CONTROL CENTER", "", "", ""],
    ["Competition operations guide · Google Developer Groups on Campus — Shaqra University", "", "", ""],
    ["", "", "", ""],
    ["LIVE STATUS", "", "", ""],
    ["Metric", "Current value", "What it means", "How to change it"],
    ["Submissions", '=IFERROR(VLOOKUP("submissionsOpen",Settings!A:B,2,FALSE),"true")', "Whether public participants can send new visions.", "Use the organizer controls in the website."],
    ["Voting", '=IFERROR(VLOOKUP("votingOpen",Settings!A:B,2,FALSE),"true")', "Whether the audience can vote.", "Use the organizer controls in the website."],
    ["Submission deadline", '=IFERROR(VLOOKUP("submissionDeadline",Settings!A:B,2,FALSE),"")', "Optional ISO deadline shown as a public countdown.", "Set it from the organizer controls."],
    ["Voting deadline", '=IFERROR(VLOOKUP("votingDeadline",Settings!A:B,2,FALSE),"")', "Optional ISO deadline shown as a public countdown.", "Set it from the organizer controls."],
    ["Published visions", '=COUNTIF(Visions!D:D,"published")', "Approved concepts currently visible in the public gallery.", "Approve a pending submission from the review queue."],
    ["Pending submissions", '=COUNTIF(Submissions!D:D,"pending")', "Submissions waiting for organizer review.", "Open Organizer controls and refresh the review queue."],
    ["", "", "", ""],
    ["FIRST-TIME SETUP", "", "", ""],
    ["Step", "Do this", "Where / value", "Done when"],
    ["1", "Create or open the competition spreadsheet.", "Google Sheets → blank spreadsheet.", "You can open Extensions → Apps Script."],
    ["2", "Paste this backend into Apps Script.", "Extensions → Apps Script → replace starter code → Save.", "The file saves without errors."],
    ["3", "Add the organizer secret.", "Project Settings → Script Properties → ADMIN_KEY.", "The key is stored privately and not in this sheet."],
    ["4", "Deploy the web app.", "Deploy → New deployment → Web app → Execute as Me → Who has access: Anyone.", "You have a URL ending in /exec, not /dev."],
    ["5", "Connect the frontend.", "Set GOOGLE_APPS_SCRIPT_URL in index.html to the /exec URL.", "The website can call this backend."],
    ["6", "Initialize and verify.", "Open /exec?action=health in a browser or private window.", "You receive { ok: true, status: ready }."],
    ["7", "Run a complete test.", "Submit → review pending → approve → gallery → vote → unvote.", "One test vision completes the whole workflow."],
    ["", "", "", ""],
    ["CONFIGURATION REFERENCE", "", "", ""],
    ["Value", "Where it lives", "Purpose", "Safe operating rule"],
    ["ADMIN_KEY", "Apps Script Script Properties", "Authorizes organizer-only actions.", "Never put it in index.html, a Sheet cell, a screenshot, or a public repository."],
    ["SPREADSHEET_ID", "Script Properties (standalone only)", "Identifies the spreadsheet when the script is not bound to one.", "Leave it unset for a bound spreadsheet."],
    ["GOOGLE_APPS_SCRIPT_URL", "Frontend index.html", "HTTPS address used by the browser.", "Use only the deployed /exec URL."],
    ["submissionsOpen", "Settings tab", "true accepts new submissions; false closes the form.", "Prefer the secured organizer controls."],
    ["votingOpen", "Settings tab", "true allows vote/unvote; false closes voting.", "Close voting before announcing results."],
    ["submissionDeadline", "Settings tab", "Optional ISO timestamp for the public submission countdown.", "Leave blank to hide the countdown."],
    ["votingDeadline", "Settings tab", "Optional ISO timestamp for the public voting countdown.", "Leave blank to hide the countdown."],
    ["imageSource", "Visions / Submissions", "demo-preview, generated, uploaded, or curated.", "New submissions are generated by Cloudflare Workers AI and remain pending until approved."],
    ["", "", "", ""],
    ["SHEET MAP", "", "", ""],
    ["Sheet", "What it stores", "Important fields", "Organizer guidance"],
    ["Visions", "Published gallery concepts, structured impact details, and live vote counts.", "status, team, title, track, prompt, problem, impact, votes", "Public data source. Do not manually publish pending records here."],
    ["Submissions", "All participant submissions, structured details, generated images, and moderation history.", "status, team, title, track, prompt, problem, impact, beneficiaries, tags", "Primary review queue. New records are always pending."],
    ["Settings", "Competition switches, optional deadlines, and update timestamps.", "submissionsOpen, votingOpen, submissionDeadline, votingDeadline", "Keep one row per supported setting."],
    ["Votes", "Vote history with current active state.", "voterId, visionId, active", "LockService protects race-sensitive updates."],
    ["Unvotes", "Audit trail for removed votes.", "voterId, visionId, unvotedAt", "Keep this history during the competition."],
    ["", "", "", ""],
    ["OPERATING CHECKLIST", "", "", ""],
    ["Before launch", "Health endpoint works; tabs exist; frontend uses /exec; demo submission approved successfully.", "", ""],
    ["During submissions", "Watch pending records; approve only after review; delete unwanted records with confirmation.", "", ""],
    ["During voting", "Confirm voting is open; watch Votes; browser voter IDs are not strict identity.", "", ""],
    ["After closing", "Set votingOpen to false; export or copy results; announce the winner from published counts.", "", ""],
    ["", "", "", ""],
     ["FIELD DICTIONARY", "", "", ""],
     ["Field", "Definition", "How to use it", "Safe editing rule"],
     ...Object.keys(FIELD_NOTES).map(function(field) {
       return [
         field,
         FIELD_NOTES[field],
         field === "id" ? "Use this value to match a submission, vision, or vote record." : "Read this value when reviewing the competition workflow.",
         field === "id" ? "Never edit IDs manually." : "Prefer the website or backend workflow over manual edits."
       ];
     }),
     ["", "", "", ""],
    ["SECURITY AND SCALE NOTES", "", "", ""],
    ["1", "Public users can submit and vote, but organizer routes require ADMIN_KEY.", "", ""],
    ["2", "localStorage prevents one active vote per browser profile, not one person everywhere. Firebase Auth plus trusted token verification is needed for strict identity.", "", ""],
    ["3", "For roughly 100 submissions, use a backend image queue and store files in Drive or Cloud Storage. Keep URLs and statuses in Sheets.", "", ""],
    ["4", "A real image API key belongs in Script Properties or a server-side secret manager, never in the static frontend.", "", ""]
  ];

  sheet.getRange(1, 1, rows.length, 4).setValues(rows);
  sheet.getRange("A1:D1").merge();
  sheet.getRange("A2:D2").merge();
  ["LIVE STATUS", "FIRST-TIME SETUP", "CONFIGURATION REFERENCE", "SHEET MAP", "OPERATING CHECKLIST", "FIELD DICTIONARY", "SECURITY AND SCALE NOTES"].forEach(function(title) {
    const rowIndex = rows.findIndex(function(row) { return row[0] === title; });
    if (rowIndex >= 0) sheet.getRange(rowIndex + 1, 1, 1, 4).merge();
  });
  sheet.setName(GUIDE_SHEET_NAME);
  sheet.setHiddenGridlines(true);
  sheet.setFrozenRows(2);
  sheet.setTabColor(THEME.lavender);
  sheet.setColumnWidth(1, 215);
  sheet.setColumnWidth(2, 270);
  sheet.setColumnWidth(3, 390);
  sheet.setColumnWidth(4, 390);
  sheet.getRange(1, 1, rows.length, 4)
    .setFontFamily("Arial")
    .setFontColor(THEME.ink)
    .setVerticalAlignment("top")
    .setWrap(true);
  sheet.getRange("A1:D1")
    .setBackground(THEME.darkGreen)
    .setFontColor(THEME.offWhite)
    .setFontSize(18)
    .setFontWeight("bold")
    .setVerticalAlignment("middle");
  sheet.getRange("A2:D2")
    .setBackground(THEME.green)
    .setFontColor(THEME.offWhite)
    .setFontSize(10)
    .setFontStyle("italic");
  [4, 11, 21, 30, 38, 44, 66].forEach(function(row) {
    sheet.getRange(row, 1, 1, 4)
      .setBackground(THEME.lavender)
      .setFontColor(THEME.darkGreen)
      .setFontWeight("bold")
      .setFontSize(11);
  });
  [5, 12, 22, 31, 45].forEach(function(row) {
    sheet.getRange(row, 1, 1, 4)
      .setBackground(THEME.darkGreen)
      .setFontColor(THEME.offWhite)
      .setFontWeight("bold");
  });
  sheet.getRange("A6:D9").applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY);
  sheet.getRange("A23:D28").applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY);
  sheet.getRange("A32:D36").applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY);
  sheet.getRange("A46:D64").applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY);
  sheet.getRange(1, 1, rows.length, 4)
    .setBorder(true, true, true, true, true, true, "#D5E0DB", SpreadsheetApp.BorderStyle.SOLID);
  sheet.setRowHeight(1, 34);
  sheet.setRowHeight(2, 28);
  [4, 11, 21, 30, 38, 44, 66].forEach(function(row) {
    sheet.setRowHeight(row, 26);
  });
  [5, 12, 22, 31, 45].forEach(function(row) {
    sheet.setRowHeight(row, 24);
  });
  sheet.getRange("A6:A9").setFontWeight("bold").setFontColor(THEME.darkGreen);
  sheet.getRange("B6:B9")
    .setBackground(THEME.paleLavender)
    .setFontColor(THEME.darkGreen)
    .setFontWeight("bold")
    .setFontSize(12)
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle");
  sheet.getRange("A23:A28").setFontWeight("bold").setFontColor(THEME.darkGreen);
  sheet.getRange("A32:A36").setFontWeight("bold").setFontColor(THEME.green);
  sheet.getRange("A46:A64")
    .setFontFamily("Courier New")
    .setFontWeight("bold")
    .setFontColor(THEME.green);
  sheet.getRange(1, 1, rows.length, 4).setFontSize(10);
  sheet.getRange("A1:D1").setFontSize(18);
}

function formatDataSheet_(sheet, definition) {
  if (!sheet) return;
  const lastColumn = definition.headers.length;
  const lastRow = Math.max(sheet.getLastRow(), 1);
  const headerRange = sheet.getRange(1, 1, 1, lastColumn);
  const bodyRange = sheet.getRange(1, 1, lastRow, lastColumn);
  const tabColors = {
    Visions: THEME.green,
    Submissions: THEME.lavender,
    Settings: THEME.lightLavender,
    Votes: THEME.green,
    Unvotes: THEME.lavender,
    "Activity Log": THEME.darkGreen
  };
  const widths = {
    id: 310, createdAt: 155, publishedAt: 155, updatedAt: 155, status: 115,
    team: 170, track: 180, prompt: 380, image: 300, imageSource: 125,
    color: 100, height: 85, votes: 80, submittedBy: 180,
    generationStatus: 125, generationStartedAt: 155, generationCompletedAt: 155, generationAttempts: 105, generationError: 320, promptVersion: 135, imageModel: 180, imageMimeType: 125, driveFileId: 250, reviewedAt: 155, reviewedBy: 125,
    timestamp: 155, eventId: 280, action: 180, status: 115, participantId: 230, message: 300, details: 420,
    key: 170, value: 125, votedAt: 155, active: 85, unvotedAt: 155
  };

  sheet.setHiddenGridlines(true);
  sheet.setFrozenRows(1);
  sheet.setTabColor(tabColors[definition.name] || THEME.green);
  headerRange
    .setBackground(THEME.darkGreen)
    .setFontColor(THEME.offWhite)
    .setFontWeight("bold")
    .setFontFamily("Arial")
    .setVerticalAlignment("middle");
  bodyRange
    .setFontFamily("Arial")
    .setFontColor(THEME.ink)
    .setVerticalAlignment("top");
  if (lastRow > 1 && sheet.getBandings().length === 0) bodyRange.applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY);
  if (!sheet.getFilter()) sheet.getRange(1, 1, Math.max(lastRow, sheet.getMaxRows()), lastColumn).createFilter();

  definition.headers.forEach(function(header, index) {
    headerRange.getCell(1, index + 1).setNote(FIELD_NOTES[header] || "Competition data field.");
    sheet.setColumnWidth(index + 1, widths[header] || 140);
    if (header === "id") {
      sheet.getRange(1, index + 1, lastRow, 1)
        .setFontFamily("Courier New")
        .setFontSize(9);
    }
  });
  ["createdAt", "publishedAt", "updatedAt", "votedAt", "unvotedAt", "generationStartedAt", "generationCompletedAt", "reviewedAt", "timestamp"].forEach(function(header) {
    const index = definition.headers.indexOf(header);
    if (index !== -1 && lastRow > 1) sheet.getRange(2, index + 1, lastRow - 1, 1).setNumberFormat("yyyy-mm-dd hh:mm");
  });
  ["height", "votes", "generationAttempts"].forEach(function(header) {
    const index = definition.headers.indexOf(header);
    if (index !== -1 && lastRow > 1) sheet.getRange(2, index + 1, lastRow - 1, 1).setNumberFormat("0");
  });
  ["prompt", "image", "generationError", "message", "details"].forEach(function(header) {
    const index = definition.headers.indexOf(header);
    if (index !== -1) sheet.getRange(1, index + 1, lastRow, 1).setWrap(true);
  });

  const statusIndex = definition.headers.indexOf("status");
  if (statusIndex !== -1) {
    const statusRange = sheet.getRange(2, statusIndex + 1, Math.max(lastRow - 1, 1), 1);
    const rules = [
      SpreadsheetApp.newConditionalFormatRule()
        .whenTextEqualTo("published")
        .setBackground(THEME.paleGreen)
        .setFontColor(THEME.ink)
        .setRanges([statusRange])
        .build(),
      SpreadsheetApp.newConditionalFormatRule()
        .whenTextEqualTo("pending")
        .setBackground(THEME.paleLavender)
        .setFontColor(THEME.ink)
        .setRanges([statusRange])
        .build(),
      SpreadsheetApp.newConditionalFormatRule()
        .whenTextEqualTo("deleted")
        .setBackground(THEME.paleRed)
        .setFontColor(THEME.red)
        .setRanges([statusRange])
        .build()
    ];
    sheet.setConditionalFormatRules(rules);
  }
  sheet.setRowHeight(1, 30);
}

function getSheet_(definition) {
  const spreadsheet = getSpreadsheet_();
  const existing = spreadsheet.getSheetByName(definition.name);
  if (existing) return existing;
  const sheet = spreadsheet.insertSheet(definition.name);
  sheet.getRange(1, 1, 1, definition.headers.length).setValues([definition.headers]);
  sheet.setFrozenRows(1);
  return sheet;
}

function rows_(sheet) {
  if (sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
}

function sheetHeaders_(sheet) {
  return sheet.getRange(1, 1, 1, Math.max(1, sheet.getLastColumn())).getValues()[0];
}

function objectRows_(definition) {
  const sheet = getSheet_(definition);
  const headers = sheetHeaders_(sheet);
  return rows_(sheet).map(function(row, index) {
    const record = { _row: index + 2, _sheet: sheet };
    headers.forEach(function(header, column) {
      if (header) record[header] = row[column];
    });
    definition.headers.forEach(function(header) {
      if (record[header] === undefined) record[header] = "";
    });
    return record;
  });
}

function sheetSafeValue_(value) {
  if (typeof value !== "string") return value;
  // Google Sheets can interpret leading formula characters in user input.
  // Prefix those values so they remain visible text, never executable formulas.
  return /^[=+\-@]/.test(value) ? "'" + value : value;
}

function appendRecord_(definition, record) {
  const sheet = getSheet_(definition);
  const headers = sheetHeaders_(sheet);
  const values = headers.map(function(header) {
    return record[header] === undefined ? "" : sheetSafeValue_(record[header]);
  });
  sheet.appendRow(values);
}

function updateRecord_(record, fields) {
  const headers = record._sheet.getRange(1, 1, 1, record._sheet.getLastColumn()).getValues()[0];
  Object.keys(fields).forEach(function(field) {
    const column = headers.indexOf(field);
    if (column !== -1) record._sheet.getRange(record._row, column + 1).setValue(sheetSafeValue_(fields[field]));
  });
}

function findRecord_(definition, field, value) {
  return objectRows_(definition).find(function(record) {
    return String(record[field]) === String(value);
  }) || null;
}

function cleanText_(value, maxLength, fieldName) {
  const text = String(value == null ? "" : value).trim();
  if (!text) throw new Error(fieldName + " is required.");
  if (text.length > maxLength) throw new Error(fieldName + " is too long.");
  return text;
}

function cleanOptionalText_(value, maxLength) {
  const text = String(value == null ? "" : value).trim();
  return text.slice(0, maxLength);
}

function imageSource_(value) {
  const source = String(value == null ? "" : value).trim().toLowerCase();
  return ["demo-preview", "generated", "uploaded", "curated"].indexOf(source) !== -1
    ? source
    : "demo-preview";
}

function driveFileIdFromImage_(image, driveFileId) {
  const explicitId = String(driveFileId == null ? "" : driveFileId).trim();
  if (explicitId) return explicitId;
  const text = String(image == null ? "" : image).trim();
  const match = text.match(/(?:[?&]id=|\/d\/)([A-Za-z0-9_-]+)/);
  return match ? match[1] : "";
}

function driveThumbnailUrl_(fileId) {
  return "https://drive.google.com/thumbnail?id=" + encodeURIComponent(fileId) + "&sz=" + DRIVE_IMAGE_THUMBNAIL_SIZE;
}

function driveViewUrl_(fileId) {
  return "https://drive.google.com/uc?export=view&id=" + encodeURIComponent(fileId);
}

function imageDeliveryUrl_(image, driveFileId) {
  const fileId = driveFileIdFromImage_(image, driveFileId);
  return fileId ? driveThumbnailUrl_(fileId) : String(image == null ? "" : image).trim();
}

function imageFallbackUrl_(image, driveFileId) {
  const fileId = driveFileIdFromImage_(image, driveFileId);
  return fileId ? driveViewUrl_(fileId) : "";
}

function cleanNumber_(value, fallback, min, max) {
  const number = Number(value);
  if (!isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function newId_() {
  return Utilities.getUuid();
}

function now_() {
  return new Date();
}

function withLock_(callback) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    return callback();
  } finally {
    lock.releaseLock();
  }
}

function enforceRateLimit_(bucket, identifier) {
  const limit = ABUSE_RATE_LIMITS_[bucket];
  if (!limit) return;
  const normalized = String(identifier == null ? "" : identifier).trim();
  if (!normalized) throw new Error("RATE_LIMITED: An anonymous browser ID is required.");
  const safeIdentifier = normalized.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 100);
  const cacheKey = ABUSE_RATE_LIMIT_CACHE_PREFIX_ + bucket + "_" + safeIdentifier;
  const cache = CacheService.getScriptCache();
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    const now = Date.now();
    let state = null;
    const cached = cache.get(cacheKey);
    if (cached) {
      try {
        state = JSON.parse(cached);
      } catch (error) {
        state = null;
      }
    }
    if (!state || Number(state.resetAt) <= now) {
      state = { count: 0, resetAt: now + limit.windowSeconds * 1000 };
    }
    if (Number(state.count) >= limit.maxRequests) {
      const waitSeconds = Math.max(1, Math.ceil((Number(state.resetAt) - now) / 1000));
      throw new Error("RATE_LIMITED: Too many requests. Please wait " + waitSeconds + " seconds.");
    }
    state.count = Number(state.count) + 1;
    cache.put(cacheKey, JSON.stringify(state), limit.windowSeconds);
  } finally {
    lock.releaseLock();
  }
}

function parseBoolean_(value, fallback) {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return fallback;
}

function parseDeadline_(value, fallback) {
  if (value === undefined || value === null) return fallback;
  const text = String(value).trim();
  if (!text) return "";
  const timestamp = new Date(text).getTime();
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : fallback;
}

function getSettings_() {
  const settings = Object.assign({}, DEFAULT_SETTINGS);
  objectRows_(SHEETS.settings).forEach(function(record) {
    if (record.key === "submissionsOpen") settings.submissionsOpen = parseBoolean_(record.value, settings.submissionsOpen);
    if (record.key === "votingOpen") settings.votingOpen = parseBoolean_(record.value, settings.votingOpen);
    if (record.key === "submissionDeadline") settings.submissionDeadline = parseDeadline_(record.value, settings.submissionDeadline);
    if (record.key === "votingDeadline") settings.votingDeadline = parseDeadline_(record.value, settings.votingDeadline);
    if (record.key === "submissionRound") settings.submissionRound = String(record.value || settings.submissionRound);
    if (record.key === "winnerVisionId") settings.winnerVisionId = String(record.value || "");
    if (record.key === "winnerDeclaredAt") settings.winnerDeclaredAt = String(record.value || "");
  });
  return settings;
}

function saveSettings_(payload) {
  return withLock_(function() {
    const settings = getSettings_();
    settings.submissionsOpen = parseBoolean_(payload.submissionsOpen, settings.submissionsOpen);
    settings.votingOpen = parseBoolean_(payload.votingOpen, settings.votingOpen);
    settings.submissionDeadline = parseDeadline_(payload.submissionDeadline, settings.submissionDeadline);
    settings.votingDeadline = parseDeadline_(payload.votingDeadline, settings.votingDeadline);
    if (settings.votingOpen) {
      settings.winnerVisionId = "";
      settings.winnerDeclaredAt = "";
    }
    const timestamp = now_();
    const definition = SHEETS.settings;

    ["submissionsOpen", "votingOpen", "submissionDeadline", "votingDeadline", "winnerVisionId", "winnerDeclaredAt"].forEach(function(key) {
      const record = findRecord_(definition, "key", key);
      if (record) {
        updateRecord_(record, { value: String(settings[key]), updatedAt: timestamp });
      } else {
        appendRecord_(definition, { key: key, value: String(settings[key]), updatedAt: timestamp });
      }
    });
    invalidatePublicResponseCache_();
    return { ok: true, settings: settings };
  });
}

function buildWinnerState_(visions, settings) {
  const ranked = [...visions].sort(function(left, right) {
    const voteDifference = (Number(right.votes) || 0) - (Number(left.votes) || 0);
    if (voteDifference) return voteDifference;
    return (Date.parse(right.publishedAt || right.createdAt || "") || 0) - (Date.parse(left.publishedAt || left.createdAt || "") || 0);
  });
  if (!ranked.length) return { status: "empty", vision: null, leaders: [], topVotes: 0, declaredAt: "" };
  const topVotes = Number(ranked[0].votes) || 0;
  const leaders = ranked.filter(function(vision) { return (Number(vision.votes) || 0) === topVotes; });
  const declaredId = String(settings && settings.winnerVisionId || "");
  const declaredVision = declaredId
    ? leaders.find(function(vision) { return String(vision.id) === declaredId; }) || null
    : null;
  return {
    status: declaredVision ? "declared" : leaders.length > 1 ? "tie" : "pending",
    vision: declaredVision,
    leaders: leaders,
    topVotes: topVotes,
    declaredAt: declaredVision ? String(settings.winnerDeclaredAt || "") : ""
  };
}

function setWinner_(visionId) {
  return withLock_(function() {
    const settings = getSettings_();
    if (settings.votingOpen) throw new Error("Close voting before declaring a winner.");
    const normalizedId = cleanText_(visionId, 200, "Winner vision ID");
    const record = findRecord_(SHEETS.visions, "id", normalizedId);
    if (!record || String(record.status).toLowerCase() !== "published") {
      throw new Error("Only a published vision can be declared winner.");
    }
    const published = objectRows_(SHEETS.visions)
      .filter(function(item) { return String(item.status).toLowerCase() === "published"; })
      .map(publicVision_);
    const currentState = buildWinnerState_(published, settings);
    if (!currentState.leaders.some(function(vision) { return String(vision.id) === normalizedId; })) {
      throw new Error("Only a top-scoring vision can be declared winner.");
    }
    const timestamp = now_();
    const definition = SHEETS.settings;
    [
      { key: "winnerVisionId", value: normalizedId },
      { key: "winnerDeclaredAt", value: timestamp }
    ].forEach(function(setting) {
      const existing = findRecord_(definition, "key", setting.key);
      if (existing) updateRecord_(existing, { value: setting.value, updatedAt: timestamp });
      else appendRecord_(definition, { key: setting.key, value: setting.value, updatedAt: timestamp });
    });
    logActivity_("winner_declared", "published", record, "Organizer declared the final winner.", { winnerVisionId: normalizedId });
    invalidatePublicResponseCache_();
    const updatedSettings = getSettings_();
    return { ok: true, settings: updatedSettings, winner: buildWinnerState_(published, updatedSettings) };
  });
}

function clearWinner_() {
  return withLock_(function() {
    const timestamp = now_();
    const definition = SHEETS.settings;
    ["winnerVisionId", "winnerDeclaredAt"].forEach(function(key) {
      const existing = findRecord_(definition, "key", key);
      if (existing) updateRecord_(existing, { value: "", updatedAt: timestamp });
      else appendRecord_(definition, { key: key, value: "", updatedAt: timestamp });
    });
    invalidatePublicResponseCache_();
    return { ok: true, settings: getSettings_(), winner: { status: "pending", vision: null, leaders: [], topVotes: 0, declaredAt: "" } };
  });
}

function resetSubmissionRound_() {
  return withLock_(function() {
    const settings = getSettings_();
    const nextRound = String((Number(settings.submissionRound) || 1) + 1);
    const timestamp = now_();
    const definition = SHEETS.settings;
    const record = findRecord_(definition, "key", "submissionRound");
    if (record) updateRecord_(record, { value: nextRound, updatedAt: timestamp });
    else appendRecord_(definition, { key: "submissionRound", value: nextRound, updatedAt: timestamp });
    settings.submissionRound = nextRound;
    invalidatePublicResponseCache_();
    return { ok: true, submissionRound: nextRound, settings: settings };
  });
}

function getPublicVisions_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(PUBLIC_RESPONSE_CACHE_KEY_);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch (error) {
      cache.remove(PUBLIC_RESPONSE_CACHE_KEY_);
    }
  }

  // Collapse a burst of public reads into one Sheets read. The second cache
  // check matters when several visitors arrive at the same time.
  const lock = LockService.getScriptLock();
  if (lock.tryLock(1500)) {
    try {
      const lockedCache = cache.get(PUBLIC_RESPONSE_CACHE_KEY_);
      if (lockedCache) {
        try {
          return JSON.parse(lockedCache);
        } catch (error) {
          cache.remove(PUBLIC_RESPONSE_CACHE_KEY_);
        }
      }
      const result = buildPublicVisionsResponse_();
      const serialized = JSON.stringify(result);
      if (serialized.length <= PUBLIC_RESPONSE_CACHE_MAX_BYTES_) {
        cache.put(PUBLIC_RESPONSE_CACHE_KEY_, serialized, PUBLIC_RESPONSE_CACHE_TTL_SECONDS_);
      }
      return result;
    } finally {
      lock.releaseLock();
    }
  }

  // A cache miss should never make the public page fail just because a
  // concurrent request is holding the short read lock.
  return buildPublicVisionsResponse_();
}

function buildPublicVisionsResponse_() {
  const settings = getSettings_();
  const visions = objectRows_(SHEETS.visions)
    .filter(function(record) { return String(record.status).toLowerCase() === "published"; })
    .map(publicVision_);
  return { ok: true, settings: settings, visions: visions, winner: buildWinnerState_(visions, settings) };
}

function invalidatePublicResponseCache_() {
  CacheService.getScriptCache().remove(PUBLIC_RESPONSE_CACHE_KEY_);
}

function publicVision_(record) {
  return {
    id: String(record.id),
    createdAt: record.createdAt,
    publishedAt: record.publishedAt,
    status: "published",
    team: String(record.team || ""),
    title: String(record.title || ""),
    track: String(record.track || ""),
    prompt: String(record.prompt || ""),
    problem: String(record.problem || ""),
    impact: String(record.impact || ""),
    beneficiaries: String(record.beneficiaries || ""),
    tags: String(record.tags || ""),
    image: imageDeliveryUrl_(record.image, record.driveFileId),
    imageFallback: imageFallbackUrl_(record.image, record.driveFileId),
    imageSource: imageSource_(record.imageSource),
    color: String(record.color || "#D8D0ED"),
    height: cleanNumber_(record.height, 280, 180, 520),
    votes: Number(record.votes) || 0
  };
}

function submitVision_(payload) {
  const settings = getSettings_();
  if (!settings.submissionsOpen || !deadlineIsOpen_(settings.submissionDeadline)) {
    throw new Error("Submissions are currently closed or past their deadline.");
  }
  const team = cleanText_(payload.team, 100, "Group name");
  const title = cleanText_(payload.title, 120, "Vision title");
  const track = cleanText_(payload.track, 80, "Track");
  const prompt = cleanText_(payload.prompt, 2000, "Vision description");
  const participantId = cleanText_(payload.participantId, 160, "Participant session");
  const submissionRound = String(settings.submissionRound || "1");
  enforceRateLimit_("submission", participantId);
  const deviceId = cleanOptionalText_(payload.deviceId || "", 80);
  const deviceLabel = cleanOptionalText_(payload.deviceLabel || "", 180);
  const browser = cleanOptionalText_(payload.browser || "", 80);
  const browserVersion = cleanOptionalText_(payload.browserVersion || "", 40);
  const operatingSystem = cleanOptionalText_(payload.operatingSystem || "", 100);
  const deviceType = cleanOptionalText_(payload.deviceType || "", 40);
  const platform = cleanOptionalText_(payload.platform || "", 120);
  const screen = cleanOptionalText_(payload.screen || "", 80);
  const timezone = cleanOptionalText_(payload.timezone || "", 100);
  const language = cleanOptionalText_(payload.language || "", 40);
  const userAgent = cleanOptionalText_(payload.userAgent || "", 500);
  const problem = cleanOptionalText_(payload.problem, 800);
  const impact = cleanOptionalText_(payload.impact, 800);
  const beneficiaries = cleanOptionalText_(payload.beneficiaries, 200);
  const tags = cleanOptionalText_(payload.tags, 200);
  const submissionId = newId_();
  const timestamp = now_();
  const record = {
    id: submissionId,
    createdAt: timestamp,
    updatedAt: timestamp,
    status: "processing",
    team: team,
    title: title,
    track: track,
    prompt: prompt,
    problem: problem,
    impact: impact,
    beneficiaries: beneficiaries,
    tags: tags,
    image: "",
    imageSource: "generated",
    color: /^#[0-9a-f]{6}$/i.test(String(payload.color || "")) ? String(payload.color) : "#D8D0ED",
    height: cleanNumber_(payload.height, 280, 180, 520),
    submittedBy: cleanOptionalText_(payload.submittedBy || "", 120),
    participantId: participantId,
    submissionRound: submissionRound,
    deviceId: deviceId,
    deviceLabel: deviceLabel,
    browser: browser,
    browserVersion: browserVersion,
    operatingSystem: operatingSystem,
    deviceType: deviceType,
    platform: platform,
    screen: screen,
    timezone: timezone,
    language: language,
    userAgent: userAgent,
    generationStatus: "queued",
    generationStartedAt: "",
    generationCompletedAt: "",
    generationAttempts: 0,
    generationError: "",
    promptVersion: IMAGE_PROMPT_VERSION,
    imageModel: imageGenerationModel_(),
    imageMimeType: "",
    driveFileId: "",
    reviewedAt: "",
    reviewedBy: ""
  };

  withLock_(function() {
    if (participantHasSubmitted_(participantId, submissionRound)) {
      throw new Error("This participant has already submitted in the current round.");
    }
    appendRecord_(SHEETS.submissions, record);
    logActivity_("submission_received", "queued", record, "Submission reserved before image generation.", { promptVersion: IMAGE_PROMPT_VERSION });
  });

  const generationStartedAt = now_();
  withLock_(function() {
    const reserved = findRecord_(SHEETS.submissions, "id", submissionId);
    if (reserved) updateRecord_(reserved, { generationStatus: "generating", generationStartedAt: generationStartedAt, updatedAt: generationStartedAt });
  });

  try {
    const generated = withGenerationSlot_(function() {
      return generateVisionImageWithRetry_(submissionId, team, track, prompt, {
        title: title,
        problem: problem,
        impact: impact,
        beneficiaries: beneficiaries
      });
    });
    const completedAt = now_();
    withLock_(function() {
      const saved = findRecord_(SHEETS.submissions, "id", submissionId);
      if (!saved) throw new Error("Reserved submission record disappeared.");
      updateRecord_(saved, {
        status: "pending",
        updatedAt: completedAt,
        image: generated.image.url,
        imageSource: "generated",
        generationStatus: "generated",
        generationCompletedAt: completedAt,
        generationAttempts: generated.attempts,
        generationError: "",
        imageMimeType: generated.image.mimeType,
        driveFileId: generated.image.fileId || ""
      });
      logActivity_("generation_succeeded", "pending", saved, "Image generated and submission queued for organizer review.", { attempts: generated.attempts, mimeType: generated.image.mimeType });
    });
    return { ok: true, status: "pending", submissionId: submissionId, imageSource: "generated", generationAttempts: generated.attempts };
  } catch (error) {
    const completedAt = now_();
    const message = safeErrorMessage_(error);
    withLock_(function() {
      const failed = findRecord_(SHEETS.submissions, "id", submissionId);
      if (failed) {
        updateRecord_(failed, {
          status: "failed",
          updatedAt: completedAt,
          generationStatus: "failed",
          generationCompletedAt: completedAt,
          generationAttempts: Number(error.generationAttempts) || 1,
          generationError: message
        });
        logActivity_("generation_failed", "failed", failed, message, { retryable: isRetryableGenerationError_(error) });
      }
    });
    return { ok: false, status: "failed", submissionId: submissionId, error: message };
  }
}

function participantHasSubmitted_(participantId, submissionRound) {
  return objectRows_(SHEETS.submissions).some(function(record) {
    const status = String(record.status || "").toLowerCase();
    return String(record.participantId || "") === String(participantId || "") &&
      String(record.submissionRound || "1") === String(submissionRound || "1") &&
      ["processing", "pending", "published"].indexOf(status) !== -1;
  });
}

function logActivity_(action, status, record, message, details) {
  try {
    appendRecord_(SHEETS.activityLog, {
      timestamp: now_(),
      eventId: newId_(),
      action: cleanOptionalText_(action, 100),
      status: cleanOptionalText_(status, 40),
      submissionId: cleanOptionalText_(record && record.id, 200),
      participantId: cleanOptionalText_(record && record.participantId, 200),
      team: cleanOptionalText_(record && record.team, 100),
      track: cleanOptionalText_(record && record.track, 100),
      message: cleanOptionalText_(message, 500),
      details: cleanOptionalText_(JSON.stringify(details || {}), 2000)
    });
  } catch (error) {
    Logger.log("Activity log write failed: " + safeErrorMessage_(error));
  }
}

function isRetryableGenerationError_(error) {
  const message = safeErrorMessage_(error).toLowerCase();
  return /429|500|502|503|504|rate limit|temporarily|timeout|overloaded|try again/.test(message);
}

function withGenerationSlot_(callback) {
  const cache = CacheService.getScriptCache();
  const token = newId_();
  const deadline = Date.now() + 240000;
  while (Date.now() < deadline) {
    const lock = LockService.getScriptLock();
    let acquired = false;
    if (lock.tryLock(5000)) {
      try {
        if (!cache.get(GENERATION_SLOT_KEY)) {
          cache.put(GENERATION_SLOT_KEY, token, 300);
          acquired = true;
        }
      } finally {
        lock.releaseLock();
      }
    }
    if (acquired) {
      try {
        return callback();
      } finally {
        const releaseLock = LockService.getScriptLock();
        if (releaseLock.tryLock(5000)) {
          try {
            if (cache.get(GENERATION_SLOT_KEY) === token) cache.remove(GENERATION_SLOT_KEY);
          } finally {
            releaseLock.releaseLock();
          }
        }
      }
    }
    Utilities.sleep(750);
  }
  throw new Error("Image generation is busy. The submission was recorded; try again shortly.");
}

function generateVisionImageWithRetry_(submissionId, team, track, prompt, details) {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const image = generateVisionImage_(submissionId, team, track, prompt, details);
      return { image: image, attempts: attempt };
    } catch (error) {
      lastError = error;
      error.generationAttempts = attempt;
      if (!isRetryableGenerationError_(error) || attempt === 3) throw error;
      Utilities.sleep(1000 * Math.pow(2, attempt - 1));
    }
  }
  throw lastError || new Error("Image generation failed.");
}

function generateGeminiVisionImage_(submissionId, imagePrompt, config) {
  const response = UrlFetchApp.fetch(config.endpoint, {
    method: "post",
    contentType: "application/json",
    headers: { "x-goog-api-key": config.apiKey },
    payload: JSON.stringify({
      model: config.model,
      input: [{ type: "text", text: imagePrompt }]
    }),
    muteHttpExceptions: true
  });
  const status = response.getResponseCode();
  if (status < 200 || status >= 300) {
    let detail = "Google Gemini image generation failed.";
    try {
      const errorBody = JSON.parse(response.getContentText());
      detail = errorBody.error?.message || errorBody.message || detail;
    } catch (ignored) {}
    throw new Error(String(detail).slice(0, 240));
  }
  let result;
  try {
    result = JSON.parse(response.getContentText());
  } catch (error) {
    throw new Error("Google Gemini returned an invalid image response.");
  }
  const candidates = [];
  if (result.output_image) candidates.push(result.output_image);
  if (Array.isArray(result.output)) candidates.push.apply(candidates, result.output);
  if (Array.isArray(result.outputs)) candidates.push.apply(candidates, result.outputs);
  const image = candidates.find(function(candidate) {
    return candidate && (candidate.data || (candidate.image && candidate.image.data));
  });
  const encodedImage = image && (image.data || (image.image && image.image.data));
  if (!encodedImage) throw new Error("Google Gemini did not return an image. Try a shorter vision description.");
  const mimeType = String((image && (image.mime_type || image.mimeType)) || "image/png");
  const blob = Utilities.newBlob(
    Utilities.base64Decode(String(encodedImage).replace(/^data:[^;]+;base64,/, "")),
    mimeType,
    "saudi-vision-" + submissionId + ".png"
  );
  const file = DriveApp.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  const fileId = file.getId();
  return {
    url: driveThumbnailUrl_(fileId),
    fallbackUrl: driveViewUrl_(fileId),
    mimeType: mimeType,
    fileId: fileId
  };
}

function generateVisionImage_(submissionId, team, track, prompt, details) {
  details = details || {};
  const gemini = geminiConfig_();
  const config = cloudflareConfig_();
  const imagePrompt = [
    "Create ONE polished wide editorial concept image for the participant's idea below.",
    "PRIMARY RULE: depict the participant idea literally and specifically. The participant idea is the source of truth.",
    "Do not replace the participant idea with a generic Saudi skyline, desert, solar panels, futuristic city, or another common AI image.",
    "Identify the main subject, action or mechanism, setting, and people from the participant description. Show those concrete elements in one coherent scene.",
    "Do not invent a different product, technology, location, or storyline. If a detail is unclear, keep the scene simple rather than guessing.",
    "Show an optimistic, plausible Saudi 2050 future with clear human benefit, cinematic 16:9 composition, natural depth, premium editorial lighting, and a restrained palette.",
    "Generate exactly ONE image with one scene and one clear focal subject. Do not create a collage, multiple variations, or a generic mood image.",
    "Do not include readable words, letters, logos, flags, interface elements, borders, labels, or text in the image.",
    "=== PARTICIPANT IDEA — MANDATORY SOURCE OF TRUTH ===",
    "Title: " + String(details.title || ""),
    "Description: " + String(prompt || ""),
    "Problem or opportunity: " + String(details.problem || ""),
    "Expected impact: " + String(details.impact || ""),
    "Beneficiaries: " + String(details.beneficiaries || ""),
    "=== END PARTICIPANT IDEA ===",
  ].join("\n");
  if (gemini.apiKey) {
    setActiveAiProvider_("Google Gemini");
    try {
      return generateGeminiVisionImage_(submissionId, imagePrompt, gemini);
    } catch (error) {
      if (!config.apiToken || !config.endpoint) throw error;
      setActiveAiProvider_("Cloudflare Workers AI", error);
    }
  }
  if (!config.apiToken || !config.endpoint) {
    throw new Error("Live AI is not configured. Add GEMINI_API_KEY or the Cloudflare settings in Apps Script Project Settings.");
  }
  if (!gemini.apiKey) setActiveAiProvider_("Cloudflare Workers AI", null);
  const response = UrlFetchApp.fetch(config.endpoint, {
    method: "post",
    contentType: "application/json",
    headers: { Authorization: "Bearer " + config.apiToken, Accept: "image/png" },
    payload: JSON.stringify({ prompt: imagePrompt }),
    muteHttpExceptions: true
  });
  const status = response.getResponseCode();
  const headers = response.getHeaders();
  const contentType = String(headers["Content-Type"] || headers["content-type"] || "").split(";")[0].toLowerCase();
  if (status < 200 || status >= 300) {
    let detail = "Cloudflare Workers AI image generation failed.";
    try {
      const errorBody = JSON.parse(response.getContentText());
      const firstError = Array.isArray(errorBody.errors) ? errorBody.errors[0] : null;
      detail = (firstError && (firstError.message || firstError.code)) ||
        (errorBody.error && (errorBody.error.message || errorBody.error)) || detail;
    } catch (ignored) {}
    throw new Error(String(detail).slice(0, 240));
  }

  let blob;
  let mimeType = contentType || "image/png";
  if (contentType.indexOf("json") !== -1) {
    let result;
    try { result = JSON.parse(response.getContentText()); }
    catch (error) { throw new Error("Cloudflare returned an invalid image response."); }
    const resultBody = result.result || result;
    const encodedImage = resultBody.image || resultBody.data || resultBody.base64 ||
      (Array.isArray(resultBody.images) ? resultBody.images[0] : "");
    if (!encodedImage) throw new Error("Cloudflare did not return an image. Try a shorter vision description.");
    const encoded = String(encodedImage).replace(/^data:[^;]+;base64,/, "");
    mimeType = String(resultBody.mime_type || resultBody.mimeType || "image/png");
    blob = Utilities.newBlob(Utilities.base64Decode(encoded), mimeType, "saudi-vision-" + submissionId + ".png");
  } else {
    blob = response.getBlob();
    mimeType = blob.getContentType() || mimeType || "image/png";
    blob.setName("saudi-vision-" + submissionId + (mimeType === "image/jpeg" ? ".jpg" : ".png"));
  }
  const file = DriveApp.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  const fileId = file.getId();
  return {
    url: driveThumbnailUrl_(fileId),
    fallbackUrl: driveViewUrl_(fileId),
    mimeType: mimeType,
    fileId: fileId
  };
}
function getOrganizerSnapshot_() {
  const settings = getSettings_();
  const pending = getPendingSubmissions_();
  const published = objectRows_(SHEETS.visions)
    .filter(function(record) { return String(record.status).toLowerCase() === "published"; })
    .map(publicVision_);
  return {
    ok: true,
    settings: settings,
    pending: pending,
    published: published,
    winner: buildWinnerState_(published, settings),
    analytics: getCompetitionAnalytics_(pending, published),
    ai: organizerAiStatus_()
  };
}

function getPendingSubmissions_() {
  return objectRows_(SHEETS.submissions)
    .filter(function(record) { return String(record.status).toLowerCase() === "pending"; })
    .map(function(record) {
      return {
        id: String(record.id),
        createdAt: record.createdAt,
        status: "pending",
        team: String(record.team || ""),
        title: String(record.title || ""),
        track: String(record.track || ""),
        prompt: String(record.prompt || ""),
        problem: String(record.problem || ""),
        impact: String(record.impact || ""),
        beneficiaries: String(record.beneficiaries || ""),
        tags: String(record.tags || ""),
        submittedBy: String(record.submittedBy || ""),
        participantId: String(record.participantId || ""),
        submissionRound: String(record.submissionRound || "1"),
        deviceId: String(record.deviceId || ""),
        deviceLabel: String(record.deviceLabel || ""),
        browser: String(record.browser || ""),
        browserVersion: String(record.browserVersion || ""),
        operatingSystem: String(record.operatingSystem || ""),
        deviceType: String(record.deviceType || ""),
        platform: String(record.platform || ""),
        screen: String(record.screen || ""),
        timezone: String(record.timezone || ""),
        language: String(record.language || ""),
        userAgent: String(record.userAgent || ""),
        image: imageDeliveryUrl_(record.image, record.driveFileId),
        imageFallback: imageFallbackUrl_(record.image, record.driveFileId),
        imageSource: imageSource_(record.imageSource),
        generationStatus: String(record.generationStatus || ""),
        generationAttempts: Number(record.generationAttempts) || 0,
        generationError: String(record.generationError || ""),
        promptVersion: String(record.promptVersion || ""),
        imageModel: String(record.imageModel || ""),
        color: String(record.color || "#D8D0ED"),
        height: cleanNumber_(record.height, 280, 180, 520),
        votes: 0
      };
    });
}

function copyRecordFields_(record, headers) {
  const copy = {};
  headers.forEach(function(header) {
    if (record && record[header] !== undefined) copy[header] = record[header];
  });
  return copy;
}

function moderateSubmission_(submissionId, nextStatus) {
  return withLock_(function() {
    if (["published", "deleted"].indexOf(nextStatus) === -1) {
      throw new Error("Invalid moderation status.");
    }
    const submission = findRecord_(SHEETS.submissions, "id", submissionId);
    if (!submission) throw new Error("Submission not found.");
    if (String(submission.status).toLowerCase() !== "pending") {
      throw new Error("Only pending submissions can be moderated.");
    }
    if (nextStatus === "published" && !String(submission.image || "")) {
      throw new Error("This submission has no generated image yet.");
    }

    const timestamp = now_();
    updateRecord_(submission, { status: nextStatus, updatedAt: timestamp, reviewedAt: timestamp, reviewedBy: "organizer" });
    if (nextStatus === "published") {
      const existingVision = findRecord_(SHEETS.visions, "id", submission.id);
      if (existingVision) throw new Error("This submission already has a vision record.");
      const vision = copyRecordFields_(submission, SHEETS.visions.headers);
      vision.publishedAt = timestamp;
      vision.status = "published";
      vision.votes = 0;
      vision.reviewedAt = timestamp;
      vision.reviewedBy = "organizer";
      appendRecord_(SHEETS.visions, vision);
    }
    logActivity_("moderation", nextStatus, submission, "Organizer changed submission status.", { nextStatus: nextStatus });
    invalidatePublicResponseCache_();
    return { ok: true, status: nextStatus, submissionId: String(submission.id) };
  });
}

function deletePublishedVision_(visionId) {
  return withLock_(function() {
    const vision = findRecord_(SHEETS.visions, "id", visionId);
    if (!vision) throw new Error("Published vision not found.");
    if (String(vision.status).toLowerCase() !== "published") {
      throw new Error("Only published visions can be deleted here.");
    }

    const timestamp = now_();
    const settings = getSettings_();
    if (String(settings.winnerVisionId || "") === String(visionId)) {
      ["winnerVisionId", "winnerDeclaredAt"].forEach(function(key) {
        const winnerSetting = findRecord_(SHEETS.settings, "key", key);
        if (winnerSetting) updateRecord_(winnerSetting, { value: "", updatedAt: timestamp });
      });
    }
    updateRecord_(vision, { status: "deleted" });
    objectRows_(SHEETS.votes)
      .filter(function(record) {
        return String(record.visionId) === String(visionId) && parseBoolean_(record.active, false);
      })
      .forEach(function(record) {
        updateRecord_(record, { active: false });
        appendRecord_(SHEETS.unvotes, {
          voterId: record.voterId,
          visionId: visionId,
          unvotedAt: timestamp
        });
      });
    const submission = findRecord_(SHEETS.submissions, "id", visionId);
    if (submission && String(submission.status).toLowerCase() === "published") {
      updateRecord_(submission, { status: "deleted", updatedAt: timestamp });
    }
    invalidatePublicResponseCache_();
    return { ok: true, status: "deleted", visionId: String(visionId) };
  });
}

function deadlineIsOpen_(deadline) {
  if (!deadline) return true;
  const timestamp = new Date(deadline).getTime();
  return Number.isFinite(timestamp) && timestamp > Date.now();
}

function getCompetitionAnalytics_(pending, published) {
  const activePublishedIds = {};
  published.forEach(function(vision) { activePublishedIds[String(vision.id)] = true; });
  const activeVotes = objectRows_(SHEETS.votes).filter(function(record) {
    return parseBoolean_(record.active, false) && activePublishedIds[String(record.visionId)];
  });
  const trackBreakdown = {};
  published.forEach(function(vision) {
    const track = String(vision.track || "Unassigned");
    if (!trackBreakdown[track]) trackBreakdown[track] = { published: 0, votes: 0 };
    trackBreakdown[track].published += 1;
    trackBreakdown[track].votes += Number(vision.votes) || 0;
  });
  return {
    totalSubmissions: objectRows_(SHEETS.submissions).length,
    pendingCount: pending.length,
    publishedCount: published.length,
    activeVotes: activeVotes.length,
    trackBreakdown: trackBreakdown,
    generatedAt: now_()
  };
}

function validVoterId_(value) {
  const voterId = cleanText_(value, 200, "Voter ID");
  if (!/^[a-zA-Z0-9._:-]+$/.test(voterId)) throw new Error("Invalid voter ID.");
  return voterId;
}

function voteForVision_(payload) {
  const voterId = validVoterId_(payload.voterId);
  enforceRateLimit_("voting", voterId);
  return withLock_(function() {
    const settings = getSettings_();
    if (!settings.votingOpen || !deadlineIsOpen_(settings.votingDeadline)) {
      throw new Error("Voting is currently closed or past its deadline.");
    }

    const visionId = cleanText_(payload.visionId, 200, "Vision ID");
    const vision = findRecord_(SHEETS.visions, "id", visionId);
    if (!vision || String(vision.status).toLowerCase() !== "published") {
      throw new Error("That vision is not available for voting.");
    }

    const activeVote = objectRows_(SHEETS.votes).find(function(record) {
      return String(record.voterId) === voterId && parseBoolean_(record.active, false);
    });
    if (activeVote) {
      throw new Error("This voter already has an active vote.");
    }

    appendRecord_(SHEETS.votes, {
      voterId: voterId,
      visionId: visionId,
      votedAt: now_(),
      active: true
    });
    updateRecord_(vision, { votes: (Number(vision.votes) || 0) + 1 });
    invalidatePublicResponseCache_();
    return { ok: true, action: "vote", visionId: visionId };
  });
}

function unvoteVision_(payload) {
  const voterId = validVoterId_(payload.voterId);
  enforceRateLimit_("voting", voterId);
  return withLock_(function() {
    const settings = getSettings_();
    if (!settings.votingOpen || !deadlineIsOpen_(settings.votingDeadline)) {
      throw new Error("Voting is currently closed or past its deadline.");
    }

    const visionId = cleanText_(payload.visionId, 200, "Vision ID");
    const activeVote = objectRows_(SHEETS.votes).find(function(record) {
      return String(record.voterId) === voterId &&
        String(record.visionId) === visionId &&
        parseBoolean_(record.active, false);
    });

    if (!activeVote) return { ok: true, action: "unvote", changed: false, visionId: visionId };

    updateRecord_(activeVote, { active: false });
    appendRecord_(SHEETS.unvotes, {
      voterId: voterId,
      visionId: visionId,
      unvotedAt: now_()
    });

    const vision = findRecord_(SHEETS.visions, "id", visionId);
    if (vision) updateRecord_(vision, { votes: Math.max(0, (Number(vision.votes) || 0) - 1) });
    invalidatePublicResponseCache_();
    return { ok: true, action: "unvote", changed: true, visionId: visionId };
  });
}

function constantTimeEquals_(left, right) {
  if (!left || !right || left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function requireAdmin_(payload) {
  const expected = String(PropertiesService.getScriptProperties().getProperty("ADMIN_KEY") || "").trim();
  const provided = String(payload.adminKey || "").trim();
  if (!expected) throw new Error("ADMIN_KEY is not configured in Script Properties.");
  if (!constantTimeEquals_(provided, expected)) throw new Error("Unauthorized: invalid organizer key.");
}

/**
 * Run this once from the Apps Script editor to grant external-request permission.
 * It does not access competition data or call Cloudflare. Delete it afterward if desired.
 */
function authorizeExternalRequest() {
  UrlFetchApp.fetch("https://www.google.com/generate_204", {
    method: "get",
    muteHttpExceptions: true
  });
}
