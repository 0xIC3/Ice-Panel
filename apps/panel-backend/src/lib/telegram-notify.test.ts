import { describe, it, expect } from 'vitest';
import { escapeMarkdown } from './telegram-notify.js';

describe('escapeMarkdown', () => {
  it('escapes the legacy Markdown metacharacters', () => {
    expect(escapeMarkdown('*bold*')).toBe('\\*bold\\*');
    expect(escapeMarkdown('_italic_')).toBe('\\_italic\\_');
    expect(escapeMarkdown('`code`')).toBe('\\`code\\`');
    expect(escapeMarkdown('[link](url)')).toBe('\\[link\\](url)');
  });

  it('passes plain text unchanged', () => {
    expect(escapeMarkdown('Hello world 123')).toBe('Hello world 123');
    expect(escapeMarkdown('user@host:port')).toBe('user@host:port');
  });

  it('handles mixed content', () => {
    expect(escapeMarkdown('admin_user `cat /etc/passwd`')).toBe(
      'admin\\_user \\`cat /etc/passwd\\`',
    );
  });

  it('escapes brackets that could forge inline links', () => {
    // Adversary's username = `[click here](https://evil.example)` — without
    // escaping this would render as a clickable link in the Telegram alert
    // and could phish whoever sees the alert. After escape it's literal.
    const adversary = '[click here](https://evil.example)';
    const out = escapeMarkdown(adversary);
    expect(out).toContain('\\[');
    expect(out).toContain('\\]');
  });

  it('does NOT escape backslashes (one-pass)', () => {
    // We deliberately don't escape `\` itself — callers should never wrap
    // twice, but if they do, backslashes pass through unchanged so the
    // already-escaped meta chars stay escaped.
    const once = escapeMarkdown('*x*');
    expect(once).toBe('\\*x\\*');
    // Re-running escapes only the metacharacters again, leaving the
    // existing backslashes alone. Net effect: each `*` ends up with two
    // backslashes in front of it.
    expect(escapeMarkdown(once)).toBe('\\\\*x\\\\*');
  });
});
