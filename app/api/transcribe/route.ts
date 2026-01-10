import { Buffer } from "buffer";
import { NextRequest } from "next/server";

const PLACEHOLDER_TRANSCRIPT =
  "Transcription temporarily disabled to avoid rate limits. This is a placeholder response.";
const TRANSCRIBE_MODE =
  process.env.TRANSCRIBE_MODE ?? "placeholder";

const normalizeModel = (model: string) =>
  model.startsWith("models/") ? model : `models/${model}`;

const GEMINI_API_VERSION = process.env.GEMINI_API_VERSION ?? "v1";
const GEMINI_MODEL =
  process.env.GEMINI_TRANSCRIBE_MODEL ?? "gemini-2.5-flash-lite";
const GEMINI_URL = `https://generativelanguage.googleapis.com/${GEMINI_API_VERSION}/${normalizeModel(
  GEMINI_MODEL,
)}:generateContent`;

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return Response.json(
      { error: "No audio file received for transcription." },
      { status: 400 },
    );
  }

  if (TRANSCRIBE_MODE === "placeholder") {
    void file;
    return Response.json({ text: PLACEHOLDER_TRANSCRIPT });
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
              text: "Transcribe the audio. Show a large pause with [PAUSE], and filler words (like, uhh, umm, ehh, uhh, etc.) [FILLER]. Return only the transcript text.",
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

  const transcript =
    payload?.candidates?.[0]?.content?.parts
      ?.map((part: { text?: string }) => part.text ?? "")
      .join("")
      .trim() ?? "";

  if (!transcript) {
    return Response.json(
      { error: "No transcript returned from Gemini." },
      { status: 502 },
    );
  }

  return Response.json({ text: transcript });
}
