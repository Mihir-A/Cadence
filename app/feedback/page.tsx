"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export default function FeedbackPage() {
  const [transcript, setTranscript] = useState("");
  const [feedback, setFeedback] = useState("");
  const [technical, setTechnical] = useState("");
  const [geminiRaw, setGeminiRaw] = useState("");
  const [feedbackRaw, setFeedbackRaw] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    setTranscript(window.sessionStorage.getItem("latestTranscript") ?? "");
    setFeedback(window.sessionStorage.getItem("latestFeedback") ?? "");
    setTechnical(window.sessionStorage.getItem("latestTechnical") ?? "");
    setGeminiRaw(window.sessionStorage.getItem("latestGeminiRaw") ?? "");
    setFeedbackRaw(window.sessionStorage.getItem("latestFeedbackRaw") ?? "");
  }, []);

  const parseJson = (value: string) => {
    if (!value) {
      return null;
    }
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  };

  const technicalParsed = parseJson(technical) as
    | { technical_score?: number; technical_feedback?: string[] }
    | string
    | null;
  const feedbackParsed = parseJson(feedback) as
    | { confidence_score?: number; confidence_feedback?: string[] }
    | string
    | null;

  const renderScoreBar = (value: number | undefined) => {
    const clamped = Math.max(0, Math.min(10, value ?? 0));
    const filled = Math.round(clamped);
    return (
      <div className="flex items-center gap-3">
        <div className="flex flex-1 gap-1">
          {Array.from({ length: 10 }).map((_, index) => (
            <span
              key={`tick-${index}`}
              className={`h-2 flex-1 rounded-full ${
                index < filled ? "bg-[#f29f4b]" : "bg-black/10"
              }`}
            />
          ))}
        </div>
        <span className="text-xs font-semibold text-black/60">
          {Math.round(clamped)}/10
        </span>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[#f6efe6] text-[#1f1a17]">
      <div className="relative overflow-hidden">
        <div className="pointer-events-none absolute -top-24 right-0 h-72 w-72 rounded-full bg-[#f7b267]/40 blur-[140px]" />
        <div className="pointer-events-none absolute bottom-0 left-0 h-80 w-80 rounded-full bg-[#7fd1b9]/40 blur-[160px]" />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.8),_rgba(255,255,255,0))]" />

        <main className="relative mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center gap-6 px-6 py-16">
          <div className="space-y-2">
            <span className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white/70 px-3 py-1 text-xs font-medium uppercase tracking-[0.2em] text-black/60">
              Feedback
            </span>
            <h1 className="text-3xl font-semibold tracking-tight text-[#1d1612] sm:text-4xl">
              Transcript
            </h1>
            <p className="text-sm text-black/60">
              Review the transcription and iterate on your response.
            </p>
          </div>

          <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="rounded-3xl border border-black/10 bg-white/80 p-6 shadow-[0_24px_60px_rgba(15,12,10,0.18)] backdrop-blur">
              <p className="text-xs uppercase tracking-[0.25em] text-black/50">
                Transcript
              </p>
              <div className="mt-4 min-h-[220px] whitespace-pre-wrap rounded-2xl border border-black/5 bg-white/70 p-4 text-sm text-black/80">
                {transcript || "No transcript available yet."}
              </div>
            </div>

            <div className="grid gap-6">
              <div className="rounded-3xl border border-black/10 bg-white/80 p-6 shadow-[0_24px_60px_rgba(15,12,10,0.18)] backdrop-blur">
                <p className="text-xs uppercase tracking-[0.25em] text-black/50">
                  Technical correctness
                </p>
                <div className="mt-4 space-y-4 text-sm text-black/80">
                  {renderScoreBar(
                    typeof technicalParsed === "object" &&
                      technicalParsed !== null
                      ? technicalParsed.technical_score
                      : undefined,
                  )}
                  <div className="space-y-2 text-sm">
                    {(typeof technicalParsed === "object" &&
                    technicalParsed?.technical_feedback?.length
                      ? technicalParsed.technical_feedback
                      : [])
                      .slice(0, 2)
                      .map((item, index) => (
                        <p
                          key={`tech-${index}`}
                          className="rounded-xl border border-black/5 bg-white/70 px-3 py-2 text-sm text-black/70"
                        >
                          {item}
                        </p>
                      ))}
                    {typeof technicalParsed === "string" ? (
                      <p className="rounded-xl border border-black/5 bg-white/70 px-3 py-2 text-sm text-black/70">
                        {technicalParsed}
                      </p>
                    ) : null}
                    {!technicalParsed ? (
                      <p className="text-sm text-black/50">
                        No technical feedback available yet.
                      </p>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="rounded-3xl border border-black/10 bg-white/80 p-6 shadow-[0_24px_60px_rgba(15,12,10,0.18)] backdrop-blur">
                <p className="text-xs uppercase tracking-[0.25em] text-black/50">
                  Confidence evaluation
                </p>
                <div className="mt-4 space-y-4 text-sm text-black/80">
                  {renderScoreBar(
                    typeof feedbackParsed === "object" &&
                      feedbackParsed !== null
                      ? feedbackParsed.confidence_score
                      : undefined,
                  )}
                  <div className="space-y-2 text-sm">
                    {(typeof feedbackParsed === "object" &&
                    feedbackParsed?.confidence_feedback?.length
                      ? feedbackParsed.confidence_feedback
                      : [])
                      .slice(0, 2)
                      .map((item, index) => (
                        <p
                          key={`conf-${index}`}
                          className="rounded-xl border border-black/5 bg-white/70 px-3 py-2 text-sm text-black/70"
                        >
                          {item}
                        </p>
                      ))}
                    {typeof feedbackParsed === "string" ? (
                      <p className="rounded-xl border border-black/5 bg-white/70 px-3 py-2 text-sm text-black/70">
                        {feedbackParsed}
                      </p>
                    ) : null}
                    {!feedbackParsed ? (
                      <p className="text-sm text-black/50">
                        No confidence feedback available yet.
                      </p>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-4 rounded-3xl border border-black/10 bg-white/80 p-6 shadow-[0_20px_50px_rgba(15,12,10,0.12)] backdrop-blur">
            <p className="text-xs uppercase tracking-[0.25em] text-black/50">
              Raw responses (debug)
            </p>
            <div className="space-y-3 text-xs text-black/70">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-black/40">
                  Gemini raw
                </p>
                <pre className="mt-2 max-h-56 overflow-auto rounded-2xl border border-black/5 bg-white/70 p-3">
                  {geminiRaw || "No raw Gemini response stored."}
                </pre>
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-black/40">
                  12Labs raw
                </p>
                <pre className="mt-2 max-h-56 overflow-auto rounded-2xl border border-black/5 bg-white/70 p-3">
                  {feedbackRaw || "No raw 12Labs response stored."}
                </pre>
              </div>
            </div>
            <Link
              href="/"
              className="inline-flex items-center justify-center rounded-full border border-black/15 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-black/60 transition hover:border-black/30 hover:text-black"
            >
              Back to recorder
            </Link>
          </div>
        </main>
      </div>
    </div>
  );
}
