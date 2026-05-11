import nodemailer from 'nodemailer';

function env(name: string, fallback?: string): string | undefined {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  return value;
}

function isEmailEnabled() {
  return Boolean(env('SMTP_HOST') && env('SMTP_PORT') && env('SMTP_USER') && env('SMTP_PASS'));
}

function isEmailRequired() {
  return env('SMTP_REQUIRED', 'false') === 'true';
}

function buildTransport() {
  const host = env('SMTP_HOST');
  const port = Number(env('SMTP_PORT', '587'));
  const user = env('SMTP_USER');
  const pass = env('SMTP_PASS');
  const secure = env('SMTP_SECURE', 'false') === 'true';

  if (!host || !user || !pass || Number.isNaN(port)) {
    throw new Error('SMTP not configured (SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS)');
  }

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });
}

export async function sendMail(options: { to: string; subject: string; text: string; html?: string }) {
  if (!isEmailEnabled()) {
    if (isEmailRequired()) {
      throw new Error('SMTP not configured but SMTP_REQUIRED=true');
    }

    // Dev-friendly: don't fail the request if SMTP isn't configured.
    console.log('[mail] SMTP not configured; skipping send.');
    console.log('[mail] to:', options.to);
    console.log('[mail] subject:', options.subject);
    console.log('[mail] text:', options.text);
    return;
  }

  const from = env('MAIL_FROM', 'no-reply@localhost');
  const transport = buildTransport();

  try {
    const info = await transport.sendMail({
      from,
      to: options.to,
      subject: options.subject,
      text: options.text,
      html: options.html,
    });

    if (process.env.NODE_ENV !== 'production') {
      console.log('[mail] sent:', {
        to: options.to,
        subject: options.subject,
        messageId: (info as any)?.messageId,
        response: (info as any)?.response,
      });
    }
  } catch (err: any) {
    console.error('[mail] send failed:', err?.message || err);
    throw err;
  }
}

export function getPublicBaseUrl() {
  // Used for links in emails.
  // Prefer explicit env var (PROTOCOL/DOMAIN can be wrong in local dev with phones).
  return env('PUBLIC_BASE_URL', 'http://localhost:3000')!;
}
