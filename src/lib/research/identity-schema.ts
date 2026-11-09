import { z } from "zod";

const text = z.string();
const nullableText = z.string().nullable();

export const candidateSchema = z.object({
  name: text,
  headline: nullableText.describe("Role and organisation exactly as the source states them"),
  location: nullableText,
  matches: z.array(text).describe("Details from the lead input that this source supports"),
  mismatches: z.array(text).describe("Details from the lead input that this source contradicts or fails to support"),
  sourceIds: z.array(text).describe("ids of the search results this candidate is based on"),
  quote: nullableText.describe("One short verbatim passage from a result that places this person; null if none"),
});

export const identityResultSchema = z.object({
  candidates: z.array(candidateSchema).max(5),
  needsMoreInfo: z.boolean().describe("True when the input is too thin to separate people with the same name"),
  note: nullableText,
});

export type IdentityResult = z.infer<typeof identityResultSchema>;

export const IDENTITY_INSTRUCTIONS = `You help identify which real person a sales lead refers to, using only the supplied search results.
Rules:
- Use only the search results given. Never use outside knowledge or guess.
- Group results that clearly describe the same person into one candidate. Different people with the same name must be separate candidates.
- Be conservative. Matching only a name is not enough for a confident match. List supported and unsupported details of the lead input separately.
- The lead's email address hints at an organisation only. It does not prove employment or job title.
- A shared mailbox or an incomplete name is not a person; if the input cannot identify an individual, return no candidate for that person and set needsMoreInfo true.
- Quote a short passage verbatim from a result when you can; otherwise use null.
- Do not include candidates unsupported by any result.`;
