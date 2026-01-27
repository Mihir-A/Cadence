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
  const prompt = `You are a strict evaluator of an interview response.

Interview question:
"${question}"

Tasks:
1) Transcribe the audio as faithfully as possible.
- Use [PAUSE] for long pauses (about 1.5s or more).
- Replace filler words (um, uh, like, you know, etc.) with [FILLER].
- Do not invent content that is not audible. If unclear, leave it out.

2) Score technical correctness only (ignore delivery/confidence).
Use this rubric:
- 0-2: No relevant answer or mostly incorrect.
- 3-4: Vague or partially incorrect; key ideas missing.
- 5-6: Partially correct; some key ideas present, important gaps remain.
- 7-8: Mostly correct and relevant; minor gaps or imprecision.
- 9-10: Complete, accurate, and well-aligned to the question.

Feedback rules:
- Provide exactly TWO feedback points about technical content.
- Each point must be specific and actionable.
- Prefer the most important missing/incorrect concept first.
- Keep each point under 18 words.
- If the audio is unclear, say what cannot be verified.

Return ONLY valid JSON with this exact schema and no extra keys:
{
  "transcript": "string",
  "technical_score": integer,
  "technical_feedback": ["string", "string"]
}

Hard constraints:
- Output JSON only (no prose, no code fences).
- Use double quotes.
- Escape quotes inside the transcript.`;

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
