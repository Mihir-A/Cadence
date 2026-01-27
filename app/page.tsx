"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import Footer from "./components/Footer";
import Navbar from "./components/Navbar";
import {
  clearRecording,
  loadRecording,
  saveRecording,
} from "./lib/recordingStorage";
import questionsData from "./data/questions.json";

const DURATION_OPTIONS = [
  { label: "30s", seconds: 30 },
  { label: "1 min", seconds: 60 },
  { label: "5 min", seconds: 300 },
];

type QuestionCategory = {
  category: string;
  questions: string[];
};

type StepStatus = "idle" | "loading" | "success" | "error";

const QUESTION_BANK: QuestionCategory[] = questionsData.question_bank ?? [];
const DEFAULT_CATEGORY = QUESTION_BANK[0]?.category ?? "General";
const DEFAULT_QUESTIONS = QUESTION_BANK[0]?.questions ?? [];
const CUSTOM_CATEGORY = "Custom";

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

const VIDEO_CONSTRAINTS: MediaTrackConstraints = {
  width: { ideal: 640 },
  height: { ideal: 360 },
  frameRate: { ideal: 20, max: 24 },
  facingMode: "user",
};

const VIDEO_BITS_PER_SECOND = 450_000;
const AUDIO_BITS_PER_SECOND = 48_000;
const RETRY_QUESTION_KEY = "retryQuestion";
const RETRY_CATEGORY_KEY = "retryCategory";
const LAST_QUESTION_KEY = "latestQuestion";
const LAST_CATEGORY_KEY = "latestQuestionCategory";
const HISTORY_KEY = "cadenceHistory";
const HISTORY_LIMIT = 20;

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
  const [selectedType, setSelectedType] = useState(DEFAULT_CATEGORY);
  const [questions, setQuestions] = useState<string[]>(
    DEFAULT_QUESTIONS,
  );
  const [customQuestion, setCustomQuestion] = useState("");
  const [questionIndex, setQuestionIndex] = useState(0);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcriptError, setTranscriptError] = useState<string | null>(null);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [technicalError, setTechnicalError] = useState<string | null>(null);
  const [transcribeStatus, setTranscribeStatus] =
    useState<StepStatus>("idle");
  const [technicalStatus, setTechnicalStatus] =
    useState<StepStatus>("idle");
  const [feedbackStatus, setFeedbackStatus] = useState<StepStatus>("idle");

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
    if (typeof window === "undefined") {
      return;
    }
    const retryQuestion = window.sessionStorage.getItem(RETRY_QUESTION_KEY);
    const retryCategory = window.sessionStorage.getItem(RETRY_CATEGORY_KEY);
    if (!retryQuestion) {
      return;
    }
    if (retryCategory === CUSTOM_CATEGORY) {
      setSelectedType(CUSTOM_CATEGORY);
      setCustomQuestion(retryQuestion);
      return;
    }
    if (retryCategory) {
      setSelectedType(retryCategory);
      return;
    }
    const match = QUESTION_BANK.find((set) =>
      set.questions.includes(retryQuestion),
    );
    if (match) {
      setSelectedType(match.category);
      return;
    }
    setSelectedType(CUSTOM_CATEGORY);
    setCustomQuestion(retryQuestion);
  }, []);

  useEffect(() => {
    let isActive = true;
    loadRecording()
      .then((stored) => {
        if (!isActive || !stored) {
          return;
        }
        recordedBlobRef.current = stored;
        setVideoUrl((current) =>
          current ? current : URL.createObjectURL(stored),
        );
      })
      .catch(() => {});
    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    if (selectedType === CUSTOM_CATEGORY) {
      const trimmedCustomQuestion = customQuestion.trim();
      setQuestions(trimmedCustomQuestion ? [trimmedCustomQuestion] : []);
      setQuestionIndex(0);
      if (typeof window !== "undefined") {
        window.sessionStorage.removeItem(RETRY_QUESTION_KEY);
        window.sessionStorage.removeItem(RETRY_CATEGORY_KEY);
      }
      return;
    }
    const nextSet = QUESTION_BANK.find(
      (set) => set.category === selectedType,
    );
    if (!nextSet) {
      return;
    }
    if (typeof window !== "undefined") {
      const retryQuestion = window.sessionStorage.getItem(RETRY_QUESTION_KEY);
      const retryCategory = window.sessionStorage.getItem(RETRY_CATEGORY_KEY);
      if (
        retryQuestion &&
        (!retryCategory || retryCategory === selectedType)
      ) {
        const remaining = nextSet.questions.filter(
          (question) => question !== retryQuestion,
        );
        setQuestions([retryQuestion, ...remaining]);
        setQuestionIndex(0);
        window.sessionStorage.removeItem(RETRY_QUESTION_KEY);
        window.sessionStorage.removeItem(RETRY_CATEGORY_KEY);
        return;
      }
    }
    setQuestions([...nextSet.questions]);
    setQuestionIndex(0);
  }, [customQuestion, selectedType]);

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

  const isCustom = selectedType === CUSTOM_CATEGORY;
  const trimmedCustomQuestion = customQuestion.trim();
  const currentQuestion = isCustom
    ? trimmedCustomQuestion || "Enter a custom question to continue."
    : questions[questionIndex] ?? "Pick an interview type to begin.";
  const questionCount = isCustom
    ? trimmedCustomQuestion
      ? 1
      : 0
    : questions.length;
  const durationLabel =
    DURATION_OPTIONS.find((option) => option.seconds === selectedDuration)
      ?.label ?? `${selectedDuration}s`;
  const showProgressSteps =
    isTranscribing ||
    transcribeStatus !== "idle" ||
    technicalStatus !== "idle" ||
    feedbackStatus !== "idle";
  const stepStatusLabel = (status: StepStatus) => {
    switch (status) {
      case "loading":
        return "Running";
      case "success":
        return "Done";
      case "error":
        return "Failed";
      default:
        return "Waiting";
    }
  };

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
    void clearRecording().catch(() => {});
    setIsRecording(false);
    setTimeLeft(selectedDuration);
    setError(null);
    setTranscriptError(null);
    setFeedbackError(null);
    setTechnicalError(null);
    setTranscribeStatus("idle");
    setTechnicalStatus("idle");
    setFeedbackStatus("idle");
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
      video: VIDEO_CONSTRAINTS,
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

  const goToPreviousQuestion = () => {
    if (!questions.length) {
      return;
    }
    setQuestionIndex((prev) =>
      prev === 0 ? questions.length - 1 : prev - 1,
    );
  };

  const transcribeRecording = async () => {
    if (isCustom && !trimmedCustomQuestion) {
      setTranscriptError("Enter a custom question before requesting feedback.");
      return;
    }

    let recording = recordedBlobRef.current;
    if (!recording) {
      recording = await loadRecording().catch(() => null);
      if (recording) {
        const restoredRecording = recording;
        recordedBlobRef.current = restoredRecording;
        setVideoUrl((current) =>
          current ? current : URL.createObjectURL(restoredRecording),
        );
      }
    }

    if (!recording) {
      setTranscriptError("Record a response before requesting feedback.");
      return;
    }

    if (typeof window !== "undefined" && questionCount > 0) {
      window.sessionStorage.setItem(LAST_QUESTION_KEY, currentQuestion);
      window.sessionStorage.setItem(LAST_CATEGORY_KEY, selectedType);
    }

    setIsTranscribing(true);
    setTranscriptError(null);
    setFeedbackError(null);
    setTechnicalError(null);
    setTranscribeStatus("loading");
    setTechnicalStatus("loading");
    setFeedbackStatus("loading");

    try {
      const file = recording;
      const transcribeForm = new FormData();
      transcribeForm.append("file", file, "interview-practice.webm");
      transcribeForm.append("question", currentQuestion);
      const feedbackForm = new FormData();
      feedbackForm.append("file", file, "interview-practice.webm");

      const parseResponse = async (response: Response) => {
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload?.error ?? "Request failed.");
        }
        return response.json();
      };

      const feedbackPromise = fetch("/api/feedback", {
        method: "POST",
        body: feedbackForm,
      })
        .then(parseResponse)
        .then((data) => ({ ok: true as const, data }))
        .catch((err) => ({ ok: false as const, error: err }));

      let transcriptOk = false;
      let technicalOk = false;
      let feedbackOk = false;
      let transcript = "";
      let transcribeResult: Record<string, unknown> | null = null;
      let technicalPayload: {
        technical_score: number;
        technical_feedback: string[];
      } | null = null;
      let feedbackPayload: Record<string, unknown> | null = null;
      try {
        transcribeResult = await fetch("/api/transcribe", {
          method: "POST",
          body: transcribeForm,
        }).then(parseResponse);
        transcript =
          typeof transcribeResult?.transcript === "string"
            ? transcribeResult.transcript
            : "No transcript returned.";
        if (typeof window !== "undefined") {
          window.sessionStorage.setItem("latestTranscript", transcript);
          const pauseCount =
            typeof transcribeResult?.pause_count === "number"
              ? transcribeResult.pause_count
              : null;
          const fillerCount =
            typeof transcribeResult?.filler_word_count === "number"
              ? transcribeResult.filler_word_count
              : null;
          if (pauseCount !== null || fillerCount !== null) {
            window.sessionStorage.setItem(
              "latestTranscriptStats",
              JSON.stringify(
                {
                  pause_count: pauseCount ?? 0,
                  filler_word_count: fillerCount ?? 0,
                },
                null,
                2,
              ),
            );
          }
          if (typeof transcribeResult?.raw === "string") {
            window.sessionStorage.setItem(
              "latestGeminiRaw",
              transcribeResult.raw,
            );
          } else {
            window.sessionStorage.setItem(
              "latestGeminiRaw",
              JSON.stringify(transcribeResult ?? {}, null, 2),
            );
          }
        }
        transcriptOk = true;
        setTranscribeStatus("success");
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : "Transcription failed. Please try again.";
        setTranscriptError(message);
        setTranscribeStatus("error");
        setTechnicalStatus("error");
      }

      if (transcriptOk) {
        const technicalFromObject =
          typeof transcribeResult?.technical === "object" &&
          transcribeResult.technical !== null
            ? (transcribeResult.technical as Record<string, unknown>)
            : null;
        const technicalScore =
          technicalFromObject &&
          typeof technicalFromObject.technical_score === "number"
            ? technicalFromObject.technical_score
            : typeof transcribeResult?.technical_score === "number"
              ? transcribeResult.technical_score
              : null;
        const technicalFeedback =
          technicalFromObject &&
          Array.isArray(technicalFromObject.technical_feedback)
            ? technicalFromObject.technical_feedback.map((item) => String(item))
            : Array.isArray(transcribeResult?.technical_feedback)
              ? transcribeResult.technical_feedback.map((item) => String(item))
              : null;
        technicalPayload =
          technicalScore !== null && technicalFeedback
            ? {
                technical_score: technicalScore,
                technical_feedback: technicalFeedback,
              }
            : null;
        if (technicalPayload) {
          if (typeof window !== "undefined") {
            window.sessionStorage.setItem(
              "latestTechnical",
              JSON.stringify(technicalPayload, null, 2),
            );
          }
          technicalOk = true;
          setTechnicalStatus("success");
        } else {
          setTechnicalError("Technical scoring missing from transcription.");
          setTechnicalStatus("error");
        }
      }

      const feedbackResult = await feedbackPromise;
      if (!feedbackResult.ok) {
        const message =
          feedbackResult.error instanceof Error
            ? feedbackResult.error.message
            : "Feedback failed. Please try again.";
        setFeedbackError(message);
        setFeedbackStatus("error");
      } else {
        feedbackPayload = feedbackResult.data?.feedback ?? feedbackResult.data;
        if (typeof window !== "undefined") {
          window.sessionStorage.setItem(
            "latestFeedback",
            JSON.stringify(feedbackPayload, null, 2),
          );
          if (typeof feedbackResult.data?.raw === "string") {
            window.sessionStorage.setItem(
              "latestFeedbackRaw",
              feedbackResult.data.raw,
            );
          } else {
            window.sessionStorage.setItem(
              "latestFeedbackRaw",
              JSON.stringify(feedbackResult.data ?? {}, null, 2),
            );
          }
        }
        feedbackOk = true;
        setFeedbackStatus("success");
      }

      if (transcriptOk && technicalOk && feedbackOk) {
        if (typeof window !== "undefined") {
          const confidenceScore =
            typeof feedbackPayload?.confidence_score === "number"
              ? feedbackPayload.confidence_score
              : null;
          const pauseCount =
            typeof transcribeResult?.pause_count === "number"
              ? transcribeResult.pause_count
              : null;
          const fillerCount =
            typeof transcribeResult?.filler_word_count === "number"
              ? transcribeResult.filler_word_count
              : null;
          const historyEntry = {
            timestamp: new Date().toISOString(),
            question: currentQuestion,
            category: selectedType,
            confidence_score: confidenceScore,
            technical_score: technicalPayload?.technical_score ?? null,
            pause_count: pauseCount,
            filler_word_count: fillerCount,
          };
          let history: Array<typeof historyEntry> = [];
          try {
            const stored = window.localStorage.getItem(HISTORY_KEY);
            history = stored ? JSON.parse(stored) : [];
            if (!Array.isArray(history)) {
              history = [];
            }
          } catch {
            history = [];
          }
          history.push(historyEntry);
          if (history.length > HISTORY_LIMIT) {
            history = history.slice(-HISTORY_LIMIT);
          }
          window.localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
        }
        router.push("/feedback");
      }
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Feedback failed. Please try again.";
      setTranscriptError(message);
      setTranscribeStatus("error");
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
      const recorderOptions: MediaRecorderOptions = {
        videoBitsPerSecond: VIDEO_BITS_PER_SECOND,
        audioBitsPerSecond: AUDIO_BITS_PER_SECOND,
      };
      if (mimeType) {
        recorderOptions.mimeType = mimeType;
      }
      const recorder = new MediaRecorder(stream, recorderOptions);
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
          void saveRecording(recordedBlob).catch(() => {});
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
    <div className="flex min-h-screen flex-col bg-[#f6efe6] text-[#1f1a17]">
      <div className="relative flex-1 overflow-hidden">
        <div className="pointer-events-none absolute -top-24 right-0 h-72 w-72 rounded-full bg-[#f7b267]/40 blur-[140px]" />
        <div className="pointer-events-none absolute bottom-0 left-0 h-80 w-80 rounded-full bg-[#7fd1b9]/40 blur-[160px]" />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.8),_rgba(255,255,255,0))]" />

        <Navbar />
        <main className="relative mx-auto flex min-h-[calc(100vh-5rem)] max-w-6xl flex-col items-start justify-center gap-12 px-6 py-16 lg:flex-row lg:items-center lg:gap-16">
          <section className="max-w-xl space-y-6">
            <h1 className="text-4xl font-semibold tracking-tight text-[#1d1612] sm:text-5xl">
              Interview Practice, Enababling Confidence.
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
                    {QUESTION_BANK.map((set) => (
                      <option key={set.category} value={set.category}>
                        {set.category}
                      </option>
                    ))}
                    <option value={CUSTOM_CATEGORY}>Custom</option>
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
                    {isCustom
                      ? "Custom"
                      : questionCount
                        ? `${questionIndex + 1} of ${questionCount}`
                        : "0 of 0"}
                  </span>
                </div>
                {isCustom ? (
                  <div className="mt-3 space-y-2">
                    <label className="text-xs uppercase tracking-[0.25em] text-black/50">
                      Custom prompt
                    </label>
                    <textarea
                      value={customQuestion}
                      onChange={(event) => setCustomQuestion(event.target.value)}
                      disabled={isRecording}
                      placeholder="Type your interview question."
                      rows={3}
                      className="w-full resize-none rounded-2xl border border-black/15 bg-white/80 px-3 py-2 text-sm text-black/80 shadow-sm outline-none transition focus:border-black/40 disabled:cursor-not-allowed disabled:bg-black/5"
                    />
                  </div>
                ) : (
                  <>
                    <p className="mt-3 text-base font-medium text-black/80">
                      {currentQuestion}
                    </p>
                    <div className="mt-4 flex flex-wrap gap-3">
                      <button
                        type="button"
                        onClick={goToPreviousQuestion}
                        disabled={isRecording || questionCount === 0}
                        className="inline-flex cursor-pointer items-center justify-center rounded-full border border-black/15 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-black/60 transition hover:border-black/30 hover:text-black disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Previous question
                      </button>
                      <button
                        type="button"
                        onClick={goToNextQuestion}
                        disabled={isRecording || questionCount === 0}
                        className="inline-flex cursor-pointer items-center justify-center rounded-full border border-black/15 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-black/60 transition hover:border-black/30 hover:text-black disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Next question
                      </button>
                    </div>
                  </>
                )}
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
                      style={{ transform: "scaleX(-1)" }}
                      autoPlay
                      muted
                      playsInline
                    />
                  ) : videoUrl ? (
                    <video
                      key={videoUrl}
                      src={videoUrl}
                      className="h-full w-full object-cover"
                      style={{ transform: "scaleX(-1)" }}
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
                  {feedbackError ? (
                    <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                      {feedbackError}
                    </p>
                  ) : null}
                  {technicalError ? (
                    <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                      {technicalError}
                    </p>
                  ) : null}
                  {showProgressSteps ? (
                    <div className="space-y-3 rounded-2xl border border-black/5 bg-white/70 p-3">
                      {[
                        { label: "Transcribing", status: transcribeStatus },
                        {
                          label: "Technical check",
                          status: technicalStatus,
                        },
                        {
                          label: "Confidence eval",
                          status: feedbackStatus,
                        },
                      ].map((step) => (
                        <div key={step.label} className="space-y-1.5">
                          <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.2em] text-black/45">
                            <span>{step.label}</span>
                            <span>{stepStatusLabel(step.status)}</span>
                          </div>
                          <div className="h-2 w-full overflow-hidden rounded-full bg-black/10">
                            {step.status === "loading" ? (
                              <div className="loading-bar-runner h-full w-1/2 rounded-full bg-gradient-to-r from-[#f7b267] via-[#f29f4b] to-[#f7b267]" />
                            ) : (
                              <div
                                className={`h-full rounded-full ${
                                  step.status === "success"
                                    ? "bg-emerald-500"
                                    : step.status === "error"
                                      ? "bg-red-400"
                                      : "bg-black/20"
                                }`}
                                style={{
                                  width:
                                    step.status === "idle" ? "25%" : "100%",
                                }}
                              />
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>

                <div className="flex flex-wrap gap-3">
                  {!videoUrl && !isPreviewing && !isRecording ? (
                    <button
                      type="button"
                      onClick={startPreview}
                      disabled={!isSupported}
                      className="inline-flex cursor-pointer items-center justify-center rounded-full border border-black/15 px-5 py-2.5 text-sm font-medium text-black/70 transition hover:border-black/30 hover:text-black disabled:cursor-not-allowed disabled:opacity-40"
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
                    className={`inline-flex cursor-pointer items-center justify-center rounded-full px-5 py-2.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
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
                      onClick={resetRecording}
                      className="inline-flex cursor-pointer items-center justify-center rounded-full border border-red-200 bg-red-50 px-5 py-2.5 text-sm font-medium text-red-700 transition hover:border-red-300 hover:text-red-800"
                    >
                      Delete clip
                    </button>
                  ) : null}
                  {videoUrl ? (
                    <button
                      type="button"
                      onClick={transcribeRecording}
                      disabled={isTranscribing}
                      className="inline-flex cursor-pointer items-center justify-center rounded-full bg-[#f7b267] px-5 py-2.5 text-sm font-semibold text-[#1f1a17] shadow-[0_12px_24px_rgba(247,178,103,0.35)] transition hover:bg-[#f29f4b] disabled:cursor-not-allowed disabled:opacity-50"
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
      <Footer />
    </div>
  );
}
