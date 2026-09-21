import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";

const html = fs.readFileSync("index.html", "utf8");
const backend = fs.readFileSync("google-apps-script.gs", "utf8");
const security = fs.readFileSync("security-tests.mjs", "utf8");
const scriptMatch = html.match(/<script>([\s\S]*)<\/script>\s*<\/body>/i);
assert.ok(scriptMatch, "frontend inline script must be present");
new Function(scriptMatch[1]);
new Function(backend);

assert.match(backend, /case "vote":\s*return voteForVision_\(payload\);/);
assert.match(backend, /case "unvote":\s*return unvoteVision_\(payload\);/);
assert.match(backend, /case "voteStatus":\s*return getVoteStatus_\(payload\);/);
assert.match(backend, /This voter already has an active vote/);
assert.match(backend, /requestedSubmissionId/);
assert.match(backend, /participantHasSubmitted_\(participantId, submissionRound\)/);
assert.match(html, /googleRequest\("submit", newVision/);
assert.match(html, /waitForSubmissionStatus\(submissionId\)/);
assert.match(html, /function safeLocalGet/);
assert.match(html, /function safeLocalSet/);
assert.match(html, /function safeLocalRemove/);
assert.doesNotMatch(html, /(?<!window\.)localStorage\.(getItem|setItem|removeItem)/);
assert.match(html, /allowDemoSvg/);
assert.doesNotMatch(html, /\son[a-z]+\s*=/i);
assert.match(security, /Security regression tests passed/);

const helperStart = html.indexOf("function applyRemoteVoteStatus");
const helperEnd = html.indexOf("function safeImageHeight", helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, "vote status helper must be present");
const helperCode = html.slice(helperStart, helperEnd);
function storage(initial) {
  let value = initial;
  return {
    getItem: () => value,
    setItem: (_key, next) => { value = String(next); },
    removeItem: () => { value = null; },
    value: () => value
  };
}
function applyVoteState(initial, response, visions) {
  const local = storage(initial);
  const apply = new Function("localStorage", "visionKey", "safeLocalGet", "safeLocalSet", "safeLocalRemove", helperCode + " return applyRemoteVoteStatus;")(local, vision => String(vision.id || vision.team || ""), key => local.getItem(key), (key, value) => local.setItem(key, value), key => local.removeItem(key));
  return { changed: apply(response, visions), value: local.value() };
}
assert.deepEqual(applyVoteState(null, { ok: true, status: "voted", voted: true, visionId: "vision-1" }, [{ id: "vision-1" }]), { changed: true, value: "vision-1" });
assert.deepEqual(applyVoteState("vision-1", { ok: true, status: "not_voted", voted: false, visionId: "" }, [{ id: "vision-1" }]), { changed: true, value: null });
assert.deepEqual(applyVoteState("vision-1", null, [{ id: "vision-1" }]), { changed: false, value: "vision-1" });

const storageStart = html.indexOf("function safeLocalGet");
const storageEnd = html.indexOf("const settings =", storageStart);
assert.ok(storageStart >= 0 && storageEnd > storageStart, "safe local storage helpers must be present");
const storageCode = html.slice(storageStart, storageEnd);
const throwingStorage = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } };
const safeStorage = new Function("window", storageCode + " return { get: safeLocalGet, set: safeLocalSet, remove: safeLocalRemove };")({ localStorage: throwingStorage });
assert.equal(safeStorage.get("blocked-key", "fallback"), "fallback");
assert.equal(safeStorage.set("blocked-key", "value"), false);
assert.equal(safeStorage.remove("blocked-key"), false);

const imageStart = html.indexOf("function safeImageUrl");
const imageEnd = html.indexOf("function bindGalleryInteractions", imageStart);
assert.ok(imageStart >= 0 && imageEnd > imageStart, "safe image helper must be present");
const imageCode = html.slice(imageStart, imageEnd);
const safeImage = new Function("placeholderImage", "window", "URL", imageCode + " return safeImageUrl;")("placeholder", { location: { href: "https://example.test/" } }, URL);
const demoSvg = "data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3C%2Fsvg%3E";
assert.equal(safeImage(demoSvg, { allowDemoSvg: true }), demoSvg);
assert.equal(safeImage(demoSvg, { allowDemoSvg: false }), "placeholder");
assert.equal(safeImage("data:image/svg+xml;charset=UTF-8,%3Cscript%3Ealert(1)%3C%2Fscript%3E", { allowDemoSvg: true }), "placeholder");

const liveUrl = process.env.SAUDI_VISION_API_URL;
if (liveUrl) {
  const get = async action => {
    const response = await fetch(liveUrl + "?action=" + encodeURIComponent(action), { cache: "no-store" });
    assert.equal(response.status, 200, action + " should return HTTP 200");
    return response.json();
  };
  const post = async body => {
    const response = await fetch(liveUrl, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(body), cache: "no-store" });
    assert.equal(response.status, 200, "POST should return HTTP 200");
    return response.json();
  };
  const health = await get("health");
  assert.equal(health.ok, true);
  const visions = await get("visions");
  assert.equal(visions.ok, true);
  assert.ok(Array.isArray(visions.visions));
  const voterId = "workflow-audit-" + crypto.randomUUID();
  const status = await post({ action: "voteStatus", voterId });
  assert.equal(status.ok, true);
  assert.equal(status.status, "not_voted");
  const invalidVote = await post({ action: "vote", voterId, visionId: "workflow-nonexistent-vision" });
  assert.equal(invalidVote.ok, false);
  assert.match(invalidVote.error, /not available for voting/i);
  console.log("Live read-only API smoke checks passed.");
} else {
  console.log("Live API smoke checks skipped; set SAUDI_VISION_API_URL to enable them.");
}

console.log("Vote and submission workflow tests passed.");
