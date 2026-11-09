import Image from "next/image";
import clsx from "clsx";
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  TextareaHTMLAttributes,
} from "react";

export function Logo({ className }: { className?: string }) {
  return (
    <Image
      src="/logo.svg"
      alt="Sales Intel"
      width={85}
      height={23}
      unoptimized
      priority
      className={clsx("h-6 w-auto", className)}
    />
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "dark" | "outline" | "ghost" | "danger";
  size?: "sm" | "md";
};

export const buttonClass = ({ variant = "primary", size = "md" }: Pick<ButtonProps, "variant" | "size">) =>
  clsx(
    "inline-flex items-center justify-center gap-2 rounded-lg font-semibold whitespace-nowrap transition",
    "active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100",
    size === "md" ? "min-h-11 px-4 text-sm" : "min-h-9 px-3 text-sm",
    variant === "primary" && "bg-brand text-ink hover:bg-[#3b82f6]",
    variant === "dark" && "bg-ink text-white hover:bg-[#262626]",
    variant === "outline" && "border border-line bg-white text-ink hover:border-ink",
    variant === "ghost" && "text-ink hover:bg-surface",
    variant === "danger" && "border border-line bg-white text-[#b42318] hover:border-[#b42318]",
  );

export function Button({ variant, size, className, ...props }: ButtonProps) {
  return <button className={clsx(buttonClass({ variant, size }), className)} {...props} />;
}

const controlClass =
  "w-full rounded-lg border border-line bg-white px-3 text-[15px] text-ink placeholder:text-[#8a8a8a] transition hover:border-[#c9c6c3] focus:border-ink focus:outline-none focus:ring-2 focus:ring-brand/40 aria-[invalid=true]:border-[#b42318]";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={clsx(controlClass, "min-h-11", className)} {...props} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={clsx(controlClass, "py-2.5 leading-relaxed", className)} {...props} />;
}

export function Field({
  label,
  htmlFor,
  hint,
  optional,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  optional?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="flex items-baseline gap-2 text-sm font-medium">
        {label}
        {optional && <span className="text-xs font-normal text-muted">Optional</span>}
      </label>
      {children}
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={clsx("rounded-xl border border-line bg-white", className)} {...props} />;
}

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "brand" | "dark" | "danger";
  children: ReactNode;
}) {
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        tone === "neutral" && "bg-surface text-muted ring-1 ring-line",
        tone === "brand" && "bg-brand-soft text-brand-strong ring-1 ring-brand/30",
        tone === "dark" && "bg-ink text-white",
        tone === "danger" && "bg-[#fef3f2] text-[#b42318] ring-1 ring-[#fecdca]",
      )}
    >
      {children}
    </span>
  );
}

export function Alert({
  tone = "info",
  children,
}: {
  tone?: "info" | "error" | "success";
  children: ReactNode;
}) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={clsx(
        "rounded-lg border px-3.5 py-3 text-sm",
        tone === "info" && "border-line bg-surface",
        tone === "success" && "border-brand/30 bg-brand-soft",
        tone === "error" && "border-[#fecdca] bg-[#fef3f2] text-[#912018]",
      )}
    >
      {children}
    </div>
  );
}
