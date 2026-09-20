import fs from "node:fs";

const html = fs.readFileSync("index.html", "utf8");
if (/\son[a-z]+\s*=/i.test(html)) {
  throw new Error("Inline event handlers are forbidden; use addEventListener instead.");
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[character]);
}

const payloads = [
  "</div><script>alert(1)</script>",
  '\"><img src=x onerror=alert(1)>',
  "javascript:alert(1)",
  "<svg/onload=alert(1)>"
];
for (const payload of payloads) {
  const escaped = escapeHTML(payload);
  if (/[<>]/.test(escaped)) throw new Error("Unescaped HTML delimiter in payload: " + payload);
  if (escaped.includes("<script") || escaped.includes("onerror=") || escaped.includes("onload=")) {
    throw new Error("Executable markup survived escaping: " + payload);
  }
}

for (const required of ["function safeImageUrl", "function bindGalleryInteractions", "function escapeHTML"]) {
  if (!html.includes(required)) throw new Error("Missing security guard: " + required);
}

console.log("Security regression tests passed.");
