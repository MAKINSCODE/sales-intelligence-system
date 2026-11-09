import { findConnections, type Connection } from "./connections";
import type { ProfileFacts } from "./evidence";
import { matchKeywords } from "@/lib/qualification/rules";
import type { ProfileForm } from "@/lib/team/profile";

export type Member = { id: string; name: string; linkedinUrl: string; profile: ProfileForm };

export type Link = {
  kind: Connection["kind"] | "interest";
  title: string;
  detail: string;
  overlap: Connection["overlap"];
  leadSourceId: string;
  leadQuote: string;
  weight: number;
};

// Something the lead published, with the full stored text so themes can be matched and the quote traced.
export type LeadPost = { sourceId: string; quote: string; text: string; date: string | null };

export type MemberLinks = { member: Member; links: Link[]; score: number };

export type Ranking = { ranked: MemberLinks[]; totalLinks: number; membersWithLinks: number; teamSize: number };

const MAX_INTEREST_LINKS = 2;

// Themes close to what Acme does; the admin-editable target phrases are added so both stay in step.
export const BASE_THEMES = ["artificial intelligence", "machine learning", "generative ai", "automation", "llm"];

const weightOf = (c: Connection) => (c.kind === "place" ? 1 : c.overlap === "overlapping" ? 3 : 2);

const profileText = (p: ProfileForm) => [p.headline, p.summary, ...p.expertise, ...p.employment.map((e) => e.title)].filter(Boolean).join(" . ");

export function interestLinks(member: Member, posts: LeadPost[], themes: string[]): Link[] {
  const text = profileText(member.profile);
  const out: Link[] = [];
  const used = new Set<string>();
  for (const theme of themes) {
    if (out.length >= MAX_INTEREST_LINKS || used.has(theme.toLowerCase())) continue;
    if (matchKeywords(text, [theme]).length === 0) continue;
    const post = posts.find((p) => matchKeywords(p.text, [theme]).length > 0);
    if (!post) continue;
    used.add(theme.toLowerCase());
    out.push({
      kind: "interest",
      title: `${member.name} also works with ${theme}`,
      detail: `They posted about ${theme}${post.date ? ` on ${post.date}` : ""}. ${member.name}'s profile mentions it in their headline, summary or skills.`,
      overlap: "unknown",
      leadSourceId: post.sourceId,
      leadQuote: post.quote,
      weight: 2,
    });
  }
  return out;
}

export function rankMembers(team: Member[], facts: ProfileFacts | null, posts: LeadPost[], themes: string[], limit = 5): Ranking {
  const all: MemberLinks[] = team.map((member) => {
    const career: Link[] = facts ? findConnections(member.profile, facts).map((c) => ({ ...c, weight: weightOf(c) })) : [];
    const links = [...career, ...interestLinks(member, posts, themes)];
    return { member, links, score: links.reduce((s, l) => s + l.weight, 0) };
  });
  const withLinks = all.filter((m) => m.links.length > 0).sort((a, b) => b.score - a.score || b.links.length - a.links.length || a.member.name.localeCompare(b.member.name));
  return { ranked: withLinks.slice(0, limit), totalLinks: withLinks.reduce((s, m) => s + m.links.length, 0), membersWithLinks: withLinks.length, teamSize: team.length };
}
