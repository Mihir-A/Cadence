import { Buffer } from "buffer";
import { NextRequest } from "next/server";
import { isAiCallsDisabled } from "../../lib/aiConfig";

const PLACEHOLDER_TRANSCRIPT =
  "Temp response: [PAUSE] umm I think that [FILLER] the key to success is uh hard work and dedication [PAUSE] you know like setting goals and staying focused [FILLER] yeah.";
const PLACEHOLDER_TECHNICAL = {
  technical_score: 81,
  technical_feedback: [
    "Covers the core concept but skips one important detail.",
    "Correct direction overall; tighten the explanation of the key mechanism.",
  ],
};
const TRANSCRIBE_MODE =
  process.env.TRANSCRIBE_MODE ?? "gemini"; // "gemini" or "placeholder"

const normalizeModel = (model: string) =>
  model.startsWith("models/") ? model : `models/${model}`;

const GEMINI_API_VERSION = process.env.GEMINI_API_VERSION ?? "v1";
const GEMINI_MODEL =
  process.env.GEMINI_TRANSCRIBE_MODEL ?? "gemini-2.5-flash";
const GEMINI_URL = `https://generativelanguage.googleapis.com/${GEMINI_API_VERSION}/${normalizeModel(
  GEMINI_MODEL,
)}:generateContent`;

const countToken = (text: string, token: string) =>
  text.split(token).length - 1;

const getTranscriptCounts = (text: string) => ({
  pause_count: countToken(text, "[PAUSE]"),
  filler_word_count:
    countToken(text, "[FILLER]") + countToken(text, "[FILTER]"),
});

export async function POST(request: NextRequest) {
  if (isAiCallsDisabled()) {
    console.info(
      "Cadence: AI calls disabled; returning placeholder transcript.",
    );
    const placeholderCounts = getTranscriptCounts(PLACEHOLDER_TRANSCRIPT);
    return Response.json({
      transcript: PLACEHOLDER_TRANSCRIPT,
      ...placeholderCounts,
      technical: PLACEHOLDER_TECHNICAL,
      raw: "placeholder",
    });
  }

  const formData = await request.formData();
  const file = formData.get("file");
  const question =
    typeof formData.get("question") === "string"
      ? String(formData.get("question"))
      : "Unknown question";

  if (!(file instanceof File)) {
    return Response.json(
      { error: "No audio file received for transcription." },
      { status: 400 },
    );
  }

  if (TRANSCRIBE_MODE === "placeholder") {
    const placeholderCounts = getTranscriptCounts(PLACEHOLDER_TRANSCRIPT);
    void file;
    return Response.json({
      transcript: PLACEHOLDER_TRANSCRIPT,
      ...placeholderCounts,
      technical: PLACEHOLDER_TECHNICAL,
      raw: "placeholder",
    });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "Missing GEMINI_API_KEY in the environment." },
      { status: 500 },
    );
  }

  const arrayBuffer = await file.arrayBuffer();
  const base64Audio = Buffer.from(arrayBuffer).toString("base64");
  const mimeType = file.type || "audio/webm";
  const prompt = `You are analyzing a candidate's interview response for technical correctness.

The interview question asked is:
"${question}"

First, transcribe the audio exactly. Show a large pause with [PAUSE], and filler words (like, uhh, umm, ehh, uhh, etc.) [FILLER].

Then, based on the response, evaluate:

1) Technical correctness: how well did the candidate answer the question conceptually? Ignore delivery, confidence, or nervousness.
- Score from 0 to 10 (NO DECIMALS)
- Give exactly TWO concise feedback points focusing on the key concepts.

Return ONLY a JSON object in this format:

{
  "transcript": "string",
  "technical_score": integer,
  "technical_feedback": [
    "string",
    "string"
  ]
}

Strict rules:
- Output must be valid JSON with double quotes.
- Do not wrap in code fences.
- Do not add any extra text before or after the JSON.
- Escape any quotes inside the transcript string.

Be objective, concise, and professional. Do not include any text outside of the JSON.`;

  const upstreamResponse = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [
            {
              text: prompt,
            },
            {
              inlineData: {
                mimeType,
                data: base64Audio,
              },
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.2,
      },
    }),
  });

  const payload = await upstreamResponse.json().catch(() => ({}));

  if (!upstreamResponse.ok) {
    const message =
      typeof payload?.error?.message === "string"
        ? payload.error.message
        : "Transcription failed.";
    return Response.json({ error: message }, { status: upstreamResponse.status });
  }

  const modelText =
    payload?.candidates?.[0]?.content?.parts
      ?.map((part: { text?: string }) => part.text ?? "")
      .join("")
      .trim() ?? "";

  if (!modelText) {
    return Response.json(
      { error: "No response returned from Gemini." },
      { status: 502 },
    );
  }

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
    parsed = JSON.parse(modelText);
  } catch {
    const extracted = extractJsonBlock(modelText);
    if (extracted) {
      try {
        parsed = JSON.parse(extracted);
      } catch {
        parsed = null;
      }
    }
  }

  if (!parsed || typeof parsed !== "object") {
    console.error("Gemini response was not valid JSON:", modelText);
    return Response.json(
      { error: "Gemini response was not valid JSON.", raw: modelText },
      { status: 502 },
    );
  }

  const record = parsed as Record<string, unknown>;
  const transcript =
    typeof record.transcript === "string" ? record.transcript : "";
  const transcriptCounts = getTranscriptCounts(transcript);
  const technical_score =
    typeof record.technical_score === "number"
      ? record.technical_score
      : null;
  const technical_feedback = Array.isArray(record.technical_feedback)
    ? record.technical_feedback.map((item) => String(item))
    : null;

  if (!transcript || technical_score === null || !technical_feedback) {
    return Response.json(
      { error: "Gemini response missing required fields.", raw: modelText },
      { status: 502 },
    );
  }

  return Response.json({
    transcript,
    ...transcriptCounts,
    technical: {
      technical_score,
      technical_feedback,
    },
    raw: modelText,
  });
}
