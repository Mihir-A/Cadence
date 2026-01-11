"use client";

import Link from "next/link";

type NavbarProps = {
  maxWidthClass?: string;
  logoSizeClass?: string;
};

const navItems = [
  { label: "Practice", href: "/" },
  { label: "Feedback", href: "/feedback" },
  { label: "History", href: "/feedback#history" },
];

export default function Navbar({
  maxWidthClass = "max-w-6xl",
  logoSizeClass = "h-16",
}: NavbarProps) {
  return (
    <header className="relative">
      <div
        className={`mx-auto flex w-full items-center justify-between gap-6 px-6 pt-10 ${maxWidthClass}`}
      >
        <Link href="/" className="inline-flex items-center">
          <img
            src="/cadencelogo.png"
            alt="Cadence"
            className={`${logoSizeClass} w-auto`}
          />
        </Link>
        <nav className="flex flex-wrap items-center gap-4 text-xs font-semibold uppercase tracking-[0.2em] text-black/50">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="transition hover:text-black/80"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
