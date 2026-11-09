"use client";

import { useSyncExternalStore } from "react";

type Variant = "date" | "dateTime";

const OPTIONS: Record<Variant, Intl.DateTimeFormatOptions> = {
  date: { day: "numeric", month: "short", year: "numeric" },
  dateTime: { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" },
};

const format = (iso: string, variant: Variant, timeZone?: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-GB", { ...OPTIONS[variant], timeZone });
};

const subscribe = () => () => undefined;

// Shown in the reader's own time zone. The server has no way to know it, so the server render uses UTC (marked)
// and the browser replaces it, instead of two time zones disagreeing during hydration.
export function LocalTime({ iso, variant = "date" }: { iso: string; variant?: Variant }) {
  const text = useSyncExternalStore(
    subscribe,
    () => format(iso, variant),
    () => `${format(iso, variant, "UTC")}${variant === "dateTime" ? " UTC" : ""}`,
  );
  return <time dateTime={iso}>{text}</time>;
}
