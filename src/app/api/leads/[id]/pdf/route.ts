import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, getCurrentUser } from "@/lib/auth/session";
import { PdfError, asciiFilename, renderBriefPdf } from "@/lib/pdf";
import { loadRunView } from "@/lib/research/view";

export async function GET(_req: Request, ctx: RouteContext<"/api/leads/[id]/pdf">) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const { id } = await ctx.params;
  // Ownership is checked here as well as on the print page the browser visits.
  const run = await loadRunView(id, user.id);
  if (!run?.brief || (run.status !== "COMPLETE" && run.status !== "PARTIAL")) {
    return NextResponse.json({ error: "There is no finished brief to export yet." }, { status: 404 });
  }

  const token = (await cookies()).get(SESSION_COOKIE)?.value ?? "";
  try {
    const pdf = await renderBriefPdf({ leadId: id, sessionToken: token, userId: user.id, footerName: run.lead.name });
    const ascii = asciiFilename(run.lead.name);
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(`Brief - ${run.lead.name}.pdf`)}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    const err = e instanceof PdfError ? e : new PdfError("The PDF could not be created.", 500);
    return NextResponse.json({ error: err.message }, { status: err.status, headers: err.status === 429 || err.status === 503 ? { "Retry-After": "10" } : undefined });
  }
}
