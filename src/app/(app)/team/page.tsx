import type { Metadata } from "next";
import { Suspense } from "react";
import { Card } from "@/components/ui";
import { PageSkeleton } from "@/components/skeletons";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/session";
import { InviteForm, MemberRowItem } from "./team-client";

export const metadata: Metadata = { title: "Team" };

export default function TeamPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Team />
    </Suspense>
  );
}

async function Team() {
  const admin = await requireAdmin();
  const users = await db.user.findMany({ orderBy: [{ status: "asc" }, { createdAt: "asc" }] });

  return (
    <div className="animate-fade-up">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Team</h1>
      <p className="mt-1.5 text-[15px] text-muted">Invite colleagues by email. Revoking access signs them out immediately.</p>

      <div className="mt-8 grid grid-cols-1 items-start gap-6 lg:grid-cols-5">
        <Card className="p-5 lg:col-span-2">
          <h2 className="mb-4 text-base font-semibold">Give access</h2>
          <InviteForm />
        </Card>

        <Card className="p-5 lg:col-span-3">
          <h2 className="text-base font-semibold">People ({users.length})</h2>
          <ul className="mt-2 divide-y divide-line">
            {users.map((u) => (
              <MemberRowItem
                key={u.id}
                member={{
                  id: u.id,
                  email: u.email,
                  role: u.role,
                  status: u.status,
                  lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
                  isSelf: u.id === admin.id,
                }}
              />
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
