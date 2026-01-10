"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

const DURATION_OPTIONS = [
  { label: "30s", seconds: 30 },
  { label: "1 min", seconds: 60 },
  { label: "5 min", seconds: 300 },
];

const INTERVIEW_SETS = [
  {
    type: "Behavioral / Fit",
    questions: [
      "Tell me about yourself.",
      "Describe a time you handled conflict on a team.",
      "Why are you interested in this role?",
    ],
  },
  {
    type: "Technical - Computer Science (DSA / Coding)",
    questions: [
      "Explain the time complexity of binary search.",
      "Walk through how you would detect a cycle in a linked list.",
      "Design an algorithm to find the top K frequent elements.",
    ],
  },
  {
    type: "Technical - Economics (Micro / Macro / Metrics)",
    questions: [
      "Explain the difference between GDP and GNP.",
      "How does a price ceiling affect supply and demand?",
      "Describe what a p-value means in a regression.",
    ],
  },
  {
    type: "Case Interview",
    questions: [
      "Estimate the annual market size for electric scooters in a city.",
      "A coffee chain's profits are down. How would you analyze it?",
      "How would you structure a market entry for a new fintech app?",
    ],
  },
  {
    type: "Quantitative / Math",
    questions: [
      "Explain how you would model expected value for a simple gamble.",
      "If a fair coin is flipped 5 times, what is the probability of exactly 3 heads?",
      "How would you approximate sqrt(10) without a calculator?",
    ],
  },
  {
    type: "System Design",
    questions: [
      "Design a URL shortener.",
      "Outline a scalable chat system.",
      "Design a notification system for a mobile app.",
    ],
  },
];

const shuffleArray = (items: string[]) => {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};

const pickRecorderMimeType = () => {
  if (typeof MediaRecorder === "undefined") {
    return "";
  }
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
};

const formatTime = (totalSeconds: number) => {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.max(0, totalSeconds % 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
};

export default function Home() {
  const previewRef = useRef<HTMLVideoElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordedBlobRef = useRef<Blob | null>(null);
  const timerRef = useRef<number | null>(null);
  const router = useRouter();

  const [isRecording, setIsRecording] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [selectedDuration, setSelectedDuration] = useState(
    DURATION_OPTIONS[1].seconds,
  );
  const [timeLeft, setTimeLeft] = useState(DURATION_OPTIONS[1].seconds);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSupported, setIsSupported] = useState(true);
  const [selectedType, setSelectedType] = useState(INTERVIEW_SETS[0].type);
  const [questions, setQuestions] = useState<string[]>(
    INTERVIEW_SETS[0].questions,
  );
  const [questionIndex, setQuestionIndex] = useState(0);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcriptError, setTranscriptError] = useState<string | null>(null);

  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      (!navigator.mediaDevices?.getUserMedia ||
        typeof MediaRecorder === "undefined")
    ) {
      setIsSupported(false);
    }
  }, []);

  useEffect(() => {
    const nextSet = INTERVIEW_SETS.find((set) => set.type === selectedType);
    if (!nextSet) {
      return;
    }
    setQuestions(shuffleArray(nextSet.questions));
    setQuestionIndex(0);
  }, [selectedType]);

  useEffect(() => {
    if (!isRecording) {
      setTimeLeft(selectedDuration);
    }
  }, [isRecording, selectedDuration]);

  useEffect(() => {
    if (previewRef.current && streamRef.current) {
      previewRef.current.srcObject = streamRef.current;
    }
  }, [isPreviewing, isRecording]);

  const currentQuestion =
    questions[questionIndex] ?? "Pick an interview type to begin.";
  const questionCount = questions.length;
  const durationLabel =
    DURATION_OPTIONS.find((option) => option.seconds === selectedDuration)
      ?.label ?? `${selectedDuration}s`;

  const statusText = useMemo(() => {
    if (!isSupported) {
      return "Recording isn't supported in this browser.";
    }
    if (isRecording) {
      return "Recording live. Keep it concise and confident.";
    }
    if (isPreviewing) {
      return "Preview is live. Start recording when you're ready.";
    }
    if (videoUrl) {
      return "Review your answer, then record again if needed.";
    }
    return "Hit record when you're ready to practice.";
  }, [isPreviewing, isRecording, isSupported, videoUrl]);

  const progress = Math.min(
    100,
    Math.max(
      0,
      ((selectedDuration - timeLeft) / selectedDuration) * 100,
    ),
  );

  const clearTimer = () => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const cleanupStream = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (previewRef.current) {
      previewRef.current.srcObject = null;
    }
    setIsPreviewing(false);
  };

  const resetRecording = () => {
    clearTimer();
    chunksRef.current = [];
    recordedBlobRef.current = null;
    setIsRecording(false);
    setTimeLeft(selectedDuration);
    setError(null);
    setTranscriptError(null);
    if (videoUrl) {
      URL.revokeObjectURL(videoUrl);
      setVideoUrl(null);
    }
  };

  const stopRecording = () => {
    clearTimer();
    setIsRecording(false);
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state !== "inactive"
    ) {
      mediaRecorderRef.current.stop();
    }
  };

  const ensureStream = async () => {
    if (streamRef.current) {
      return streamRef.current;
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    const audioTracks = stream.getAudioTracks();
    if (!audioTracks.length) {
      stream.getTracks().forEach((track) => track.stop());
      throw new Error("No microphone detected.");
    }
    streamRef.current = stream;
    setIsPreviewing(true);
    return stream;
  };

  const startPreview = async () => {
    if (isRecording || isPreviewing) {
      return;
    }
    setError(null);

    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      setIsSupported(false);
      setError("Media recording isn't available in this browser.");
      return;
    }

    try {
      await ensureStream();
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Camera or microphone permission was denied.";
      setError(message);
      cleanupStream();
    }
  };

  const goToNextQuestion = () => {
    if (!questions.length) {
      return;
    }
    setQuestionIndex((prev) => (prev + 1) % questions.length);
  };

  const transcribeRecording = async () => {
    if (!recordedBlobRef.current) {
      setTranscriptError("Record a response before requesting feedback.");
      return;
    }

    setIsTranscribing(true);
    setTranscriptError(null);

    try {
      const formData = new FormData();
      formData.append(
        "file",
        recordedBlobRef.current,
        "interview-practice.webm",
      );

      const response = await fetch("/api/transcribe", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error ?? "Transcription failed.");
      }

      const payload = await response.json();
      const transcript =
        typeof payload?.text === "string"
          ? payload.text
          : "No transcript returned.";

      if (typeof window !== "undefined") {
        window.sessionStorage.setItem("latestTranscript", transcript);
      }
      router.push("/feedback");
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Transcription failed. Please try again.";
      setTranscriptError(message);
    } finally {
      setIsTranscribing(false);
    }
  };

  const startRecording = async () => {
    if (isRecording) {
      return;
    }
    resetRecording();
    setError(null);

    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      setIsSupported(false);
      setError("Media recording isn't available in this browser.");
      return;
    }

    try {
      const stream = await ensureStream();
      const mimeType = pickRecorderMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onerror = () => {
        setError("Recording failed. Please try again.");
        stopRecording();
      };

      recorder.onstop = () => {
        clearTimer();
        cleanupStream();
        setIsRecording(false);
        const recordedBlob = new Blob(chunksRef.current, {
          type: recorder.mimeType || "video/webm",
        });
        if (recordedBlob.size > 0) {
          recordedBlobRef.current = recordedBlob;
          const nextUrl = URL.createObjectURL(recordedBlob);
          setVideoUrl(nextUrl);
        }
      };

      recorder.start();
      setIsRecording(true);
      setTimeLeft(selectedDuration);

      const startTime = Date.now();
      timerRef.current = window.setInterval(() => {
        const elapsedSeconds = (Date.now() - startTime) / 1000;
        const remaining = Math.max(
          0,
          Math.ceil(selectedDuration - elapsedSeconds),
        );
        setTimeLeft(remaining);

        if (elapsedSeconds >= selectedDuration) {
          stopRecording();
        }
      }, 200);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Camera or microphone permission was denied.";
      setError(message);
      cleanupStream();
    }
  };

  useEffect(() => {
    return () => {
      clearTimer();
      if (
        mediaRecorderRef.current &&
        mediaRecorderRef.current.state !== "inactive"
      ) {
        mediaRecorderRef.current.stop();
      }
      cleanupStream();
      if (videoUrl) {
        URL.revokeObjectURL(videoUrl);
      }
    };
  }, [videoUrl]);

  return (
    <div className="min-h-screen bg-[#f6efe6] text-[#1f1a17]">
      <div className="relative overflow-hidden">
        <div className="pointer-events-none absolute -top-24 right-0 h-72 w-72 rounded-full bg-[#f7b267]/40 blur-[140px]" />
        <div className="pointer-events-none absolute bottom-0 left-0 h-80 w-80 rounded-full bg-[#7fd1b9]/40 blur-[160px]" />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.8),_rgba(255,255,255,0))]" />

        <main className="relative mx-auto flex min-h-screen max-w-6xl flex-col items-start justify-center gap-12 px-6 py-16 lg:flex-row lg:items-center lg:gap-16">
          <section className="max-w-xl space-y-6">
            <span className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white/70 px-3 py-1 text-xs font-medium uppercase tracking-[0.2em] text-black/60">
              Practice Mode
            </span>
            <h1 className="text-4xl font-semibold tracking-tight text-[#1d1612] sm:text-5xl">
              Timed interview sprints, built for focus.
            </h1>
            <p className="text-lg leading-relaxed text-black/70">
              Pick a format, answer a prompt, and record a focused response
              under the clock. Review it, iterate, and sharpen your delivery.
            </p>
            <div className="grid gap-3 text-sm text-black/60">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-[#1f1a17]" />
                Camera + mic stay local in your browser.
              </div>
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-[#1f1a17]" />
                Auto-stops at your selected time limit.
              </div>
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-[#1f1a17]" />
                Choose 30s, 1 min, or 5 min sessions.
              </div>
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-[#1f1a17]" />
                Download the clip to self-review.
              </div>
            </div>

            <div className="rounded-3xl border border-black/10 bg-white/80 p-6 shadow-[0_20px_50px_rgba(15,12,10,0.12)] backdrop-blur">
              <div className="flex flex-wrap items-end gap-4">
                <div className="min-w-[220px] flex-1">
                  <label className="text-xs uppercase tracking-[0.25em] text-black/50">
                    Interview type
                  </label>
                  <select
                    value={selectedType}
                    onChange={(event) => setSelectedType(event.target.value)}
                    disabled={isRecording}
                    className="mt-2 w-full rounded-2xl border border-black/15 bg-white/80 px-3 py-2 text-sm text-black/80 shadow-sm outline-none transition focus:border-black/40 disabled:cursor-not-allowed disabled:bg-black/5"
                  >
                    {INTERVIEW_SETS.map((set) => (
                      <option key={set.type} value={set.type}>
                        {set.type}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="min-w-[140px]">
                  <label className="text-xs uppercase tracking-[0.25em] text-black/50">
                    Duration
                  </label>
                  <select
                    value={selectedDuration}
                    onChange={(event) =>
                      setSelectedDuration(Number(event.target.value))
                    }
                    disabled={isRecording}
                    className="mt-2 w-full rounded-2xl border border-black/15 bg-white/80 px-3 py-2 text-sm text-black/80 shadow-sm outline-none transition focus:border-black/40 disabled:cursor-not-allowed disabled:bg-black/5"
                  >
                    {DURATION_OPTIONS.map((option) => (
                      <option key={option.seconds} value={option.seconds}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="mt-5 rounded-2xl border border-black/10 bg-white/70 p-4">
                <div className="flex items-center justify-between text-xs text-black/50">
                  <span className="uppercase tracking-[0.25em]">Question</span>
                  <span className="uppercase tracking-[0.2em]">
                    {questionCount
                      ? `${questionIndex + 1} of ${questionCount}`
                      : "0 of 0"}
                  </span>
                </div>
                <p className="mt-3 text-base font-medium text-black/80">
                  {currentQuestion}
                </p>
                <button
                  type="button"
                  onClick={goToNextQuestion}
                  disabled={isRecording || questionCount === 0}
                  className="mt-4 inline-flex items-center justify-center rounded-full border border-black/15 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-black/60 transition hover:border-black/30 hover:text-black disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Next question
                </button>
              </div>
            </div>
          </section>

          <section className="w-full max-w-xl">
            <div className="rounded-3xl border border-black/10 bg-white/80 p-6 shadow-[0_24px_60px_rgba(15,12,10,0.18)] backdrop-blur">
              <div className="space-y-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs uppercase tracking-[0.25em] text-black/50">
                      Timer
                    </p>
                    <p className="mt-1 font-mono text-3xl text-black/90">
                      {formatTime(timeLeft)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-black/60">
                    <span
                      className={`h-2.5 w-2.5 rounded-full ${
                        isRecording
                          ? "bg-red-500 shadow-[0_0_12px_rgba(239,68,68,0.8)] animate-pulse"
                          : "bg-emerald-500/80"
                      }`}
                    />
                    <span>
                      {isRecording
                        ? "Recording"
                        : videoUrl
                          ? "Recorded"
                          : "Ready"}
                    </span>
                  </div>
                </div>

                <div className="aspect-video w-full overflow-hidden rounded-2xl bg-[#111111] shadow-inner">
                  {isRecording || isPreviewing ? (
                    <video
                      ref={previewRef}
                      className="h-full w-full object-cover"
                      autoPlay
                      muted
                      playsInline
                    />
                  ) : videoUrl ? (
                    <video
                      key={videoUrl}
                      src={videoUrl}
                      className="h-full w-full object-cover"
                      controls
                      playsInline
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center px-6 text-center text-sm text-white/70">
                      Your camera preview will appear here once you start.
                    </div>
                  )}
                </div>

                <div>
                  <div className="h-2 w-full rounded-full bg-black/10">
                    <div
                      className="h-2 rounded-full bg-black/80 transition-all duration-300"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <div className="mt-2 flex items-center justify-between text-xs text-black/40">
                    <span>0s</span>
                    <span>{durationLabel} max</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-sm text-black/60">{statusText}</p>
                  {error ? (
                    <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
                      {error}
                    </p>
                  ) : null}
                  {transcriptError ? (
                    <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                      {transcriptError}
                    </p>
                  ) : null}
                  {isTranscribing ? (
                    <div className="space-y-2">
                      <div className="h-2 w-full overflow-hidden rounded-full bg-black/10">
                        <div className="loading-bar-runner h-full w-1/2 rounded-full bg-gradient-to-r from-[#f7b267] via-[#f29f4b] to-[#f7b267]" />
                      </div>
                      <p className="text-xs text-black/50">
                        Transcribing your response...
                      </p>
                    </div>
                  ) : null}
                </div>

                <div className="flex flex-wrap gap-3">
                  {!videoUrl && !isPreviewing && !isRecording ? (
                    <button
                      type="button"
                      onClick={startPreview}
                      disabled={!isSupported}
                      className="inline-flex items-center justify-center rounded-full border border-black/15 px-5 py-2.5 text-sm font-medium text-black/70 transition hover:border-black/30 hover:text-black disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Enable camera
                    </button>
                  ) : null}
                  {!videoUrl && isPreviewing && !isRecording ? (
                    <button
                      type="button"
                      onClick={cleanupStream}
                      className="inline-flex items-center justify-center rounded-full border border-black/15 px-5 py-2.5 text-sm font-medium text-black/70 transition hover:border-black/30 hover:text-black"
                    >
                      Turn off camera
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={startRecording}
                    disabled={!isSupported || isRecording}
                    className={`inline-flex items-center justify-center rounded-full px-5 py-2.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
                      videoUrl
                        ? "border border-black/15 bg-white/80 text-black/70 hover:border-black/30 hover:text-black"
                        : "bg-[#1f1a17] text-[#fef7f1] hover:bg-black/90"
                    }`}
                  >
                    {videoUrl ? "Record again" : "Start recording"}
                  </button>
                  {isRecording ? (
                    <button
                      type="button"
                      onClick={stopRecording}
                      className="inline-flex items-center justify-center rounded-full border border-black/15 px-5 py-2.5 text-sm font-medium text-black/70 transition hover:border-black/30 hover:text-black"
                    >
                      Stop
                    </button>
                  ) : null}
                  {videoUrl ? (
                    <a
                      href={videoUrl}
                      download="interview-practice.webm"
                      className="inline-flex items-center justify-center rounded-full border border-black/15 px-5 py-2.5 text-sm font-medium text-black/70 transition hover:border-black/30 hover:text-black"
                    >
                      Download clip
                    </a>
                  ) : null}
                  {videoUrl ? (
                    <button
                      type="button"
                      onClick={transcribeRecording}
                      disabled={isTranscribing}
                      className="inline-flex items-center justify-center rounded-full bg-[#f7b267] px-5 py-2.5 text-sm font-semibold text-[#1f1a17] shadow-[0_12px_24px_rgba(247,178,103,0.35)] transition hover:bg-[#f29f4b] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isTranscribing ? "Transcribing..." : "Open feedback"}
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
