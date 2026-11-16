import { inCategory } from "./types.js";

const SMTP = "https://getmyenv.com/docs/variables";

export const EMAIL_KEYS = inCategory("email", [
  { name: "RESEND_API_KEY", provider: "Resend", description: "Resend API key.", docsUrl: "https://resend.com/api-keys", valueHint: "Starts with re_", valuePattern: /^re_[A-Za-z0-9_]{20,}$/, source: "sdk" },
  { name: "SENDGRID_API_KEY", provider: "SendGrid", description: "SendGrid API key.", docsUrl: "https://app.sendgrid.com/settings/api_keys", valueHint: "Starts with SG.", valuePattern: /^SG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}$/, source: "convention" },
  { name: "MAILGUN_API_KEY", provider: "Mailgun", description: "Mailgun API key.", docsUrl: "https://app.mailgun.com/settings/api_security", pair: ["MAILGUN_DOMAIN"], source: "convention" },
  { name: "MAILGUN_DOMAIN", provider: "Mailgun", description: "Sending domain in Mailgun.", docsUrl: "https://app.mailgun.com/mg/sending/domains", pair: ["MAILGUN_API_KEY"], source: "convention" },
  { name: "POSTMARK_SERVER_TOKEN", provider: "Postmark", description: "Postmark server API token.", docsUrl: "https://account.postmarkapp.com/servers", source: "convention" },
  { name: "BREVO_API_KEY", provider: "Brevo", description: "Brevo API key.", docsUrl: "https://app.brevo.com/settings/keys/api", valueHint: "Starts with xkeysib-", valuePattern: /^xkeysib-[A-Za-z0-9-]{40,}$/, source: "convention", iconSlug: "brevo" },
  { name: "LOOPS_API_KEY", provider: "Loops", description: "Loops API key.", docsUrl: "https://app.loops.so/settings?page=api", source: "convention" },
  { name: "SMTP_HOST", provider: "SMTP", description: "SMTP server host name.", docsUrl: SMTP, valueHint: "For example smtp.example.com", pair: ["SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD"], source: "convention" },
  { name: "SMTP_PORT", provider: "SMTP", description: "SMTP server port.", docsUrl: SMTP, valueHint: "587 or 465", valuePattern: /^\d{2,5}$/, pair: ["SMTP_HOST"], source: "convention" },
  { name: "SMTP_USER", provider: "SMTP", description: "SMTP user name.", docsUrl: SMTP, pair: ["SMTP_PASSWORD"], source: "convention" },
  { name: "SMTP_PASSWORD", provider: "SMTP", description: "SMTP password.", docsUrl: SMTP, pair: ["SMTP_USER"], source: "convention" },
  { name: "EMAIL_FROM", provider: "SMTP", description: "Sender address for outgoing email.", docsUrl: SMTP, valueHint: "For example App <hello@example.com>", source: "convention" },
]);
