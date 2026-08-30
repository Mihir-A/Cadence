import { TwelveLabs } from "twelvelabs-js";
import { NextResponse } from "next/server";
import { isAiCallsDisabled } from "../../lib/aiConfig";

const FEEDBACK_MODE = process.env.FEEDBACK_MODE ?? "12labs";
const MAX_UPLOAD_MB = Number(process.env.TWELVELABS_MAX_UPLOAD_MB ?? "20");
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;
const ASSET_POLL_INTERVAL_MS = Number(
  process.env.TWELVELABS_ASSET_POLL_INTERVAL_MS ?? "2000",
);
const FEEDBACK_TIMEOUT_MS = Number(
  process.env.TWELVELABS_FEEDBACK_TIMEOUT_MS ?? "120000",
);
const ASSET_POLL_LIMIT = Math.max(
  1,
  Math.ceil(FEEDBACK_TIMEOUT_MS / ASSET_POLL_INTERVAL_MS),
);
const REQUEST_TIMEOUT_SECONDS = Math.max(
  1,
  Math.ceil(FEEDBACK_TIMEOUT_MS / 1000),
);

const PLACEHOLDER_FEEDBACK = {
  confidence_score: 7,
  visual_feedback:
    "Your gaze drifts off-camera at times; aim to keep steadier eye contact.",
};

const FEEDBACK_PROMPT = `You are a strict evaluator of interview delivery from video.

Focus ONLY on visible cues:
- Eye contact / gaze direction
- Facial engagement / expressiveness
- Posture / head stability
- Hand movement / fidgeting

Do not judge technical correctness or content quality.
Do not infer facts that are not visible.
Evaluate the ENTIRE clip, not just its best moments.

Gaze-away severity:
- none: Camera-facing gaze is sustained; only momentary natural eye motion.
- minor: One or two momentary glances occupy less than about 5% of the clip.
- moderate: Deliberate, repeated, or prolonged side/down/up gaze occupies about 5-30% of the clip.
- major: Gaze is away for over 30% of the clip, or the face is repeatedly turned away.
- Looking at the screen instead of the camera lens counts as gaze-away.
- If your feedback recommends steadier eye contact, severity cannot be "none".

Component scoring rules (0-10 integers):
- Eye contact: Sustained camera-facing gaze. Repeated gaze-away must score 5 or lower.
- Facial engagement: Attentive, appropriately expressive face.
- Posture: Upright, stable head and body position.
- Movement control: No distracting touching, fidgeting, or excessive motion.
- If a cue cannot be observed, score that component 5 rather than assuming confidence.

Feedback rules:
- Provide exactly ONE concise, actionable feedback sentence.
- Keep it under 20 words.
- Reference only what is visible on screen.
- If visibility is limited, say what cannot be observed.

Return ONLY valid JSON with this exact schema and no extra keys:
{
  "gaze_away_severity": "none" | "minor" | "moderate" | "major",
  "eye_contact_score": integer,
  "facial_engagement_score": integer,
  "posture_score": integer,
  "movement_control_score": integer,
  "visual_feedback": "string"
}

Hard constraints:
- Output JSON only (no prose, no code fences).
- Use double quotes.`;

const FEEDBACK_JSON_SCHEMA = {
  type: "object",
  properties: {
    gaze_away_severity: {
      type: "string",
      enum: ["none", "minor", "moderate", "major"],
    },
    eye_contact_score: {
      type: "integer",
      minimum: 0,
      maximum: 10,
    },
    facial_engagement_score: {
      type: "integer",
      minimum: 0,
      maximum: 10,
    },
    posture_score: {
      type: "integer",
      minimum: 0,
      maximum: 10,
    },
    movement_control_score: {
      type: "integer",
      minimum: 0,
      maximum: 10,
    },
    visual_feedback: {
      type: "string",
    },
  },
  required: [
    "gaze_away_severity",
    "eye_contact_score",
    "facial_engagement_score",
    "posture_score",
    "movement_control_score",
    "visual_feedback",
  ],
};

const GAZE_SCORE_CAPS = {
  none: 10,
  minor: 6,
  moderate: 5,
  major: 3,
} as const;

const EYE_CONTACT_SCORE_CAPS = {
  none: 10,
  minor: 6,
  moderate: 4,
  major: 2,
} as const;

const clampComponentScore = (value: unknown) =>
  typeof value === "number"
    ? Math.max(0, Math.min(10, Math.round(value)))
    : null;

const waitForPoll = (delayMs: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      signal.removeEventListener("abort", handleAbort);
      resolve();
    }, delayMs);
    const handleAbort = () => {
      clearTimeout(timeoutId);
      reject(new DOMException("The operation was aborted.", "AbortError"));
    };
    signal.addEventListener("abort", handleAbort, { once: true });
  });

export async function POST(request: Request) {
  const controller = new AbortController();
  let client: TwelveLabs | null = null;
  let uploadedAssetId: string | null = null;
  let didTimeOut = false;
  const timeoutId = setTimeout(() => {
    didTimeOut = true;
    controller.abort();
  }, FEEDBACK_TIMEOUT_MS);
  const handleRequestAbort = () => controller.abort();
  request.signal.addEventListener("abort", handleRequestAbort, { once: true });

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

    client = new TwelveLabs({ apiKey });
    const requestOptions = {
      abortSignal: controller.signal,
      maxRetries: 1,
      timeoutInSeconds: REQUEST_TIMEOUT_SECONDS,
    };
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

    const asset = await client.assets.create({
      method: "direct",
      file,
      filename: file.name || "upload.webm",
    }, requestOptions);

    if (!asset.id) {
      return NextResponse.json(
        { error: "Upload succeeded but no asset id returned." },
        { status: 502 },
      );
    }
    uploadedAssetId = asset.id;

    let assetStatus = asset.status;
    let assetFailureMessage: string | undefined;
    for (let attempt = 0; attempt < ASSET_POLL_LIMIT; attempt += 1) {
      if (assetStatus === "ready") {
        break;
      }
      if (assetStatus === "failed") {
        return NextResponse.json(
          {
            error: assetFailureMessage
              ? `Video processing failed: ${assetFailureMessage}`
              : "Video processing failed.",
          },
          { status: 502 },
        );
      }
      await waitForPoll(ASSET_POLL_INTERVAL_MS, controller.signal);
      const polledAsset = await client.assets.retrieve(asset.id, requestOptions);
      assetStatus = polledAsset.status;
      assetFailureMessage = polledAsset.error?.message;
    }

    if (assetStatus !== "ready") {
      return NextResponse.json(
        { error: "Video processing timed out." },
        { status: 504 },
      );
    }

    const analysis = await client.analyze({
      modelName: "pegasus1.5",
      video: {
        type: "asset_id",
        assetId: asset.id,
      },
      prompt: FEEDBACK_PROMPT,
      responseFormat: {
        type: "json_schema",
        jsonSchema: FEEDBACK_JSON_SCHEMA,
      },
      maxTokens: 512,
    }, requestOptions);
    const feedbackText = analysis.data ?? "";
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
      console.error("12Labs response was not valid JSON.");
      return NextResponse.json(
        { error: "12Labs response was not valid JSON.", raw: feedbackText },
        { status: 502 },
      );
    }

    const record = parsed as Record<string, unknown>;
    const gazeSeverity = record.gaze_away_severity;
    const eyeContactScore = clampComponentScore(record.eye_contact_score);
    const facialEngagementScore = clampComponentScore(
      record.facial_engagement_score,
    );
    const postureScore = clampComponentScore(record.posture_score);
    const movementControlScore = clampComponentScore(
      record.movement_control_score,
    );
    const visualFeedback = record.visual_feedback;

    if (
      typeof gazeSeverity !== "string" ||
      !(gazeSeverity in GAZE_SCORE_CAPS) ||
      eyeContactScore === null ||
      facialEngagementScore === null ||
      postureScore === null ||
      movementControlScore === null ||
      typeof visualFeedback !== "string"
    ) {
      return NextResponse.json(
        { error: "12Labs response missing required confidence fields." },
        { status: 502 },
      );
    }

    const typedGazeSeverity =
      gazeSeverity as keyof typeof GAZE_SCORE_CAPS;
    const calibratedEyeContactScore = Math.min(
      eyeContactScore,
      EYE_CONTACT_SCORE_CAPS[typedGazeSeverity],
    );
    const weightedScore = Math.round(
      calibratedEyeContactScore * 0.5 +
        facialEngagementScore * 0.15 +
        postureScore * 0.15 +
        movementControlScore * 0.2,
    );
    const confidenceScore = Math.min(
      weightedScore,
      GAZE_SCORE_CAPS[typedGazeSeverity],
    );
    const feedback = {
      ...record,
      eye_contact_score: calibratedEyeContactScore,
      confidence_score: confidenceScore,
    };

    return NextResponse.json({ feedback, raw: feedbackText });
  } catch (err) {
    if (didTimeOut) {
      return NextResponse.json(
        {
          error:
            "Confidence evaluation timed out after 2 minutes. Please try again.",
        },
        { status: 504 },
      );
    }
    const message =
      err instanceof Error ? err.message : "Feedback request failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    clearTimeout(timeoutId);
    request.signal.removeEventListener("abort", handleRequestAbort);
    if (client && uploadedAssetId) {
      await client.assets
        .delete(uploadedAssetId, undefined, {
          maxRetries: 0,
          timeoutInSeconds: 10,
        })
        .catch(() => {
          console.warn("Cadence: failed to remove temporary feedback asset.");
        });
    }
  }
}
