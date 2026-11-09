import { describe, expect, it, vi } from "vitest";
import { hasUnattributedFigure, synthesize, validateSynthesis, type Synthesis } from "./synthesis";

const catalogue = {
  solutions: [
    { id: "salespro", kind: "agent_case_study" as const, name: "SalesPro AI Agent", summary: "Builds client profiles", claims: [] },
    { id: "hts", kind: "accelerator" as const, name: "HTS Classification Agent", summary: "Tariff codes", claims: [] },
  ],
};

type Trigger = Synthesis["triggers"][number];
type Angle = NonNullable<Synthesis["angle"]>;

const trigger = (over: Partial<Trigger> = {}): Trigger => ({
  type: "observed",
  what: "The bureau published a new cooling regulation in March.",
  soWhat: "Compliance workload is about to rise, which is where an agent can take repetitive work.",
  basisClaimIds: ["c1"],
  solutionId: "salespro",
  whyRelevant: "It automates profile building.",
  ...over,
});

const angle = (over: Partial<Angle> = {}): Angle => ({
  headline: "A new regulation is adding workload that an agent can absorb.",
  insight: "The bureau just issued a regulation and is hiring for AI roles, so it is likely to buy capacity.",
  basisClaimIds: ["c1"],
  solutionId: "salespro",
  whyRelevant: "It automates profile building.",
  objection: "They may build in-house; offer a scoped pilot.",
  ...over,
});

const base = (over: Partial<Synthesis> = {}): Synthesis => ({
  angle: angle(),
  triggers: [trigger()],
  gaps: ["Who owns the decision"],
  ...over,
});

describe("hasUnattributedFigure", () => {
  it("flags performance claims unless attributed to Acme", () => {
    expect(hasUnattributedFigure("It delivers 75% higher conversion")).toBe(true);
    expect(hasUnattributedFigure("3x more cross-sells")).toBe(true);
    expect(hasUnattributedFigure("Acme reports 75% higher conversion")).toBe(false);
    expect(hasUnattributedFigure("They run 5 offices")).toBe(false);
  });
});

describe("validateSynthesis", () => {
  it("keeps a well-grounded angle and trigger and resolves the solution name", () => {
    const out = validateSynthesis(base(), new Set(["c1"]), catalogue);
    expect(out.angle).toMatchObject({ solutionName: "SalesPro AI Agent", objection: expect.stringContaining("in-house") });
    expect(out.triggers).toHaveLength(1);
    expect(out.triggers[0].solutionName).toBe("SalesPro AI Agent");
    expect(out.rejected).toEqual([]);
  });

  it("rejects an angle and triggers that cite no real evidence", () => {
    const out = validateSynthesis(base({ angle: angle({ basisClaimIds: ["made-up"] }), triggers: [trigger({ basisClaimIds: ["made-up"] }), trigger({ basisClaimIds: [] })] }), new Set(["c1"]), catalogue);
    expect(out.angle).toBeNull();
    expect(out.triggers).toHaveLength(0);
    expect(out.rejected).toHaveLength(3);
  });

  it("keeps only the valid evidence ids", () => {
    const out = validateSynthesis(base({ triggers: [trigger({ basisClaimIds: ["c1", "ghost", "c1"] })] }), new Set(["c1"]), catalogue);
    expect(out.triggers[0].basisClaimIds).toEqual(["c1"]);
  });

  it("nulls a solution that is not in the approved catalogue", () => {
    const out = validateSynthesis(base({ triggers: [trigger({ solutionId: "invented-agent" })] }), new Set(["c1"]), catalogue);
    expect(out.triggers[0]).toMatchObject({ solutionId: null, solutionName: null, whyRelevant: null });
    expect(out.rejected.join()).toContain("invented-agent");
  });

  it("recommends no solution at all when there is no approved catalogue", () => {
    const out = validateSynthesis(base(), new Set(["c1"]), null);
    expect(out.angle?.solutionId).toBeNull();
    expect(out.triggers[0].solutionId).toBeNull();
  });

  it("drops angles, triggers and gaps that carry unattributed figures", () => {
    const out = validateSynthesis(
      base({
        angle: angle({ insight: "Our agent gives 90% accuracy." }),
        triggers: [trigger({ soWhat: "Teams see 3x output." })],
        gaps: ["Whether 50% of staff are remote", "Who owns the budget"],
      }),
      new Set(["c1"]),
      catalogue,
    );
    expect(out.angle).toBeNull();
    expect(out.triggers).toHaveLength(0);
    expect(out.gaps).toEqual(["Who owns the budget"]);
  });

  it("still returns the rest when the model finds no angle", () => {
    const out = validateSynthesis(base({ angle: null }), new Set(["c1"]), catalogue);
    expect(out.angle).toBeNull();
    expect(out.triggers).toHaveLength(1);
  });
});

describe("synthesize", () => {
  it("shows the model the evidence, known gaps and catalogue ids, and validates the answer", async () => {
    const structured = vi.fn().mockResolvedValue({ value: base(), inputTokens: 1, outputTokens: 1 });
    const out = await synthesize({ person: "James Harrison", basis: [{ id: "c1", label: "News", text: "Launched an urban transit initiative" }], catalogue, gaps: ["Yearly revenue could not be found in public sources."] }, { structured });
    const prompt = structured.mock.calls[0][0].input as string;
    expect(prompt).toContain("[c1] (News) Launched an urban transit initiative");
    expect(prompt).toContain("id: salespro");
    expect(prompt).toContain("Yearly revenue could not be found");
    expect(out.triggers).toHaveLength(1);
  });

  it("tells the model what Acme does when the catalogue describes the company", async () => {
    const structured = vi.fn().mockResolvedValue({ value: base(), inputTokens: 1, outputTokens: 1 });
    await synthesize({ person: "X", basis: [{ id: "c1", label: "a", text: "b" }], catalogue: { ...catalogue, company: { name: "Acme", oneLine: "Builds AI agents for operations" }, differentiators: ["Forward deployed engineers"] } }, { structured });
    expect(structured.mock.calls[0][0].input).toContain("About Acme: Builds AI agents for operations");
  });

  it("tells the model not to recommend solutions without an approved catalogue", async () => {
    const structured = vi.fn().mockResolvedValue({ value: base(), inputTokens: 1, outputTokens: 1 });
    await synthesize({ person: "X", basis: [{ id: "c1", label: "a", text: "b" }], catalogue: null }, { structured });
    expect(structured.mock.calls[0][0].input).toContain("No approved Acme catalogue");
  });
});
