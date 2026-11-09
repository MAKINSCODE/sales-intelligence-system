import { z } from "zod";
import { cleanText } from "@/lib/research/policy";

// Pasted text can carry NUL and other control characters, which the database refuses and which would fail the save.
const text = z.string().transform(cleanText);

const optional = (max: number) =>
  text
    .pipe(z.string().trim().max(max))
    .optional()
    .transform((v) => (v ? v : undefined));

const optionalUrl = text
  .pipe(z.string().trim().max(500))
  .optional()
  .transform((v) => (v ? v : undefined))
  .refine((v) => {
    if (!v) return true;
    try {
      const url = new URL(v);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  }, "Enter a full link starting with https://");

export const leadSchema = z.object({
  firstName: text.pipe(z.string().trim().min(1, "First name is required").max(100)),
  lastName: text.pipe(z.string().trim().min(1, "Surname is required").max(100)),
  company: optional(200),
  jobTitle: optional(200),
  profileUrl: optionalUrl,
  email: optional(254).refine((v) => !v || z.email().safeParse(v).success, "Enter a valid email address"),
  country: optional(100),
  enquiryText: optional(5000),
  notes: optional(2000),
});

export type LeadInput = z.infer<typeof leadSchema>;
export type LeadFieldErrors = Partial<Record<keyof LeadInput, string>>;
