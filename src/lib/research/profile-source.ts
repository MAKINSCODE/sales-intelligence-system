import type { ProfileForm } from "@/lib/team/profile";
import { memberText } from "./team-fit";

// A collected LinkedIn profile written out as text, so career details are extracted from it and quote-checked like any other source.
export function profileSourceText(p: ProfileForm): string {
  const current = p.employment.find((e) => e.end === "present") ?? p.employment[0];
  const line = current ? `Current role: ${current.title ? `${current.title} at ` : ""}${current.organisation}${current.start ? ` (from ${current.start})` : ""}` : null;
  return [line, memberText(p)].filter((x): x is string => !!x).join("\n");
}
