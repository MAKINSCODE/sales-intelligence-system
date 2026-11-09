"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/session";
import { importCatalogue } from "@/lib/catalogue/service";

export type ImportState = { status: "idle" | "ok" | "error"; message?: string; errors?: string[] };

const MAX_BYTES = 1_000_000;

export async function importCatalogueAction(_prev: ImportState, formData: FormData): Promise<ImportState> {
  await requireAdmin();

  const file = formData.get("file");
  const pasted = String(formData.get("text") ?? "").trim();
  let source = pasted;
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_BYTES) return { status: "error", errors: ["That file is larger than 1 MB."] };
    source = await file.text();
  }
  if (!source.trim()) return { status: "error", errors: ["Choose a YAML file or paste its contents."] };

  const outcome = await importCatalogue(source);
  if (!outcome.ok) return { status: "error", errors: outcome.errors };

  revalidatePath("/reference");
  return {
    status: "ok",
    message: outcome.alreadyActive
      ? `Version ${outcome.version} is already active.`
      : `Imported version ${outcome.version}: ${outcome.solutions} solutions available, ${outcome.excluded} held back.`,
  };
}
