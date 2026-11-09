import { describe, expect, it } from "vitest";
import { cleanText, emailHint, hostOf, isFetchable, isLinkedIn, parseDate, quoteSupported, searchTerm } from "./policy";

describe("emailHint", () => {
  it("derives an organisation from a work domain but not from webmail", () => {
    expect(emailHint("james.harrison@citybureau.example.gov").organisationDomain).toBe("citybureau.example.gov");
    expect(emailHint("someone@Gmail.com").organisationDomain).toBeNull();
  });

  it("flags shared mailboxes so they are not mistaken for a person", () => {
    expect(emailHint("it@example-motors.com")).toMatchObject({ organisationDomain: "example-motors.com", sharedMailbox: true });
    expect(emailHint("james@example.com").sharedMailbox).toBe(false);
  });

  it("tolerates missing or malformed input", () => {
    expect(emailHint(null).organisationDomain).toBeNull();
    expect(emailHint("not-an-email").organisationDomain).toBeNull();
  });
});

describe("fetch policy", () => {
  it("never fetches LinkedIn, including subdomains and short links", () => {
    for (const u of ["https://www.linkedin.com/in/x", "https://ae.linkedin.com/in/y", "https://lnkd.in/abc"]) {
      expect(isLinkedIn(u)).toBe(true);
      expect(isFetchable(u)).toBe(false);
    }
    expect(isLinkedIn("https://notlinkedin.com/x")).toBe(false);
  });

  it("only fetches public http(s) hosts", () => {
    expect(isFetchable("https://citybureau.example.gov/about")).toBe(true);
    for (const u of ["file:///etc/passwd", "javascript:alert(1)", "http://localhost:3000", "http://127.0.0.1/admin", "http://169.254.169.254/", "https://svc.internal/x", "http://[::1]/", "not a url"]) {
      expect(isFetchable(u)).toBe(false);
    }
  });

  it("normalises hosts", () => {
    expect(hostOf("https://WWW.Example.com/a")).toBe("example.com");
    expect(hostOf("nope")).toBeNull();
  });
});

describe("quoteSupported", () => {
  const source = “James Harrison has served as Chief Executive at City Bureau since “2019”.  Previously he led Operations.”;

  it("accepts a quote that appears verbatim, ignoring case, spacing and curly quotes", () => {
    expect(quoteSupported("served as chief executive at City Bureau", source)).toBe(true);
    expect(quoteSupported('since "2019". Previously he led', source)).toBe(true);
  });

  it("accepts fragments joined by an ellipsis only when each appears", () => {
    expect(quoteSupported("served as Chief Executive at City Bureau ... Previously he led Operations", source)).toBe(true);
    expect(quoteSupported("served as Chief Executive at City Bureau ... and founded a startup in 2010", source)).toBe(false);
  });

  it("rejects invented, paraphrased, empty or too-short quotes", () => {
    expect(quoteSupported("is the founder of a unicorn company", source)).toBe(false);
    expect(quoteSupported("Chief Exec", source)).toBe(false);
    expect(quoteSupported("", source)).toBe(false);
    expect(quoteSupported(null, source)).toBe(false);
    expect(quoteSupported("served as Chief Executive", null)).toBe(false);
  });
});

describe("parseDate", () => {
  it("parses valid dates and rejects garbage", () => {
    expect(parseDate("2026-03-01")?.getUTCFullYear()).toBe(2026);
    expect(parseDate("sometime last week")).toBeNull();
    expect(parseDate(null)).toBeNull();
  });
});

describe("values placed in search queries and stored text", () => {
  it("searchTerm removes quote characters, control characters and runaway length", () => {
    expect(searchTerm('John "JJ" Smith')).toBe("John JJ Smith");
    expect(searchTerm("\u201cSmart\u201d  Co\nLtd")).toBe("Smart Co Ltd");
    expect(searchTerm("x".repeat(500))).toHaveLength(120);
    expect(searchTerm('""')).toBe("");
  });

  it("cleanText removes NUL and other control characters but keeps line breaks and tabs", () => {
    expect(cleanText("a\u0000b\u0007c\td\ne\r\nf")).toBe("abc\td\ne\r\nf");
  });

  it("cleanText repairs lone surrogates that would be rejected as JSON", () => {
    const out = cleanText("ok \ud800 end");
    expect(() => JSON.parse(JSON.stringify({ out }))).not.toThrow();
    expect(out).toBe("ok \ufffd end");
    expect(cleanText("\ud83d\ude00 smile")).toBe("\ud83d\ude00 smile");
  });
});
