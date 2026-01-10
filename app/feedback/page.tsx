"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export default function FeedbackPage() {
  const [transcript, setTranscript] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    setTranscript(window.sessionStorage.getItem("latestTranscript") ?? "");
  }, []);

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

          <div className="rounded-3xl border border-black/10 bg-white/80 p-6 shadow-[0_24px_60px_rgba(15,12,10,0.18)] backdrop-blur">
            <p className="text-xs uppercase tracking-[0.25em] text-black/50">
              Transcribed text
            </p>
            <div className="mt-4 min-h-[240px] whitespace-pre-wrap rounded-2xl border border-black/5 bg-white/70 p-4 text-sm text-black/80">
              {transcript || "No transcript available yet."}
            </div>
            <Link
              href="/"
              className="mt-6 inline-flex items-center justify-center rounded-full border border-black/15 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-black/60 transition hover:border-black/30 hover:text-black"
            >
              Back to recorder
            </Link>
          </div>
        </main>
      </div>
    </div>
  );
}
