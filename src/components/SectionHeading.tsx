import type { ReactNode } from "react";

/**
 * Punchy section headline with a small green accent bar anchor.
 * Purely presentational — shared so every screen's sections match.
 */
export function SectionHeading({
  children,
  size = "md",
  className = "",
}: {
  children: ReactNode;
  size?: "md" | "lg";
  className?: string;
}) {
  return (
    <h2 className={`flex items-center gap-2 ${className}`}>
      <span
        aria-hidden="true"
        className="h-[18px] w-[3px] shrink-0 rounded-full bg-primary"
      />
      <span
        className={`font-bold tracking-[-0.02em] text-foreground ${
          size === "lg" ? "text-xl" : "text-lg"
        }`}
      >
        {children}
      </span>
    </h2>
  );
}
