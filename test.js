// Quick check of Cloudflare credentials: node test.js
// Generates one small image and saves test.jpg/png next to this file.
import fs from "node:fs/promises";
const { CF_ACCOUNT_ID, CF_API_TOKEN } = process.env;
if (!CF_ACCOUNT_ID || !CF_API_TOKEN) {
  console.error("Set CF_ACCOUNT_ID and CF_API_TOKEN first.");
  process.exit(1);
}
const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run/@cf/black-forest-labs/flux-1-schnell`;
const res = await fetch(url, {
  method: "POST",
  headers: { Authorization: `Bearer ${CF_API_TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify({ prompt: "rusty scrap-metal heart icon on plain dark background, game ui icon", steps: 4 }),
});
const json = await res.json();
if (!json.success) { console.error("ERROR:", JSON.stringify(json.errors || json, null, 2)); process.exit(1); }
const buf = Buffer.from(json.result.image, "base64");
const ext = buf[0] === 0x89 ? "png" : "jpg";
await fs.writeFile(`test.${ext}`, buf);
console.log(`OK: saved test.${ext} (${(buf.length/1024).toFixed(0)} KB)`);
