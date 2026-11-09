import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { loadRunView } from "@/lib/research/view";

// Polled by the lead page while research is running; always scoped to the signed-in owner.
export async function GET(_req: Request, ctx: RouteContext<"/api/leads/[id]/run">) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const { id } = await ctx.params;
  const run = await loadRunView(id, user.id);
  return NextResponse.json({ run }, { headers: { "Cache-Control": "no-store" } });
}
