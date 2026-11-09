import "server-only";
import { db } from "@/lib/db";
import { parseCatalogue, type CatalogueData } from "@/lib/catalogue/parse";

export type ImportOutcome =
  | { ok: true; version: string; solutions: number; excluded: number; alreadyActive: boolean }
  | { ok: false; errors: string[] };

// Only an owner-approved profile may ever become active; nothing else is stored.
export async function importCatalogue(source: string): Promise<ImportOutcome> {
  const parsed = parseCatalogue(source);
  if (!parsed.ok) return parsed;

  const { meta, data } = parsed;
  if (!meta.approved) {
    return {
      ok: false,
      errors: ["This profile is not approved (`approved: false`). Set approved, approved_by and approved_on before importing."],
    };
  }
  if (!meta.approvedBy) {
    return { ok: false, errors: ["`approved_by` is missing, so the approval cannot be attributed."] };
  }

  const existing = await db.companyCatalogue.findUnique({ where: { contentHash: meta.contentHash } });
  if (existing?.isActive) {
    return { ok: true, version: meta.version, solutions: data.solutions.length, excluded: data.excluded.length, alreadyActive: true };
  }

  await db.$transaction(async (tx) => {
    await tx.companyCatalogue.updateMany({ where: { isActive: true }, data: { isActive: false } });
    const fields = {
      version: meta.version,
      approved: true,
      approvedBy: meta.approvedBy,
      approvedOn: meta.approvedOn,
      isActive: true,
      data: data as object,
    };
    if (existing) await tx.companyCatalogue.update({ where: { id: existing.id }, data: fields });
    else await tx.companyCatalogue.create({ data: { ...fields, contentHash: meta.contentHash } });
  });

  return { ok: true, version: meta.version, solutions: data.solutions.length, excluded: data.excluded.length, alreadyActive: false };
}

export async function getActiveCatalogue() {
  const row = await db.companyCatalogue.findFirst({ where: { isActive: true, approved: true } });
  if (!row) return null;
  return { ...row, data: row.data as unknown as CatalogueData };
}
