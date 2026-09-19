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
      Do not put ADMIN_KEY or GEMINI_API_KEY in index.html. The browser asks for
      the organizer key only when needed; Gemini is called server-side by this script.
      Add GEMINI_API_KEY in Project Settings → Script properties.
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

  This backend calls Gemini image generation server-side for every submission.
  The generated PNG is stored in Google Drive with link viewing enabled, and
  only the public image URL is written to Sheets. Never expose GEMINI_API_KEY
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
  Do not put ADMIN_KEY, Gemini keys, or service-account credentials in the
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
    headers: ["id", "createdAt", "publishedAt", "status", "team", "title", "track", "prompt", "problem", "impact", "beneficiaries", "tags", "image", "color", "height", "votes", "imageSource"]
  },
  submissions: {
    name: "Submissions",
    headers: ["id", "createdAt", "updatedAt", "status", "team", "title", "track", "prompt", "problem", "impact", "beneficiaries", "tags", "image", "color", "height", "submittedBy", "participantId", "submissionRound", "imageSource"]
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
  }
};

const GUIDE_SHEET_NAME = "START HERE";
const WORKBOOK_FORMAT_VERSION = "2026-09-19-v7";
const GEMINI_IMAGE_MODEL = "gemini-3.1-flash-image";
const GEMINI_INTERACTIONS_URL = "https://generativelanguage.googleapis.com/v1beta/interactions";
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
  submissionRound: "Submission eligibility round. Organizer reset increments this value."
};

const DEFAULT_SETTINGS = {
  submissionsOpen: true,
  votingOpen: true,
  submissionDeadline: "",
  votingDeadline: "",
  submissionRound: "1"
};

const TRACK_PROMPT_ENHANCERS_ = {
  "Green Tech": "Prioritize renewable energy, low-carbon materials, climate resilience, and harmony with Saudi landscapes.",
  "Smart Mobility": "Show clean, accessible movement through intelligent transport, walkability, and connected infrastructure.",
  "Heritage AI": "Blend Saudi heritage, crafts, language, and historic places with respectful, human-centered AI.",
  "NEOM": "Imagine a credible next-generation Saudi destination with advanced architecture, nature protection, and human wellbeing.",
  "Human Potential": "Center people, inclusion, talent, creativity, and healthier everyday life.",
  "Water Security": "Visualize resilient water systems using conservation, desalination, reuse, smart distribution, and restored ecosystems.",
  "Blue Economy": "Highlight responsible coastal innovation, marine science, clean seas, fisheries, and sustainable life along the Red Sea and Gulf.",
  "Circular Cities": "Show cities that design out waste through repair, reuse, renewable materials, efficient buildings, and regenerative public spaces.",
  "Future Food & Agriculture": "Show climate-smart food systems with local production, precision agriculture, vertical growing, and nourishing communities.",
  "Health & Wellbeing": "Depict preventive care, accessible health technology, active communities, mental wellbeing, and compassionate care for all ages.",
  "Education & Skills": "Imagine joyful lifelong learning, practical future skills, creative classrooms, and equal access to knowledge.",
  "Tourism & Culture": "Celebrate authentic Saudi places, stories, arts, and hospitality through low-impact tourism that benefits local communities.",
  "Digital Society & Governance": "Show trusted, inclusive digital public services that make communities safer, more transparent, and easier to participate in.",
  "Advanced Energy & Industry": "Visualize clean industry, advanced manufacturing, robotics, and energy systems creating skilled work.",
  "Other": "Use the participant’s idea as the lead and build a broad, optimistic Saudi 2050 future scene without forcing another track."
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

function route_(action, payload) {
  switch (action) {
    case "health":
      initializeSheets_();
      return {
        ok: true,
        service: "Imagine Saudi 2050",
        status: "ready",
        workbookFormatVersion: WORKBOOK_FORMAT_VERSION,
        sheets: Object.keys(SHEETS).map(function(key) { return SHEETS[key].name; }).concat([GUIDE_SHEET_NAME])
      };
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
    ["imageSource", "Visions / Submissions", "demo-preview, generated, uploaded, or curated.", "New submissions are generated by Gemini and remain pending until approved."],
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
    Unvotes: THEME.lavender
  };
  const widths = {
    id: 310, createdAt: 155, publishedAt: 155, updatedAt: 155, status: 115,
    team: 170, track: 150, prompt: 380, image: 300, imageSource: 125,
    color: 100, height: 85, votes: 80, submittedBy: 180,
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
  ["createdAt", "publishedAt", "updatedAt", "votedAt", "unvotedAt"].forEach(function(header) {
    const index = definition.headers.indexOf(header);
    if (index !== -1 && lastRow > 1) sheet.getRange(2, index + 1, lastRow - 1, 1).setNumberFormat("yyyy-mm-dd hh:mm");
  });
  ["height", "votes"].forEach(function(header) {
    const index = definition.headers.indexOf(header);
    if (index !== -1 && lastRow > 1) sheet.getRange(2, index + 1, lastRow - 1, 1).setNumberFormat("0");
  });
  ["prompt", "image"].forEach(function(header) {
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

function appendRecord_(definition, record) {
  const sheet = getSheet_(definition);
  const headers = sheetHeaders_(sheet);
  const values = headers.map(function(header) {
    return record[header] === undefined ? "" : record[header];
  });
  sheet.appendRow(values);
}

function updateRecord_(record, fields) {
  const headers = record._sheet.getRange(1, 1, 1, record._sheet.getLastColumn()).getValues()[0];
  Object.keys(fields).forEach(function(field) {
    const column = headers.indexOf(field);
    if (column !== -1) record._sheet.getRange(record._row, column + 1).setValue(fields[field]);
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
  lock.waitLock(15000);
  try {
    return callback();
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
    const timestamp = now_();
    const definition = SHEETS.settings;

    ["submissionsOpen", "votingOpen", "submissionDeadline", "votingDeadline"].forEach(function(key) {
      const record = findRecord_(definition, "key", key);
      if (record) {
        updateRecord_(record, { value: String(settings[key]), updatedAt: timestamp });
      } else {
        appendRecord_(definition, { key: key, value: String(settings[key]), updatedAt: timestamp });
      }
    });
    return { ok: true, settings: settings };
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
    return { ok: true, submissionRound: nextRound, settings: settings };
  });
}

function getPublicVisions_() {
  const settings = getSettings_();
  const visions = objectRows_(SHEETS.visions)
    .filter(function(record) { return String(record.status).toLowerCase() === "published"; })
    .map(publicVision_);
  return { ok: true, settings: settings, visions: visions };
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
    image: String(record.image || ""),
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
  if (participantHasSubmitted_(participantId, submissionRound)) {
    throw new Error("This participant has already submitted in the current round.");
  }
  const problem = cleanOptionalText_(payload.problem, 800);
  const impact = cleanOptionalText_(payload.impact, 800);
  const beneficiaries = cleanOptionalText_(payload.beneficiaries, 200);
  const tags = cleanOptionalText_(payload.tags, 200);
  const submissionId = newId_();
  const generatedImage = generateVisionImage_(submissionId, team, track, prompt, {
    title: title,
    problem: problem,
    impact: impact,
    beneficiaries: beneficiaries
  });
  return withLock_(function() {
    if (participantHasSubmitted_(participantId, submissionRound)) {
      throw new Error("This participant has already submitted in the current round.");
    }
    const timestamp = now_();
    const submission = {
      id: submissionId,
      createdAt: timestamp,
      updatedAt: timestamp,
      status: "pending",
      team: team,
      title: title,
      track: track,
      prompt: prompt,
      problem: problem,
      impact: impact,
      beneficiaries: beneficiaries,
      tags: tags,
      image: generatedImage.url,
      imageSource: "generated",
      color: /^#[0-9a-f]{6}$/i.test(String(payload.color || "")) ? String(payload.color) : "#D8D0ED",
      height: cleanNumber_(payload.height, 280, 180, 520),
      submittedBy: cleanOptionalText_(payload.submittedBy || "", 120)
    };
    appendRecord_(SHEETS.submissions, submission);
    return { ok: true, status: "pending", submissionId: submission.id, imageSource: submission.imageSource };
  });
}

function participantHasSubmitted_(participantId, submissionRound) {
  return objectRows_(SHEETS.submissions).some(function(record) {
    return String(record.participantId || "") === String(participantId || "") &&
      String(record.submissionRound || "1") === String(submissionRound || "1") &&
      String(record.status || "").toLowerCase() !== "deleted";
  });
}

function generateVisionImage_(submissionId, team, track, prompt, details) {
  details = details || {};
  const apiKey = PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");
  if (!apiKey) throw new Error("Live AI is not configured. Add GEMINI_API_KEY in Apps Script Project Settings.");
  const imagePrompt = [
    "Create one polished editorial concept image for a Saudi Arabia 2050 future vision competition.",
    "Show an optimistic, plausible, human-centered future with strong Saudi environmental and cultural context.",
    "Use a cinematic wide composition, refined architectural or landscape detail, and premium magazine-quality lighting.",
    "Generate exactly ONE single image only. Do not return multiple images, a collage, variations, or any text response beyond the image.",
    "Do not include readable words, letters, logos, interface elements, borders, collages, or labels.",
    "Strategic track: " + track,
    "Track-specific visual direction: " + trackPromptEnhancer_(track),
    "Group name: " + team,
    "Vision title: " + String(details.title || ""),
    "Problem or opportunity: " + String(details.problem || ""),
    "Expected impact: " + String(details.impact || ""),
    "Beneficiaries: " + String(details.beneficiaries || ""),
    "Participant vision: " + prompt
  ].join("\n");
  const response = UrlFetchApp.fetch(GEMINI_INTERACTIONS_URL, {
    method: "post",
    contentType: "application/json",
    headers: { "x-goog-api-key": apiKey, "Api-Revision": "2026-05-20" },
    payload: JSON.stringify({
      model: GEMINI_IMAGE_MODEL,
      input: [{ type: "text", text: imagePrompt }]
    }),
    muteHttpExceptions: true
  });
  const status = response.getResponseCode();
  const raw = response.getContentText();
  if (status < 200 || status >= 300) {
    let detail = "Gemini image generation failed.";
    try { detail = JSON.parse(raw).error.message || detail; } catch (ignored) {}
    throw new Error(detail.slice(0, 240));
  }
  let result;
  try { result = JSON.parse(raw); } catch (error) { throw new Error("Gemini returned an invalid image response."); }
  let imageBlock = result.output_image || result.outputImage || null;
  const blocks = Array.isArray(result.output) ? result.output : (Array.isArray(result.outputs) ? result.outputs : []);
  if (!imageBlock) {
    for (let index = 0; index < blocks.length; index += 1) {
      const block = blocks[index];
      if (block && block.output_image) imageBlock = block.output_image;
      else if (block && block.data && (!block.type || String(block.type).toLowerCase().indexOf("image") !== -1)) imageBlock = block;
      if (imageBlock) break;
    }
  }
  if (!imageBlock || !imageBlock.data) throw new Error("Gemini did not return an image. Try a shorter vision description.");
  const mimeType = imageBlock.mime_type || imageBlock.mimeType || "image/png";
  const blob = Utilities.newBlob(Utilities.base64Decode(imageBlock.data), mimeType, "saudi-vision-" + submissionId + ".png");
  const file = DriveApp.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return { url: "https://drive.google.com/uc?export=view&id=" + file.getId(), mimeType: mimeType };
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
    analytics: getCompetitionAnalytics_(pending, published)
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
        image: String(record.image || ""),
        imageSource: imageSource_(record.imageSource),
        color: String(record.color || "#D8D0ED"),
        height: cleanNumber_(record.height, 280, 180, 520),
        votes: 0
      };
    });
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

    if (nextStatus === "published") {
      const existingVision = findRecord_(SHEETS.visions, "id", submission.id);
      if (existingVision) {
        throw new Error("This submission already has a vision record.");
      }
    }
    const timestamp = now_();
    updateRecord_(submission, { status: nextStatus, updatedAt: timestamp });
    if (nextStatus === "published") {
      appendRecord_(SHEETS.visions, {
        id: submission.id,
        createdAt: submission.createdAt,
        publishedAt: timestamp,
        status: "published",
        team: submission.team,
        title: submission.title,
        track: submission.track,
        prompt: submission.prompt,
        problem: submission.problem,
        impact: submission.impact,
        beneficiaries: submission.beneficiaries,
        tags: submission.tags,
        image: submission.image,
        imageSource: submission.imageSource,
        color: submission.color,
        height: submission.height,
        votes: 0
      });
    }
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
  return withLock_(function() {
    const settings = getSettings_();
    if (!settings.votingOpen || !deadlineIsOpen_(settings.votingDeadline)) {
      throw new Error("Voting is currently closed or past its deadline.");
    }

    const voterId = validVoterId_(payload.voterId);
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
    return { ok: true, action: "vote", visionId: visionId };
  });
}

function unvoteVision_(payload) {
  return withLock_(function() {
    const settings = getSettings_();
    if (!settings.votingOpen) throw new Error("Voting is currently closed.");

    const voterId = validVoterId_(payload.voterId);
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