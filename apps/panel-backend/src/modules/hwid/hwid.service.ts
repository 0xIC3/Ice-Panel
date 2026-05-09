import { prisma } from '../../prisma.js';

/**
 * Outcome of an HWID enforcement check on /sub/:token.
 *
 *   - `disabled`  — neither header nor user limit set; no enforcement run.
 *   - `allowed`   — device registered (upserted) and under quota.
 *   - `denied`    — device count exceeds user's limit. Caller emits 403.
 */
export interface HwidCheckResult {
  status: 'disabled' | 'allowed' | 'denied';
  /** Total devices currently registered for this user (after upsert). */
  active: number;
  /** Configured per-user limit. NULL → unlimited. */
  limit: number | null;
}

/**
 * Validate the `x-hwid` header for this subscription request, register
 * the device if new, and decide whether to allow the response.
 *
 * Trust model: HWID is client-supplied — admins use this to deter casual
 * subscription sharing, not adversarial users. A user determined to share
 * can spoof the header; that's accepted as a non-goal.
 *
 * Behaviour:
 *   - hwid is null/empty → no enforcement, no row written.
 *   - user.hwidDeviceLimit is null → no enforcement, but device IS upserted
 *     so the audit log has it.
 *   - device already exists → bump `lastSeenAt`, return `allowed`.
 *   - new device + count would exceed limit → return `denied` WITHOUT
 *     inserting the row (so re-trying with the same headers produces the
 *     same result and admins see the device that bumped the count, not
 *     blocked attempts).
 *
 * The hwid string is bounded to 255 chars upstream by the route handler;
 * here we trust it. UTF-8 collation is fine for the equality check.
 */
export async function enforceHwid(
  userId: string,
  hwid: string | null,
  limit: number | null,
): Promise<HwidCheckResult> {
  if (!hwid) {
    // No header → no enforcement, no row. Return `active=0` for the
    // X-Hwid-Active header — clients display it as "0/N".
    return { status: 'disabled', active: 0, limit };
  }

  const existing = await prisma.hwidUserDevice.findUnique({
    where: { userId_hwid: { userId, hwid } },
  });

  if (existing) {
    // Known device — touch lastSeenAt fire-and-forget; the count below
    // is unaffected. We await to keep the response monotonic on retry.
    await prisma.hwidUserDevice.update({
      where: { id: existing.id },
      data: { lastSeenAt: new Date() },
    });
    const active = await prisma.hwidUserDevice.count({ where: { userId } });
    return { status: 'allowed', active, limit };
  }

  // New device. Count first, then decide whether to register.
  const current = await prisma.hwidUserDevice.count({ where: { userId } });

  if (limit !== null && current >= limit) {
    // Over quota — DO NOT insert. Admin sees only devices that actually
    // got through; otherwise spurious failed attempts pollute the list.
    return { status: 'denied', active: current, limit };
  }

  await prisma.hwidUserDevice.create({
    data: { userId, hwid },
  });
  return { status: 'allowed', active: current + 1, limit };
}

/**
 * Admin-facing: list all devices currently registered for a user. Sorted
 * newest-first so the recently-added entry sits on top of the UI list.
 */
export async function listUserDevices(userId: string) {
  return prisma.hwidUserDevice.findMany({
    where: { userId },
    orderBy: [{ lastSeenAt: 'desc' }],
  });
}

/**
 * Admin-facing: revoke (delete) a single device row so the user can
 * register a different physical device on the next /sub/:token hit.
 */
export async function deleteDevice(id: string): Promise<void> {
  await prisma.hwidUserDevice.delete({ where: { id } });
}
