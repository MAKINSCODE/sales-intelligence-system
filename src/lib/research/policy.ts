export const GENERIC_MAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.uk", "outlook.com", "hotmail.com", "hotmail.co.uk", "live.com", "icloud.com",
  "me.com", "aol.com", "proton.me", "protonmail.com", "gmx.com", "mail.com", "yandex.com", "zoho.com", "msn.com",
]);

const SHARED_MAILBOXES = new Set([
  "it", "info", "admin", "office", "hello", "contact", "sales", "support", "enquiries", "inquiries", "team", "mail", "accounts", "hr", "noreply", "no-reply",
]);

export type EmailHint = {
  organisationDomain: string | null;
  sharedMailbox: boolean;
  localPart: string | null;
};

// An address hints at an organisation; it never proves a person's employer or title.
export function emailHint(email: string | null | undefined): EmailHint {
  const match = email?.trim().toLowerCase().match(/^([^@\s]+)@([^@\s]+\.[^@\s]+)$/);
  if (!match) return { organisationDomain: null, sharedMailbox: false, localPart: null };
  const [, local, domain] = match;
  return {
    organisationDomain: GENERIC_MAIL_DOMAINS.has(domain) ? null : domain,
    sharedMailbox: SHARED_MAILBOXES.has(local),
    localPart: local,
  };
}

// LinkedIn is never fetched or scraped; its search-result snippets may be read as-is.
const NEVER_FETCH = ["linkedin.com", "lnkd.in"];

export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function isLinkedIn(url: string) {
  const host = hostOf(url);
  return !!host && NEVER_FETCH.some((d) => host === d || host.endsWith(`.${d}`));
}

export function isFetchable(url: string) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
  if (isLinkedIn(url)) return false;
  const host = parsed.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return false;
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(host) || host.includes(":")) return false;
  return true;
}

const fold = (s: string) =>
  s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u2018\u2019\u201a\u201b]/g, "'")
    .replace(/[\u201c\u201d\u201e\u201f]/g, '"')
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/\s+/g, " ")
    .trim();

// A quoted passage must appear in the retained source text, ignoring case, spacing and typographic punctuation.
export function quoteSupported(quote: string | null | undefined, sourceText: string | null | undefined): boolean {
  if (!quote || !sourceText) return false;
  const parts = fold(quote)
    .split(/\.\.\.|\u2026/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0 || parts.some((p) => p.length < 12)) return false;
  const haystack = fold(sourceText);
  return parts.every((p) => haystack.includes(p));
}

// Text from the web can hold characters the database or JSON cannot store (NUL, lone surrogates), which would fail a whole run.
export const cleanText = (s: string) => s.toWellFormed().replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");

// Bounds and tidies a value before it is placed in a search query: no quote characters that would break a phrase.
export const searchTerm = (s: string, max = 120) => s.replace(/["\u201c\u201d\u201e\u201f]/g, " ").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

export function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

const FILLER = new Set(["the", "of", "and", "for", "a", "an", "in", "at", "ltd", "limited", "llc", "inc", "plc", "gmbh", "corp", "corporation", "co", "company", "sa", "ag", "bv", "srl", "spa", "pty", "llp"]);

const wordsOf = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

const distinctive = (name: string) => wordsOf(name).filter((w) => w.length > 1 && !FILLER.has(w));

export type Subject = { names: string[]; domains: string[] };

// A news item is only about a subject when it actually names it: every distinctive word of the name
// as a whole word, or the organisation's own domain. A shared sector or topic is not enough.
export function mentionsSubject(text: string, url: string, subject: Subject): boolean {
  const words = new Set(wordsOf(text));
  const host = hostOf(url);
  const lower = text.toLowerCase();
  const squashed = wordsOf(text).join("");
  for (const d of subject.domains.map((x) => x.toLowerCase())) {
    if ((host && (host === d || host.endsWith(`.${d}`))) || lower.includes(d)) return true;
    // A domain like "citybureau.example.gov" may be referenced in prose by just its label; short labels are too generic to trust.
    const label = d.split(".")[0];
    if (label.length >= 6 && squashed.includes(label)) return true;
  }
  return subject.names.some((n) => {
    const w = distinctive(n);
    return w.length > 0 && w.every((x) => words.has(x));
  });
}

// The public identifier in a profile URL, e.g. "nickbennett05" from linkedin.com/in/nickbennett05/.
export function linkedinProfileId(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.trim());
    if (!isLinkedIn(u.toString())) return null;
    const m = u.pathname.match(/^\/in\/([^/?#]+)/i);
    if (!m) return null;
    const id = decodeURIComponent(m[1]).normalize("NFC").toLowerCase();
    return id.length >= 2 ? id : null;
  } catch {
    return null;
  }
}

export const canonicalProfileUrl = (id: string) => `https://www.linkedin.com/in/${encodeURIComponent(id)}`;

// Only posts the profile itself wrote are kept; reposts of other people's content and any other author are discarded.
export function keepOwnPosts<T extends { authorId: string | null; isRepost: boolean }>(posts: T[], profileId: string) {
  const id = profileId.normalize("NFC").toLowerCase();
  const kept = posts.filter((p) => !p.isRepost && p.authorId?.normalize("NFC").toLowerCase() === id);
  return { kept, rejected: posts.length - kept.length };
}
