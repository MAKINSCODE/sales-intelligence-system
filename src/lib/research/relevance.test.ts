import { describe, expect, it } from "vitest";
import { mentionsSubject } from "./policy";

const cb = { names: ["City Bureau", "City Transit Bureau"], domains: ["citybureau.example.gov"] };

describe("mentionsSubject", () => {
  it("accepts news that names the organisation in full", () => {
    expect(mentionsSubject("The City Bureau launched a new transit rule", "https://news.example/a", cb)).toBe(true);
    expect(mentionsSubject("City Transit Bureau publishes tariff review", "https://news.example/b", cb)).toBe(true);
  });

  it("accepts the organisation's own domain even without its name in the text", () => {
    expect(mentionsSubject("New consultation open", "https://www.citybureau.example.gov/news/1", cb)).toBe(true);
    expect(mentionsSubject("see citybureau.example.gov for details", "https://other.example/x", cb)).toBe(true);
  });

  it("rejects same-sector news about different organisations", () => {
    expect(mentionsSubject("The Board will announce regulatory changes to improve transit", "https://x.example/1", cb)).toBe(false);
    expect(mentionsSubject("Department of Transport published commuter rules", "https://x.example/2", cb)).toBe(false);
    expect(mentionsSubject("Joint proposal on transit and examination", "https://x.example/3", cb)).toBe(false);
  });

  it("requires every distinctive word, as whole words", () => {
    expect(mentionsSubject("The City announced rules", "https://x.example/1", cb)).toBe(false);
    expect(mentionsSubject("CBs across the region", "https://x.example/2", { names: ["CB"], domains: [] })).toBe(false);
  });

  it("ignores accents, case and legal suffixes", () => {
    expect(mentionsSubject("ACME announces results", "https://x.example/1", { names: ["Acmé Ltd"], domains: [] })).toBe(true);
  });

  it("matches a person only by their full name", () => {
    const p = { names: ["James Harrison"], domains: [] };
    expect(mentionsSubject("James Harrison spoke at the summit", "https://x.example/1", p)).toBe(true);
    expect(mentionsSubject("James spoke at the summit", "https://x.example/2", p)).toBe(false);
  });

  it("matches a domain-only organisation by its name as written in prose", () => {
    const domainOnly = { names: [], domains: ["citybureau.example.gov"] };
    expect(mentionsSubject("City Bureau launched an urban transit initiative", "https://news.example/a", domainOnly)).toBe(true);
    expect(mentionsSubject("Global Motors Corp opens a showroom", "https://news.example/b", { names: [], domains: ["globalmotors.example.com"] })).toBe(true);
  });

  it("does not let short or generic domain labels match by accident", () => {
    expect(mentionsSubject("The Transit Authority published rules", "https://news.example/a", { names: [], domains: ["citybureau.example.gov"] })).toBe(false);
    expect(mentionsSubject("Acme Corp results, acme everywhere", "https://news.example/b", { names: [], domains: ["acme.co.uk"] })).toBe(false);
    expect(mentionsSubject("Transit bureau publishes city notice", "https://news.example/c", { names: [], domains: ["citybureau.example.gov"] })).toBe(false);
  });

  it("never matches an empty subject", () => {
    expect(mentionsSubject("anything", "https://x.example/1", { names: [], domains: [] })).toBe(false);
    expect(mentionsSubject("anything", "https://x.example/1", { names: ["The Co"], domains: [] })).toBe(false);
  });
});
