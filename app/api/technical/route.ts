import { NextRequest } from "next/server";

const TECHNICAL_MODE = process.env.TECHNICAL_MODE ?? "gemini";

const normalizeModel = (model: string) =>
  model.startsWith("models/") ? model : `models/${model}`;

const GEMINI_API_VERSION = process.env.GEMINI_API_VERSION ?? "v1";
const GEMINI_MODEL =
  process.env.GEMINI_TECHNICAL_MODEL ?? "gemini-2.5-flash-lite";
const GEMINI_URL = `https://generativelanguage.googleapis.com/${GEMINI_API_VERSION}/${normalizeModel(
  GEMINI_MODEL,
)}:generateContent`;

const buildPrompt = (question: string, transcript: string) => `You are analyzing a candidate's interview response for technical correctness.

The interview question asked is:
"${question}"

Based on the response ${transcript}, evaluate:

1) Technical correctness: how well did the candidate answer the question conceptually? Ignore delivery, confidence, or nervousness.
- Score from 0 to 100.
- Give exactly TWO concise feedback points focusing on the key concepts.

Return ONLY a JSON object in this format:

{
  "technical_score": integer,
  "technical_feedback": [
    "string",
    "string"
  ]
}

Be objective, concise, and professional. Do not include any text outside of the JSON.`;

const parseGeminiText = (payload: unknown) => {
  if (!payload || typeof payload !== "object") {
    return "";
  }
  const record = payload as Record<string, unknown>;
  const candidates = record.candidates as Array<Record<string, unknown>> | undefined;
  const first = candidates?.[0];
  const content = first?.content as Record<string, unknown> | undefined;
  const parts = content?.parts as Array<Record<string, unknown>> | undefined;
  const text = parts?.map((part) => String(part.text ?? "")).join("").trim();
  return text ?? "";
};

const parseJsonSafe = (text: string) => {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
};

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const question = typeof body?.question === "string" ? body.question : "";
  const transcript = typeof body?.transcript === "string" ? body.transcript : "";

  if (!question || !transcript) {
    return Response.json(
      { error: "Missing question or transcript for technical scoring." },
      { status: 400 },
    );
  }

  if (TECHNICAL_MODE !== "gemini") {
    return Response.json(
      { error: "Technical mode is disabled. Set TECHNICAL_MODE=gemini." },
      { status: 503 },
    );
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "Missing GEMINI_API_KEY in the environment." },
      { status: 500 },
    );
  }

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
              text: buildPrompt(question, transcript),
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
      typeof (payload as { error?: { message?: string } })?.error?.message ===
      "string"
        ? (payload as { error?: { message?: string } }).error?.message
        : "Technical scoring failed.";
    return Response.json({ error: message }, { status: upstreamResponse.status });
  }

  const text = parseGeminiText(payload);
  if (!text) {
    return Response.json(
      { error: "No technical feedback returned from Gemini." },
      { status: 502 },
    );
  }

  return Response.json({ technical: parseJsonSafe(text) });
}
