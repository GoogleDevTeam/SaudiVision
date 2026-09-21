import assert from "node:assert/strict";
import fs from "node:fs";

const backend = fs.readFileSync("google-apps-script.gs", "utf8");
const sourceMatch = backend.match(/const SOURCE_REVISION = "([^"\n]+)"/);
assert.ok(sourceMatch, "google-apps-script.gs must declare SOURCE_REVISION");
const sourceRevision = sourceMatch[1];
const liveUrl = process.env.SAUDI_VISION_API_URL || "";
if (!liveUrl) console.log("Deployment parity check skipped; set SAUDI_VISION_API_URL to enable it.");
else {
  const url = new URL(liveUrl);
  url.searchParams.set("action", "version");
  const response = await fetch(url, { cache: "no-store" });
  assert.equal(response.status, 200, "live version endpoint should return HTTP 200");
  const body = await response.json();
  assert.equal(body.ok, true, body.error || "live version endpoint should be healthy");
  assert.equal(body.sourceRevision, sourceRevision, "Apps Script revision must match the GitHub source marker");
  console.log("Deployment parity check passed: " + sourceRevision);
}