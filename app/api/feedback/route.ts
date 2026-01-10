import { TwelveLabs } from "twelvelabs-js";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { NextResponse } from "next/server";

const FEEDBACK_MODE = process.env.FEEDBACK_MODE ?? "12labs";
const MAX_UPLOAD_MB = Number(process.env.TWELVELABS_MAX_UPLOAD_MB ?? "20");
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;
const INDEX_NAME = process.env.TWELVELABS_INDEX_NAME ?? "interview-feedback";
const INDEX_ID = process.env.TWELVELABS_INDEX_ID;
const INDEX_POLL_INTERVAL_MS = Number(
  process.env.TWELVELABS_INDEX_POLL_INTERVAL_MS ?? "4000",
);
const INDEX_POLL_LIMIT = Number(
  process.env.TWELVELABS_INDEX_POLL_LIMIT ?? "45",
);

const FEEDBACK_PROMPT = `You are analyzing a candidate's interview performance from video (and audio).

Evaluate the candidate's delivery, confidence, and communication:

1) Confidence & Delivery
- Consider eye contact, nervous behaviors, pacing, and filler words (e.g., "um", "uh", "like").
- Score from 0 to 10 (NO DECIMALS)
- Provide exactly TWO concise feedback points mentioning nervous behaviors and clarity of speech.

Return ONLY a JSON object in this format:

{
  "confidence_score": integer,
  "confidence_feedback": [
    "string",
    "string"
  ]
}

Strict rules:
- Output must be valid JSON with double quotes.
- Do not wrap in code fences.
- Do not add any extra text before or after the JSON.`;

export async function POST(request: Request) {
  let filePath: string | null = null;

  try {
    if (FEEDBACK_MODE !== "12labs") {
      return NextResponse.json(
        { error: "Feedback mode is disabled. Set FEEDBACK_MODE=12labs." },
        { status: 503 },
      );
    }

    const apiKey = process.env["12LABS_API_KEY"];
    if (!apiKey) {
      return NextResponse.json(
        { error: "Missing 12LABS_API_KEY in the environment." },
        { status: 500 },
      );
    }

    const client = new TwelveLabs({ apiKey });
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "No video file received for feedback." },
        { status: 400 },
      );
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        {
          error: `Video is too large (${Math.ceil(
            file.size / 1024 / 1024,
          )}MB). Max allowed is ${MAX_UPLOAD_MB}MB. Shorten the clip or lower quality.`,
        },
        { status: 413 },
      );
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    filePath = path.join(process.cwd(), `${crypto.randomUUID()}.webm`);
    fs.writeFileSync(filePath, buffer);

    let indexId = INDEX_ID;
    if (!indexId) {
      const index = await client.indexes.create({
        indexName: `${INDEX_NAME}-${crypto.randomUUID()}`,
        models: [{ modelName: "pegasus1.2", modelOptions: ["visual", "audio"] }],
      });
      if (!index.id) {
        return NextResponse.json(
          { error: "Failed to create an index." },
          { status: 502 },
        );
      }
      indexId = index.id;
    }

    const asset = await client.assets.create({
      method: "direct",
      file: fs.createReadStream(filePath),
    });

    if (!asset.id) {
      return NextResponse.json(
        { error: "Upload succeeded but no asset id returned." },
        { status: 502 },
      );
    }

    let indexedAsset = await client.indexes.indexedAssets.create(indexId, {
      assetId: asset.id,
    });

    if (!indexedAsset.id) {
      return NextResponse.json(
        { error: "Failed to create indexed asset." },
        { status: 502 },
      );
    }

    for (let attempt = 0; attempt < INDEX_POLL_LIMIT; attempt += 1) {
      indexedAsset = await client.indexes.indexedAssets.retrieve(
        indexId,
        indexedAsset.id,
      );
      if (indexedAsset.status === "ready") {
        break;
      }
      if (indexedAsset.status === "failed") {
        return NextResponse.json(
          { error: "Indexing failed." },
          { status: 502 },
        );
      }
      await new Promise((resolve) =>
        setTimeout(resolve, INDEX_POLL_INTERVAL_MS),
      );
    }

    if (indexedAsset.status !== "ready") {
      return NextResponse.json(
        { error: "Indexing timed out." },
        { status: 504 },
      );
    }

    const textStream = await client.analyzeStream({
      videoId: indexedAsset.id,
      prompt: FEEDBACK_PROMPT,
    });

    let feedbackText = "";
    for await (const chunk of textStream) {
      if ("text" in chunk) {
        feedbackText += chunk.text;
      }
    }

    const trimmed = feedbackText.trim();
    const extractJsonBlock = (text: string) => {
      const start = text.indexOf("{");
      const end = text.lastIndexOf("}");
      if (start >= 0 && end > start) {
        return text.slice(start, end + 1);
      }
      return "";
    };

    let parsed: unknown = null;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      const extracted = extractJsonBlock(trimmed);
      if (extracted) {
        try {
          parsed = JSON.parse(extracted);
        } catch {
          parsed = null;
        }
      }
    }

    if (!parsed || typeof parsed !== "object") {
      console.error("12Labs response was not valid JSON:", feedbackText);
      return NextResponse.json(
        { error: "12Labs response was not valid JSON.", raw: feedbackText },
        { status: 502 },
      );
    }

    return NextResponse.json({ feedback: parsed, raw: feedbackText });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Feedback request failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
}
