import type { LeadStatus } from "@/generated/prisma/enums";

export const leadStatusLabel: Record<LeadStatus, string> = {
  NEW: "Not researched",
  RESEARCHING: "Researching",
  READY: "Brief ready",
  ARCHIVED: "Archived",
};

export const leadStatusTone: Record<LeadStatus, "neutral" | "brand" | "dark"> = {
  NEW: "neutral",
  RESEARCHING: "brand",
  READY: "dark",
  ARCHIVED: "neutral",
};

export const fullName = (lead: { firstName: string; lastName: string | null }) =>
  [lead.firstName, lead.lastName].filter(Boolean).join(" ");

// The timestamp changes the address when the picture is replaced, so browsers do not keep the old one.
export const leadPhotoUrl = (leadId: string, fetchedAt: Date) => `/api/leads/${leadId}/photo?v=${fetchedAt.getTime()}`;
