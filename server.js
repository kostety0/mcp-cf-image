#!/usr/bin/env node
// Minimal MCP server: image generation via Cloudflare Workers AI.
// Env: CF_ACCOUNT_ID, CF_API_TOKEN (required), CF_IMAGE_DIR (optional default output dir)

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";

const ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const API_TOKEN = process.env.CF_API_TOKEN;
const DEFAULT_DIR = process.env.CF_IMAGE_DIR || process.cwd();

const MODELS = {
  flux: "@cf/black-forest-labs/flux-1-schnell",
  sdxl: "@cf/stabilityai/stable-diffusion-xl-base-1.0",
  "sdxl-lightning": "@cf/bytedance/stable-diffusion-xl-lightning",
  dreamshaper: "@cf/lykon/dreamshaper-8-lcm",
};

function log(...a) {
  console.error("[mcp-cf-image]", ...a);
}

function sniffExt(buf) {
  if (buf[0] === 0x89 && buf[1] === 0x50) return ".png";
  if (buf[0] === 0xff && buf[1] === 0xd8) return ".jpg";
  if (buf[0] === 0x52 && buf[1] === 0x49) return ".webp";
  return ".png";
}

async function callCloudflare(modelId, body) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/ai/run/${modelId}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const ctype = res.headers.get("content-type") || "";

  if (ctype.includes("application/json")) {
    const json = await res.json();
    if (!res.ok || json.success === false) {
      const msg = (json.errors || []).map((e) => `${e.code}: ${e.message}`).join("; ");
      throw new Error(`Cloudflare API error (${res.status}): ${msg || JSON.stringify(json)}`);
    }
    const b64 = json.result?.image;
    if (!b64) throw new Error("No image in response: " + JSON.stringify(json).slice(0, 300));
    return Buffer.from(b64, "base64");
  }

  // Binary response (SDXL-family models return raw bytes)
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Cloudflare API error (${res.status}): ${txt.slice(0, 300)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

const server = new McpServer({ name: "mcp-cf-image", version: "1.0.0" });

server.registerTool(
  "generate_image",
  {
    title: "Generate image (Cloudflare Workers AI)",
    description:
      "Generate one or more images from a text prompt using Cloudflare Workers AI and save them to disk. " +
      "Models: flux (FLUX.1 Schnell, default, best prompt understanding, no negative prompt, no seed, fixed 1024x1024), " +
      "sdxl (Stable Diffusion XL, supports negative_prompt/width/height), sdxl-lightning, dreamshaper. " +
      "Returns saved file paths, seeds used, and the image(s) for preview.",
    inputSchema: {
      prompt: z.string().min(1).max(2048).describe("Text description of the image"),
      output_path: z
        .string()
        .describe(
          "Where to save. Absolute or relative to CF_IMAGE_DIR. Use forward slashes. " +
            "If variations > 1, a numeric suffix is appended before the extension."
        ),
      model: z.enum(["flux", "sdxl", "sdxl-lightning", "dreamshaper"]).default("flux"),
      seed: z.number().int().min(0).optional().describe("Seed for reproducibility (SDXL models only; ignored for flux). Random if omitted."),
      variations: z.number().int().min(1).max(4).default(1).describe("How many images (seed, seed+1, ...)"),
      steps: z.number().int().min(1).max(20).optional().describe("flux: 1-8 (default 4). sdxl: up to 20."),
      negative_prompt: z.string().optional().describe("SDXL models only. Ignored for flux."),
      width: z.number().int().min(256).max(2048).optional().describe("SDXL models only."),
      height: z.number().int().min(256).max(2048).optional().describe("SDXL models only."),
      return_preview: z.boolean().default(true).describe("Include image data in the response for viewing."),
    },
  },
  async (args) => {
    if (!ACCOUNT_ID || !API_TOKEN) {
      return {
        isError: true,
        content: [{ type: "text", text: "CF_ACCOUNT_ID and CF_API_TOKEN environment variables must be set." }],
      };
    }

    const modelId = MODELS[args.model];
    const isFlux = args.model === "flux";
    const baseSeed = args.seed ?? Math.floor(Math.random() * 2_000_000_000);

    const outAbs = path.isAbsolute(args.output_path)
      ? args.output_path
      : path.join(DEFAULT_DIR, args.output_path);
    await fs.mkdir(path.dirname(outAbs), { recursive: true });

    const content = [];
    const summary = [];

    for (let i = 0; i < args.variations; i++) {
      const seed = baseSeed + i;
      // NOTE: flux-1-schnell on Cloudflare rejects "seed" (schema error 5006), so it is only sent to SDXL models.
      const body = { prompt: args.prompt };
      if (isFlux) {
        if (args.steps) body.steps = Math.min(args.steps, 8);
      } else {
        body.seed = seed;
        if (args.steps) body.num_steps = args.steps;
        if (args.negative_prompt) body.negative_prompt = args.negative_prompt;
        if (args.width) body.width = args.width;
        if (args.height) body.height = args.height;
      }

      let buf;
      try {
        buf = await callCloudflare(modelId, body);
      } catch (e) {
        return { isError: true, content: [{ type: "text", text: `Generation failed (seed ${seed}): ${e.message}` }] };
      }

      const ext = sniffExt(buf);
      const parsed = path.parse(outAbs);
      const suffix = args.variations > 1 ? `_${String(i + 1).padStart(2, "0")}` : "";
      const finalPath = path.join(parsed.dir, `${parsed.name}${suffix}${ext}`);
      await fs.writeFile(finalPath, buf);
      log("saved", finalPath, "seed", seed, buf.length, "bytes");

      summary.push(`${finalPath}  (${isFlux ? "seed not supported by flux" : "seed " + seed}, model ${args.model}, ${(buf.length / 1024).toFixed(0)} KB)`);
      if (args.return_preview) {
        content.push({
          type: "image",
          data: buf.toString("base64"),
          mimeType: ext === ".jpg" ? "image/jpeg" : ext === ".webp" ? "image/webp" : "image/png",
        });
      }
    }

    content.unshift({ type: "text", text: "Saved:\n" + summary.join("\n") });
    return { content };
  }
);

server.registerTool(
  "list_models",
  { title: "List available models", description: "List model aliases supported by this server.", inputSchema: {} },
  async () => ({
    content: [
      {
        type: "text",
        text: Object.entries(MODELS)
          .map(([k, v]) => `${k} -> ${v}`)
          .join("\n"),
      },
    ],
  })
);

const transport = new StdioServerTransport();
await server.connect(transport);
log(`running on stdio. account=${ACCOUNT_ID ? "set" : "MISSING"} token=${API_TOKEN ? "set" : "MISSING"} dir=${DEFAULT_DIR}`);
