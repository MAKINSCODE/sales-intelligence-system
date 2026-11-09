import Link from "next/link";
import { buttonClass } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md py-16 text-center animate-fade-up">
      <p className="text-sm font-medium text-brand-strong">404</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">We could not find that</h1>
      <p className="mt-2 text-[15px] leading-relaxed text-muted">
        It may have been removed, or it belongs to someone else.
      </p>
      <Link href="/" className={`${buttonClass({ variant: "dark" })} mt-6`}>
        Back to briefs
      </Link>
    </div>
  );
}
