"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Footer from "../components/Footer";
import Navbar from "../components/Navbar";
import { clearRecording, loadRecording } from "../lib/recordingStorage";

type HistoryEntry = {
  timestamp: string;
  question?: string;
  category?: string;
  confidence_score?: number | null;
  technical_score?: number | null;
  pause_count?: number | null;
  filler_word_count?: number | null;
};

const HISTORY_KEY = "cadenceHistory";
const HISTORY_CHART_LIMIT = 7;

export default function FeedbackPage() {
  const [transcript, setTranscript] = useState("");
  const [feedback, setFeedback] = useState("");
  const [technical, setTechnical] = useState("");
  const [geminiRaw, setGeminiRaw] = useState("");
  const [feedbackRaw, setFeedbackRaw] = useState("");
  const [transcriptStats, setTranscriptStats] = useState("");
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [latestQuestion, setLatestQuestion] = useState("");
  const [latestCategory, setLatestCategory] = useState("");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const router = useRouter();

  /* eslint-disable react-hooks/set-state-in-effect -- Initialize from sessionStorage on mount. */
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    setTranscript(window.sessionStorage.getItem("latestTranscript") ?? "");
    setFeedback(window.sessionStorage.getItem("latestFeedback") ?? "");
    setTechnical(window.sessionStorage.getItem("latestTechnical") ?? "");
    setGeminiRaw(window.sessionStorage.getItem("latestGeminiRaw") ?? "");
    setFeedbackRaw(window.sessionStorage.getItem("latestFeedbackRaw") ?? "");
    setTranscriptStats(
      window.sessionStorage.getItem("latestTranscriptStats") ?? "",
    );
    setLatestQuestion(window.sessionStorage.getItem("latestQuestion") ?? "");
    setLatestCategory(
      window.sessionStorage.getItem("latestQuestionCategory") ?? "",
    );
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    let objectUrl: string | null = null;
    loadRecording()
      .then((stored) => {
        if (!stored) {
          return;
        }
        objectUrl = URL.createObjectURL(stored);
        setDownloadUrl(objectUrl);
      })
      .catch(() => {});
    return () => {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, []);

  /* eslint-disable react-hooks/set-state-in-effect -- Initialize history from localStorage on mount. */
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      const stored = window.localStorage.getItem(HISTORY_KEY);
      const parsed = stored ? JSON.parse(stored) : [];
      if (Array.isArray(parsed)) {
        setHistory(parsed);
      }
    } catch {
      setHistory([]);
    }
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

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
    | {
        confidence_score?: number;
        pause_count?: number;
        filler_word_count?: number;
        visual_feedback?: string;
        confidence_feedback?: string[];
      }
    | string
    | null;
  const transcriptStatsParsed = parseJson(transcriptStats) as
    | { pause_count?: number; filler_word_count?: number }
    | string
    | null;
  const feedbackMetrics =
    typeof feedbackParsed === "object" && feedbackParsed !== null
      ? feedbackParsed
      : null;
  const transcriptMetrics =
    typeof transcriptStatsParsed === "object" && transcriptStatsParsed !== null
      ? transcriptStatsParsed
      : null;
  const pauseCount =
    transcriptMetrics?.pause_count ?? feedbackMetrics?.pause_count;
  const fillerCount =
    transcriptMetrics?.filler_word_count ?? feedbackMetrics?.filler_word_count;
  const adjustedConfidenceScore =
    typeof feedbackMetrics?.confidence_score === "number"
      ? Math.max(
          1,
          feedbackMetrics.confidence_score -
            Math.floor(((pauseCount ?? 0) + (fillerCount ?? 0)) / 2),
        )
      : undefined;
  const visualFeedback =
    typeof feedbackMetrics?.visual_feedback === "string"
      ? feedbackMetrics.visual_feedback
      : feedbackMetrics?.confidence_feedback?.[0];
  const fillerFeedback =
    typeof fillerCount === "number"
      ? fillerCount === 0
        ? "Excellent filler control. Your delivery stays crisp."
        : fillerCount < 4
          ? "A few filler words appear. Slow down to tighten delivery."
          : "Frequent filler words reduce clarity. Pause instead of filling."
      : null;
  const confidenceFeedbackItems = [
    visualFeedback,
    fillerFeedback,
  ].filter((item): item is string => Boolean(item));

  const chartEntries = history.slice(-HISTORY_CHART_LIMIT);
  const normalizeScore = (value: number | null | undefined) =>
    Math.max(0, Math.min(10, value ?? 0));
  const formatShortDate = (timestamp: string) => {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) {
      return "Unknown";
    }
    return date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  };
  const getAdjustedConfidence = (entry: HistoryEntry) => {
    if (typeof entry.confidence_score !== "number") {
      return null;
    }
    const pause = entry.pause_count ?? 0;
    const filler = entry.filler_word_count ?? 0;
    return Math.max(
      1,
      entry.confidence_score - Math.floor((pause + filler) / 2),
    );
  };
  const isDev = process.env.NODE_ENV === "development";

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

  const renderCountPill = (label: string, value: number | undefined) => (
    <div className="flex items-center justify-between gap-3 rounded-full border border-black/10 bg-white/70 px-3 py-1 text-xs font-medium text-black/60">
      <span className="text-[11px] uppercase tracking-[0.18em] text-black/50">
        {label}
      </span>
      <span className="text-sm font-semibold text-black/70">
        {typeof value === "number" ? value : "N/A"}
      </span>
    </div>
  );

  return (
    <div className="flex min-h-screen flex-col bg-[#f6efe6] text-[#1f1a17]">
      <div className="relative flex-1 overflow-hidden">
        <div className="pointer-events-none absolute -top-24 right-0 h-72 w-72 rounded-full bg-[#f7b267]/40 blur-[140px]" />
        <div className="pointer-events-none absolute bottom-0 left-0 h-80 w-80 rounded-full bg-[#7fd1b9]/40 blur-[160px]" />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.8),_rgba(255,255,255,0))]" />

        <Navbar />
        <main className="relative mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-3xl flex-col justify-center gap-6 px-6 py-16">
          <div className="space-y-2">
            <span className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white/70 px-3 py-1 text-xs font-medium uppercase tracking-[0.2em] text-black/60">
              Cadence Feedback
            </span>
            <h1 className="text-3xl font-semibold tracking-tight text-[#1d1612] sm:text-4xl">
              Cadence transcript review
            </h1>
            <p className="text-sm text-black/60">
              Review the transcription and iterate with Cadence.
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
                  {renderScoreBar(adjustedConfidenceScore)}
                  <div className="flex flex-wrap gap-2">
                    {renderCountPill("Long pauses", pauseCount)}
                    {renderCountPill(
                      "Filler words",
                      fillerCount,
                    )}
                  </div>
                  <div className="space-y-2 text-sm">
                    {confidenceFeedbackItems
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
              Session actions
            </p>
            <div className="flex flex-wrap gap-3">
              {downloadUrl ? (
                <a
                  href={downloadUrl}
                  download="interview-practice.webm"
                  className="inline-flex items-center justify-center rounded-full border border-black/15 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-black/60 transition hover:border-black/30 hover:text-black"
                >
                  Download clip
                </a>
              ) : null}
              {downloadUrl ? (
                <button
                  type="button"
                  onClick={() => {
                    if (downloadUrl) {
                      URL.revokeObjectURL(downloadUrl);
                    }
                    setDownloadUrl(null);
                    void clearRecording().catch(() => {});
                  }}
                  className="inline-flex cursor-pointer items-center justify-center rounded-full border border-red-200 bg-red-50 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-red-700 transition hover:border-red-300 hover:text-red-800"
                >
                  Delete clip
                </button>
              ) : null}
              {latestQuestion ? (
                <button
                  type="button"
                  onClick={() => {
                    if (typeof window === "undefined") {
                      return;
                    }
                    window.sessionStorage.setItem(
                      "retryQuestion",
                      latestQuestion,
                    );
                    if (latestCategory) {
                      window.sessionStorage.setItem(
                        "retryCategory",
                        latestCategory,
                      );
                    }
                    router.push("/");
                  }}
                  className="inline-flex cursor-pointer items-center justify-center rounded-full border border-black/15 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-black/60 transition hover:border-black/30 hover:text-black"
                >
                  Retry this question
                </button>
              ) : null}
              <Link
                href="/"
                className="inline-flex items-center justify-center rounded-full border border-black/15 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-black/60 transition hover:border-black/30 hover:text-black"
              >
                Back to Cadence recorder
              </Link>
            </div>
            <div className="rounded-2xl border border-black/10 bg-white/70 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-black/40">
                Clip preview
              </p>
              {downloadUrl ? (
                <video
                  src={downloadUrl}
                  className="mt-3 h-auto w-full rounded-2xl border border-black/5 bg-black/90"
                  controls
                  playsInline
                />
              ) : (
                <p className="mt-3 text-sm text-black/50">
                  No clip available to preview.
                </p>
              )}
            </div>
          </div>

          <div
            id="history"
            className="space-y-4 rounded-3xl border border-black/10 bg-white/80 p-6 shadow-[0_20px_50px_rgba(15,12,10,0.12)] backdrop-blur"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs uppercase tracking-[0.25em] text-black/50">
                History
              </p>
              {history.length > 0 ? (
                <button
                  type="button"
                  onClick={() => {
                    if (typeof window !== "undefined") {
                      window.localStorage.removeItem(HISTORY_KEY);
                    }
                    setHistory([]);
                  }}
                  className="inline-flex cursor-pointer items-center justify-center rounded-full border border-red-200 bg-red-50 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-red-700 transition hover:border-red-300 hover:text-red-800"
                >
                  Delete history
                </button>
              ) : null}
            </div>
            {history.length === 0 ? (
              <p className="text-sm text-black/50">
                No past sessions saved yet.
              </p>
            ) : (
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-2xl border border-black/10 bg-white/70 p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-black/50">
                    Confidence trend
                  </p>
                  <div className="mt-3 flex items-end gap-2">
                    {chartEntries.map((entry, index) => {
                      const score = normalizeScore(
                        getAdjustedConfidence(entry),
                      );
                      return (
                        <div
                          key={`conf-${entry.timestamp}-${index}`}
                          className="flex flex-1 flex-col items-center gap-2"
                        >
                          <div className="flex h-20 w-full items-end rounded-full bg-black/5">
                            <div
                              className="w-full rounded-full bg-[#f29f4b]"
                              style={{
                                height: `${(score / 10) * 100}%`,
                              }}
                            />
                          </div>
                          <span className="text-[10px] text-black/40">
                            {formatShortDate(entry.timestamp)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div className="rounded-2xl border border-black/10 bg-white/70 p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-black/50">
                    Technical trend
                  </p>
                  <div className="mt-3 flex items-end gap-2">
                    {chartEntries.map((entry, index) => {
                      const score = normalizeScore(entry.technical_score);
                      return (
                        <div
                          key={`tech-${entry.timestamp}-${index}`}
                          className="flex flex-1 flex-col items-center gap-2"
                        >
                          <div className="flex h-20 w-full items-end rounded-full bg-black/5">
                            <div
                              className="w-full rounded-full bg-[#7fd1b9]"
                              style={{
                                height: `${(score / 10) * 100}%`,
                              }}
                            />
                          </div>
                          <span className="text-[10px] text-black/40">
                            {formatShortDate(entry.timestamp)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
            {history.length > 0 ? (
              <div className="rounded-2xl border border-black/10 bg-white/70 p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-black/50">
                  Recent sessions
                </p>
                <div className="mt-3 space-y-2 text-sm text-black/60">
                  {history
                    .slice(-5)
                    .reverse()
                    .map((entry) => (
                      <div
                        key={`row-${entry.timestamp}`}
                        className="flex flex-wrap items-center justify-between gap-2"
                      >
                        <span className="text-black/70">
                          {entry.question ?? "Session"}
                        </span>
                        <span className="text-xs text-black/40">
                          {formatShortDate(entry.timestamp)}
                        </span>
                      </div>
                    ))}
                </div>
              </div>
            ) : null}
          </div>

          {isDev ? (
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
            </div>
          ) : null}
        </main>
      </div>
      <Footer />
    </div>
  );
}
