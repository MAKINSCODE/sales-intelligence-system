import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseCatalogue } from "./parse";

const real = readFileSync("docs/our_company.yaml", "utf8");

describe("parseCatalogue", () => {
  it("parses the company profile and reads approval metadata", () => {
    const r = parseCatalogue(real);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.meta.approved).toBe(true);
    expect(r.meta.approvedBy).toBe("Alex Johnson");
    expect(r.meta.version).toBe("0.1-approved");
    expect(r.meta.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.data.company.name).toBe("Acme");
  });

  it("builds solutions from services, case-study agents and accelerators", () => {
    const r = parseCatalogue(real);
    if (!r.ok) throw new Error("expected ok");
    const kinds = new Set(r.data.solutions.map((s) => s.kind));
    expect(kinds).toEqual(new Set(["service", "agent_case_study"]));
    const sales = r.data.solutions.find((s) => s.name === "SalesPro AI Agent");
    expect(sales?.businessFunction).toBe("Sales");
    expect(sales?.claims.length).toBeGreaterThan(0);
  });

  it("excludes items flagged needs_owner_check instead of asserting them", () => {
    const r = parseCatalogue(real);
    if (!r.ok) throw new Error("expected ok");
    expect(r.data.solutions.find((s) => s.id === "managed_support")).toBeUndefined();
    expect(r.data.excluded.map((e) => e.name)).toContain("Managed Support Desk");
  });

  it("keeps the owner's handling rules", () => {
    const r = parseCatalogue(real);
    if (!r.ok) throw new Error("expected ok");
    expect(r.data.handlingRules.join(" ")).toContain("Acme reports");
  });

  it("hashes identical content identically and different content differently", () => {
    const a = parseCatalogue(real);
    const b = parseCatalogue(real.replace(/\n/g, "\r\n"));
    const c = parseCatalogue(real.replace("0.1-approved", "0.2"));
    if (!a.ok || !b.ok || !c.ok) throw new Error("expected ok");
    expect(a.meta.contentHash).toBe(b.meta.contentHash);
    expect(a.meta.contentHash).not.toBe(c.meta.contentHash);
  });

  it("reports an unapproved profile as unapproved", () => {
    const r = parseCatalogue(real.replace(/^approved: true/m, "approved: false"));
    expect(r.ok && r.meta.approved).toBe(false);
  });

  it("rejects invalid YAML, missing fields and empty catalogues with clear errors", () => {
    expect(parseCatalogue("a: [unclosed")).toMatchObject({ ok: false });
    const missing = parseCatalogue("company:\n  name: X\n");
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.errors.join(" ")).toContain("approved");
    const empty = parseCatalogue("approved: true\ncompany:\n  name: X\n");
    expect(empty).toMatchObject({ ok: false });
    if (!empty.ok) expect(empty.errors[0]).toContain("No usable solutions");
  });
});
