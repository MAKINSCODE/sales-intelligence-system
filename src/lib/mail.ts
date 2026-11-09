import "server-only";
import nodemailer, { type Transporter } from "nodemailer";
import { env } from "@/lib/env";
import { log } from "@/lib/log";
import { isTransient, retry } from "@/lib/retry";

type Delivery = { delivered: boolean };

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function layout(title: string, body: string, cta: { label: string; url: string }) {
  return `<!doctype html><html><body style="margin:0;background:#fafaf9;font-family:Arial,Helvetica,sans-serif;color:#0a0a0a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;background:#fff;border:1px solid #e7e5e4;border-radius:12px">
<tr><td style="padding:28px 28px 8px"><span style="font-size:18px;font-weight:700;letter-spacing:-0.01em"><span style="color:#e85e09">&#9632;</span> Sales Intelligence</span></td></tr>
<tr><td style="padding:8px 28px 0"><h1 style="font-size:20px;margin:8px 0 12px">${escapeHtml(title)}</h1><p style="font-size:15px;line-height:1.55;margin:0 0 20px;color:#3f3f3f">${body}</p></td></tr>
<tr><td style="padding:0 28px 28px"><a href="${escapeHtml(cta.url)}" style="display:inline-block;background:#e85e09;color:#0a0a0a;font-weight:700;font-size:15px;text-decoration:none;padding:12px 20px;border-radius:8px">${escapeHtml(cta.label)}</a>
<p style="font-size:12px;color:#5c5c5c;margin:20px 0 0">If the button does not work, copy this link into your browser:<br><span style="word-break:break-all">${escapeHtml(cta.url)}</span></p></td></tr>
</table></td></tr></table></body></html>`;
}

const TRANSIENT_SMTP = new Set(["ECONNECTION", "ESOCKET", "ETIMEOUT", "EDNS", "ETIMEDOUT", "ECONNRESET"]);
const isTransientMail = (e: unknown) => {
  const x = e as { code?: unknown; responseCode?: unknown } | null;
  // 4xx replies are the provider asking to try again later.
  if (typeof x?.responseCode === "number") return x.responseCode >= 400 && x.responseCode < 500;
  return (typeof x?.code === "string" && TRANSIENT_SMTP.has(x.code)) || isTransient(e);
};

let transport: Transporter | undefined;
function transporter() {
  const e = env();
  // Short timeouts: a slow or unreachable mail server must not hold a sign-in request open for minutes.
  return (transport ??= nodemailer.createTransport({
    host: e.SMTP_HOST,
    port: e.SMTP_PORT,
    secure: e.SMTP_PORT === 465,
    auth: { user: e.SMTP_USER, pass: e.SMTP_PASS },
    connectionTimeout: 8_000,
    greetingTimeout: 8_000,
    socketTimeout: 20_000,
  }));
}

async function send(to: string, subject: string, text: string, html: string): Promise<Delivery> {
  const e = env();
  if (!e.SMTP_USER || !e.SMTP_PASS) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("SMTP credentials are not configured");
    }
    log.warn("mail.not_configured", { to });
    return { delivered: false };
  }
  const start = Date.now();
  try {
    const info = await retry(
      () => transporter().sendMail({ from: { name: e.MAIL_FROM_NAME, address: e.MAIL_FROM_ADDRESS }, to, subject, text, html }),
      { retries: 1, baseMs: 1_500, shouldRetry: isTransientMail, onRetry: ({ attempt, delayMs, err }) => log.warn("mail.retry", { attempt, delayMs, err }) },
    );
    log.info("mail.sent", { to, ms: Date.now() - start, messageId: info.messageId });
    return { delivered: true };
  } catch (err) {
    log.error("mail.failed", { to, ms: Date.now() - start, err });
    throw err;
  }
}

export function sendSignInLink(to: string, url: string) {
  return send(
    to,
    "Your Sales Intelligence sign-in link",
    `Use this link to sign in. It expires in 15 minutes and works once:\n\n${url}\n\nIf you did not request it, you can ignore this email.`,
    layout("Sign in", "Use this button to sign in. The link expires in 15 minutes and can be used once. If you did not request it, you can ignore this email.", { label: "Sign in", url }),
  );
}

export function sendInvite(to: string, url: string, inviterName: string) {
  return send(
    to,
    "You have been invited to Sales Intelligence",
    `${inviterName} invited you to Sales Intelligence. Accept the invitation (link valid for 7 days):\n\n${url}`,
    layout("You have been invited", `${escapeHtml(inviterName)} invited you to Sales Intelligence. The invitation link is valid for 7 days.`, { label: "Accept invitation", url }),
  );
}
