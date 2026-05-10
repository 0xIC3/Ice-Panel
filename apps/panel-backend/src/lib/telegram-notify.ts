import { config } from '../config.js';

/**
 * Tier-1 security alerts via Telegram (cycle #5 SECURITY.md follow-up).
 *
 * Single entry-point. Callers never check whether Telegram is configured —
 * if BOT_TOKEN or CHAT_ID is missing, the call is a silent no-op. Same for
 * network errors: a flaky Telegram API shouldn't break the calling flow
 * (login, bootstrap-issue, etc.). Every failure is console-logged but
 * swallowed.
 *
 * Markdown is allowed (parse_mode=MarkdownV2 would require escaping every
 * `.`/`_`/`-`; we use the simpler legacy `Markdown` mode where only a
 * subset is special). Keep messages short — Telegram caps at 4096 chars
 * and operators read them on phones.
 */
export async function notifyTelegram(text: string): Promise<void> {
  const token = config.TELEGRAM_BOT_TOKEN;
  const chatId = config.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '<no body>');
      console.log(`[telegram-notify] HTTP ${res.status}: ${detail.slice(0, 200)}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`[telegram-notify] send failed: ${msg}`);
  }
}

/**
 * Fire-and-forget wrapper for call sites that shouldn't `await`. The promise
 * is discarded but errors are still caught inside notifyTelegram itself.
 */
export function notifyTelegramAsync(text: string): void {
  void notifyTelegram(text);
}

/**
 * Escape a user-supplied string for safe interpolation inside legacy
 * `Markdown` parse_mode bodies. We don't try to block-quote — we just
 * neutralize the metacharacters that would either crash Telegram's parser
 * ("Bad Request: can't parse entities") or let an attacker forge bold /
 * link / code-block sections inside an alert. Used for usernames, IPs,
 * error messages and anything else that ultimately comes from a user.
 *
 * Why not switch to `MarkdownV2`? V2 needs every reserved char escaped
 * everywhere — including in literal alert text we own — which makes the
 * call sites unreadable. Legacy `Markdown` only treats `_`, `*`, `[`, `` ` ``
 * as metacharacters, so escaping those is enough.
 */
export function escapeMarkdown(s: string): string {
  return s.replace(/([_*`[\]])/g, '\\$1');
}
