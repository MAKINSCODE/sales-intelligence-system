import { describe, expect, it } from "vitest";
import { leadSchema } from "./leads";

const base = { firstName: "James", lastName: "Harrison", company: "", jobTitle: "", profileUrl: "", email: "", country: "", enquiryText: "", notes: "" };

describe("leadSchema with pasted text", () => {
  it("requires a surname", () => {
    expect(leadSchema.safeParse({ ...base, lastName: "  " }).success).toBe(false);
  });

  it("removes NUL and control characters the database would refuse", () => {
    const r = leadSchema.parse({ ...base, firstName: "Jam\u0000es", company: "City\u0007 Bureau", notes: "a\u0000b" });
    expect(r).toMatchObject({ firstName: "James", company: "City Bureau", notes: "ab" });
  });

  it("keeps line breaks and tabs in a pasted enquiry", () => {
    expect(leadSchema.parse({ ...base, enquiryText: "Line one\r\nLine two\tend" }).enquiryText).toBe("Line one\r\nLine two\tend");
  });

  it("does not accept a first name that is nothing but control characters", () => {
    expect(leadSchema.safeParse({ ...base, firstName: "\u0000\u0000 " }).success).toBe(false);
  });

  it("repairs a lone surrogate from a bad paste instead of failing the save", () => {
    const r = leadSchema.parse({ ...base, company: "Acme \ud800" });
    expect(() => JSON.stringify(r)).not.toThrow();
    expect(r.company).toBe("Acme \ufffd");
  });

  it("still enforces length limits and the link format", () => {
    expect(leadSchema.safeParse({ ...base, firstName: "x".repeat(101) }).success).toBe(false);
    expect(leadSchema.safeParse({ ...base, profileUrl: "javascript:alert(1)" }).success).toBe(false);
  });

  it("accepts names in other scripts", () => {
    const r = leadSchema.parse({ ...base, firstName: "علي", lastName: "محمد", company: "مؤسسة التقنية" });
    expect(r.lastName).toBe("محمد");
  });
});
