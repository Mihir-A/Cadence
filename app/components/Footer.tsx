"use client";

export default function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="border-t border-black/10 bg-white/60">
      <div className="mx-auto w-full max-w-6xl px-6 py-8 text-sm text-black/60">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
              <span className="uppercase tracking-[0.2em] text-black/40">
                Built by
              </span>
              <a
                href="https://mihirdev.com/"
                target="_blank"
                rel="noreferrer"
                className="font-medium text-black/70 transition hover:text-black"
              >
                Mihir
              </a>
              <span aria-hidden="true">•</span>
              <a
                href="https://www.linkedin.com/in/alexander-peroulas/"
                target="_blank"
                rel="noreferrer"
                className="font-medium text-black/70 transition hover:text-black"
              >
                Alex
              </a>
              <span aria-hidden="true">•</span>
              <a
                href="https://www.linkedin.com/in/carrie-ma-65a911363/"
                target="_blank"
                rel="noreferrer"
                className="font-medium text-black/70 transition hover:text-black"
              >
                Carrie
              </a>
              <span aria-hidden="true">•</span>
              <a
                href="https://www.linkedin.com/in/vishwath-shankar-05540324a/"
                target="_blank"
                rel="noreferrer"
                className="font-medium text-black/70 transition hover:text-black"
              >
                Vish
              </a>
            </div>

            <p className="text-xs text-black/50">
              Your camera + mic run locally in your browser. Feedback is
              AI-generated and may be imperfect.
            </p>
          </div>

          <p className="text-black/40 sm:text-right">
            © {currentYear} Cadence. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
