import assert from "node:assert/strict";
import crypto from "node:crypto";

const LIVE_URL = process.env.SAUDI_VISION_API_URL || "";
const ADMIN_KEY = process.env.SAUDI_VISION_ADMIN_KEY || "";

function generatedMetadata() {
  return { image: "https://drive.google.com/thumbnail?id=fixture-generated-image", imageSource: "generated", generationStatus: "generated", imageMimeType: "image/png", driveFileId: "fixture-generated-drive-file", generationAttempts: 1 };
}

function createFixtureBackend() {
  const submissions = new Map();
  const visions = new Map();
  return {
    async post(payload) {
      if (payload.action === "submit") {
        const record = { id: payload.submissionId, status: "pending", team: payload.team, title: payload.title, track: payload.track, prompt: payload.prompt, image: "", imageSource: "awaiting-approval", generationStatus: "awaiting_approval" };
        submissions.set(record.id, record);
        return { ok: true, status: "pending", submissionId: record.id };
      }
      if (payload.action === "organizerAuth") return { ok: payload.adminKey === "fixture-admin-key", authenticated: payload.adminKey === "fixture-admin-key" };
      if (payload.action === "publish") {
        assert.equal(payload.adminKey, "fixture-admin-key");
        const submission = submissions.get(payload.visionId);
        assert.ok(submission, "fixture submission must exist before approval");
        const vision = { ...submission, ...generatedMetadata(), status: "published", votes: 0 };
        Object.assign(submission, vision);
        visions.set(vision.id, vision);
        return { ok: true, status: "published", submissionId: vision.id, imageSource: "generated" };
      }
      throw new Error("Unsupported fixture action: " + payload.action);
    },
    async get(action) {
      if (action === "visions") return { ok: true, visions: [...visions.values()] };
      throw new Error("Unsupported fixture read: " + action);
    }
  };
}

async function runFixtureIntegration() {
  const fixture = createFixtureBackend();
  const submissionId = "fixture-" + crypto.randomUUID();
  const submitted = await fixture.post({ action: "submit", submissionId, participantId: "fixture-participant-" + crypto.randomUUID(), team: "CI integration team", title: "Water-aware neighborhoods", track: "Water & Oceans", prompt: "A connected neighborhood that reuses water and protects coastal ecosystems.", problem: "Water resilience", impact: "Lower waste and stronger communities" });
  assert.equal(submitted.ok, true);
  assert.equal(submitted.status, "pending");
  const auth = await fixture.post({ action: "organizerAuth", adminKey: "fixture-admin-key" });
  assert.equal(auth.authenticated, true);
  const published = await fixture.post({ action: "publish", adminKey: "fixture-admin-key", visionId: submissionId });
  assert.equal(published.status, "published");
  const gallery = await fixture.get("visions");
  const vision = gallery.visions.find(item => item.id === submissionId);
  assert.ok(vision, "approved submission must reach the public gallery");
  for (const field of ["image", "imageSource", "generationStatus", "imageMimeType", "driveFileId", "generationAttempts"]) assert.ok(vision[field], "published gallery record must include " + field);
  assert.equal(vision.imageSource, "generated");
  assert.equal(vision.generationStatus, "generated");
  console.log("Fixture submission -> approval -> public-gallery integration passed.");
}

async function requestLive(method, action, body) {
  const url = new URL(LIVE_URL);
  if (method === "GET") url.searchParams.set("action", action);
  const response = await fetch(url, { method, headers: method === "POST" ? { "Content-Type": "text/plain;charset=utf-8" } : undefined, body: method === "POST" ? JSON.stringify({ action, ...body }) : undefined, cache: "no-store" });
  assert.equal(response.status, 200, action + " should return HTTP 200");
  return response.json();
}

async function runLiveIntegration() {
  const suffix = crypto.randomUUID();
  const submissionId = "ci-live-" + suffix;
  const participantId = "ci-live-participant-" + suffix;
  let published = false;
  try {
    const submitted = await requestLive("POST", "submit", { submissionId, participantId, team: "CI authenticated publish test", title: "Live metadata verification", track: "Digital Society & Governance", prompt: "A small synthetic test concept used only to verify generated image metadata reaches the public gallery.", problem: "Deployment verification", impact: "Confirms the approval path preserves generated image metadata", beneficiaries: "Release maintainers", tags: "ci,verification" });
    assert.equal(submitted.ok, true, submitted.error || "submit should succeed");
    assert.equal(submitted.status, "pending", submitted.error || "submission should be pending");
    assert.equal(submitted.submissionId, submissionId);
    const approved = await requestLive("POST", "publish", { adminKey: ADMIN_KEY, visionId: submissionId });
    assert.equal(approved.ok, true, approved.error || "publish should succeed");
    assert.equal(approved.status, "published", approved.error || "submission should be published");
    published = true;
    const gallery = await requestLive("GET", "visions");
    const vision = (gallery.visions || []).find(item => String(item.id) === submissionId);
    assert.ok(vision, "published test submission must appear in the public gallery");
    for (const field of ["image", "imageSource", "generationStatus", "imageMimeType", "driveFileId", "generationAttempts"]) assert.ok(vision[field], "live public record must include " + field);
    assert.equal(vision.imageSource, "generated");
    assert.equal(vision.generationStatus, "generated");
    console.log("Live authenticated submission -> approval -> public-gallery integration passed.");
  } finally {
    if (published) {
      const deleted = await requestLive("POST", "deletePublished", { adminKey: ADMIN_KEY, visionId: submissionId });
      assert.equal(deleted.ok, true, "live integration cleanup should delete the synthetic published record");
      console.log("Live integration test record deleted after verification.");
    }
  }
}

await runFixtureIntegration();
if (LIVE_URL && ADMIN_KEY) await runLiveIntegration();
else console.log("Live authenticated publish test skipped; set SAUDI_VISION_API_URL and SAUDI_VISION_ADMIN_KEY in CI to enable it.");