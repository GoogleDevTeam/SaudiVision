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
      Do not put ADMIN_KEY in index.html. The browser asks for it only when
      an organizer action is used, then sends it over the deployed HTTPS URL.
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

  This backend intentionally does not call an image-generation service yet.
  The frontend stores a demo preview URL today. A real Gemini/image service
  should be called here, server-side, after its secret is stored in Script
  Properties—not from the static frontend.

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
    headers: ["id", "createdAt", "publishedAt", "status", "team", "track", "prompt", "image", "color", "height", "votes", "imageSource"]
  },
  submissions: {
    name: "Submissions",
    headers: ["id", "createdAt", "updatedAt", "status", "team", "track", "prompt", "image", "color", "height", "submittedBy", "imageSource"]
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
const WORKBOOK_FORMAT_VERSION = "2026-09-18-v4";
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
  submittedBy: "Optional participant or identity reference.",
  key: "Settings key. Supported keys are submissionsOpen and votingOpen.",
  value: "Setting value. Boolean settings are stored as true or false.",
  votedAt: "When the active vote was created.",
  active: "Whether this vote is currently active.",
  unvotedAt: "When a voter removed their vote."
};

const DEFAULT_SETTINGS = {
  submissionsOpen: true,
  votingOpen: true
};

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
      return { ok: true, service: "Imagine Saudi 2050", status: "ready" };
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
    guide.getLastRow() < 65;
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
    ["imageSource", "Visions / Submissions", "demo-preview, generated, uploaded, or curated.", "Keep demo previews labeled until real AI is connected."],
    ["", "", "", ""],
    ["SHEET MAP", "", "", ""],
    ["Sheet", "What it stores", "Important fields", "Organizer guidance"],
    ["Visions", "Published gallery concepts and live vote counts.", "status, team, prompt, image, votes", "Public data source. Do not manually publish pending records here."],
    ["Submissions", "All participant submissions and moderation history.", "status, team, prompt, imageSource", "Primary review queue. New records are always pending."],
    ["Settings", "Competition switches and update timestamps.", "submissionsOpen, votingOpen", "Keep one row per supported setting."],
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
  [4, 11, 21, 30, 38, 44, 66].forEach(function(row) {
    sheet.getRange(row, 1, 1, 4).merge();
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
  if (lastRow > 1) bodyRange.applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY);
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
  const spreadsheet = initializeSheets_();
  return spreadsheet.getSheetByName(definition.name);
}

function rows_(sheet) {
  if (sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
}

function objectRows_(definition) {
  const sheet = getSheet_(definition);
  const headers = definition.headers;
  return rows_(sheet).map(function(row, index) {
    const record = { _row: index + 2, _sheet: sheet };
    headers.forEach(function(header, column) {
      record[header] = row[column];
    });
    return record;
  });
}

function appendRecord_(definition, record) {
  const sheet = getSheet_(definition);
  const values = definition.headers.map(function(header) {
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
  return fallback;
}

function getSettings_() {
  const settings = Object.assign({}, DEFAULT_SETTINGS);
  objectRows_(SHEETS.settings).forEach(function(record) {
    if (record.key === "submissionsOpen") settings.submissionsOpen = parseBoolean_(record.value, settings.submissionsOpen);
    if (record.key === "votingOpen") settings.votingOpen = parseBoolean_(record.value, settings.votingOpen);
  });
  return settings;
}

function saveSettings_(payload) {
  return withLock_(function() {
    const settings = getSettings_();
    settings.submissionsOpen = parseBoolean_(payload.submissionsOpen, settings.submissionsOpen);
    settings.votingOpen = parseBoolean_(payload.votingOpen, settings.votingOpen);
    const timestamp = now_();
    const definition = SHEETS.settings;

    ["submissionsOpen", "votingOpen"].forEach(function(key) {
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
    track: String(record.track || ""),
    prompt: String(record.prompt || ""),
    image: String(record.image || ""),
    imageSource: imageSource_(record.imageSource),
    color: String(record.color || "#D8D0ED"),
    height: cleanNumber_(record.height, 280, 180, 520),
    votes: Number(record.votes) || 0
  };
}

function submitVision_(payload) {
  return withLock_(function() {
    const settings = getSettings_();
    if (!settings.submissionsOpen) throw new Error("Submissions are currently closed.");

    const timestamp = now_();
    const submission = {
      id: newId_(),
      createdAt: timestamp,
      updatedAt: timestamp,
      status: "pending",
      team: cleanText_(payload.team, 100, "Group name"),
      track: cleanText_(payload.track, 80, "Track"),
      prompt: cleanText_(payload.prompt, 2000, "Vision description"),
      image: cleanOptionalText_(payload.image, 2000),
      imageSource: imageSource_(payload.imageSource),
      color: /^#[0-9a-f]{6}$/i.test(String(payload.color || "")) ? String(payload.color) : "#D8D0ED",
      height: cleanNumber_(payload.height, 280, 180, 520),
      submittedBy: cleanOptionalText_(payload.submittedBy || "", 120)
    };
    appendRecord_(SHEETS.submissions, submission);
    return { ok: true, status: "pending", submissionId: submission.id };
  });
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
        track: String(record.track || ""),
        prompt: String(record.prompt || ""),
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
    const submission = findRecord_(SHEETS.submissions, "id", submissionId);
    if (!submission) throw new Error("Submission not found.");
    if (String(submission.status).toLowerCase() !== "pending") {
      throw new Error("Only pending submissions can be moderated.");
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
        track: submission.track,
        prompt: submission.prompt,
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
    const submission = findRecord_(SHEETS.submissions, "id", visionId);
    if (submission && String(submission.status).toLowerCase() === "published") {
      updateRecord_(submission, { status: "deleted", updatedAt: timestamp });
    }
    return { ok: true, status: "deleted", visionId: String(visionId) };
  });
}

function validVoterId_(value) {
  const voterId = cleanText_(value, 200, "Voter ID");
  if (!/^[a-zA-Z0-9._:-]+$/.test(voterId)) throw new Error("Invalid voter ID.");
  return voterId;
}

function voteForVision_(payload) {
  return withLock_(function() {
    const settings = getSettings_();
    if (!settings.votingOpen) throw new Error("Voting is currently closed.");

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
  const expected = PropertiesService.getScriptProperties().getProperty("ADMIN_KEY");
  const provided = String(payload.adminKey || "");
  if (!expected) throw new Error("ADMIN_KEY is not configured in Script Properties.");
  if (!constantTimeEquals_(provided, expected)) throw new Error("Unauthorized: invalid organizer key.");
}