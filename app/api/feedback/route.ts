import { TwelveLabs } from "twelvelabs-js";
import crypto from "crypto";
import { NextResponse } from "next/server";
import { isAiCallsDisabled } from "../../lib/aiConfig";

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

const PLACEHOLDER_FEEDBACK = {
  confidence_score: 7,
  visual_feedback:
    "Your gaze drifts off-camera at times; aim to keep steadier eye contact.",
};

const FEEDBACK_PROMPT = `You are analyzing a candidate's interview performance from video (and audio).

Evaluate the candidate's delivery, confidence, and communication:

1) Confidence & Delivery
- Consider eye contact, hand movement, posture, and other visible cues.
- Score from 0 to 10 (NO DECIMALS) where a 10 means very confident and clear with NO ISSUES, and a 0 means very nervous and unclear.
- Provide exactly ONE concise feedback point about visible cues only (gaze, hands, posture).

Return ONLY a JSON object in this format:

{
  "confidence_score": integer,
  "visual_feedback": "string"
}

Strict rules:
- Output must be valid JSON with double quotes.
- Do not wrap in code fences.
- Do not add any extra text before or after the JSON.`;

export async function POST(request: Request) {
  try {
    if (isAiCallsDisabled()) {
      console.info(
        "Cadence: AI calls disabled; returning placeholder feedback.",
      );
      return NextResponse.json({
        feedback: PLACEHOLDER_FEEDBACK,
        raw: "placeholder",
      });
    }

    if (FEEDBACK_MODE !== "12labs") {
      return NextResponse.json(
        { error: "Feedback mode is disabled. Set FEEDBACK_MODE=12labs." },
        { status: 503 },
      );
    }

    const apiKey = process.env["TWELVE_LABS_API_KEY"];
    if (!apiKey) {
      return NextResponse.json(
        { error: "Missing TWELVE_LABS_API_KEY in the environment." },
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
      file,
      filename: file.name || "upload.webm",
    });

    if (!asset.id) {
      return NextResponse.json(
        { error: "Upload succeeded but no asset id returned." },
        { status: 502 },
      );
    }

    const indexedAsset = await client.indexes.indexedAssets.create(indexId, {
      assetId: asset.id,
    });

    if (!indexedAsset.id) {
      return NextResponse.json(
        { error: "Failed to create indexed asset." },
        { status: 502 },
      );
    }
    const indexedAssetId = indexedAsset.id;

    let indexedAssetStatus: string | undefined;
    for (let attempt = 0; attempt < INDEX_POLL_LIMIT; attempt += 1) {
      const polledAsset = await client.indexes.indexedAssets.retrieve(
        indexId,
        indexedAssetId,
      );
      indexedAssetStatus = polledAsset.status;
      if (indexedAssetStatus === "ready") {
        break;
      }
      if (indexedAssetStatus === "failed") {
        return NextResponse.json(
          { error: "Indexing failed." },
          { status: 502 },
        );
      }
      await new Promise((resolve) =>
        setTimeout(resolve, INDEX_POLL_INTERVAL_MS),
      );
    }

    if (indexedAssetStatus !== "ready") {
      return NextResponse.json(
        { error: "Indexing timed out." },
        { status: 504 },
      );
    }

    const textStream = await client.analyzeStream({
      videoId: indexedAssetId,
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
  }
}
