import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import * as service from './subscription.service.js';
import { buildClashYaml } from './formats/clash.js';
import { buildSingboxJson } from './formats/singbox.js';
import { buildWgQuickConf } from './formats/wgconf.js';
import { buildXrayJson } from './formats/xrayjson.js';
import { matchFormatForUserAgent } from '../srr/srr.service.js';
import {
  formatBytes,
  getSubscriptionSettings,
  renderAnnounce,
} from '../settings/settings.service.js';
import { enforceHwid } from '../hwid/hwid.service.js';
import { prisma } from '../../prisma.js';
import { config } from '../../config.js';

const TokenParamSchema = z.object({
  token: z.string().min(8).max(128),
});

const FormatEnum = z.enum(['plain', 'json', 'clash', 'singbox', 'wgconf', 'xrayjson']);
type Format = z.infer<typeof FormatEnum>;

const QuerySchema = z.object({
  format: FormatEnum.optional(),
});

const FORMAT_VALUES: ReadonlySet<Format> = new Set(FormatEnum.options);

function isFormat(value: string): value is Format {
  return FORMAT_VALUES.has(value as Format);
}

/**
 * Resolve which format the client wants, in this priority order:
 *   1. Explicit `?format=` always wins.
 *   2. SRR (Subscription Response Rules) — UA regex match against admin-
 *      defined rules in DB. Default seed rules cover Hiddify/Clash/v2rayN/
 *      sing-box/AmneziaWG-app + a `.*` catch-all → `plain`.
 *   3. Legacy Accept-header heuristic (`application/json` → `json`) for the
 *      IcePath-VPN bot integration that predates SRR.
 *   4. `plain` fallback (base64 URI list — universal).
 */
/**
 * Slice S1 — set the subscription-metadata HTTP headers most VPN clients
 * read alongside the body. Conventions across Hiddify/V2RayNG/Streisand/
 * Happ/Mihomo:
 *
 *   Profile-Title              — display name in the client's profile list
 *   Profile-Update-Interval    — refresh cadence in HOURS (clients re-fetch
 *                                without admin intervention)
 *   Subscription-Userinfo      — `upload=N; download=N; total=N; expire=T`
 *                                (RFC-3339-ish), drives the quota gauge
 *   Support-URL                — clickable link in the profile detail page
 *   Announce                   — short banner shown to the user (rendered
 *                                template, supports {{TRAFFIC_LEFT}} etc.)
 *
 * Only well-formed values are emitted — admins can leave any setting NULL
 * to omit the corresponding header.
 */
async function applySubscriptionHeaders(
  reply: FastifyReply,
  user: {
    expireAt: string | null;
    trafficLimitBytes: number | null;
    trafficUsedBytes: number;
  },
): Promise<void> {
  const settings = await getSubscriptionSettings();

  const title = settings.profileTitle ?? settings.brandName;
  if (title) reply.header('Profile-Title', `base64:${Buffer.from(title, 'utf8').toString('base64')}`);
  reply.header('Profile-Update-Interval', String(settings.updateIntervalHours));
  if (settings.supportUrl) reply.header('Support-URL', settings.supportUrl);

  // Subscription-Userinfo. `upload+download === used`. We don't track
  // upload separately yet (per-user xray stats sum both directions),
  // so attribute everything to `download` and report `upload=0` — clients
  // sum them to derive used quota and the gauge stays correct.
  const used = Math.max(0, user.trafficUsedBytes);
  const total = user.trafficLimitBytes ?? 0;
  // expire is unix seconds; 0 = no expiry per de-facto convention.
  const expireUnix = user.expireAt
    ? Math.floor(new Date(user.expireAt).getTime() / 1000)
    : 0;
  reply.header(
    'Subscription-Userinfo',
    `upload=0; download=${used}; total=${total}; expire=${expireUnix}`,
  );

  // Announce — rendered template. Skip emission if template empty.
  if (settings.announceTemplate) {
    const trafficLeft =
      user.trafficLimitBytes === null
        ? '∞'
        : formatBytes(BigInt(Math.max(0, user.trafficLimitBytes - used)));
    const daysLeft =
      user.expireAt === null
        ? '∞'
        : String(
            Math.max(
              0,
              Math.ceil(
                (new Date(user.expireAt).getTime() - Date.now()) /
                  86400_000,
              ),
            ),
          );
    const announce = renderAnnounce(settings.announceTemplate, {
      trafficLeft,
      daysLeft,
      supportUrl: settings.supportUrl ?? '',
    });
    if (announce.length > 0) {
      // Some clients require base64 encoding for non-ASCII announce. We
      // emit both forms — Happ reads `Announce-URL`-style raw, Hiddify
      // base64. Stick with `Announce: base64:<...>` which both accept.
      reply.header(
        'Announce',
        `base64:${Buffer.from(announce, 'utf8').toString('base64')}`,
      );
    }
  }
}

async function resolveFormat(
  query: z.infer<typeof QuerySchema>,
  acceptHeader: string,
  userAgent: string | null,
): Promise<Format> {
  if (query.format) return query.format;
  const matched = await matchFormatForUserAgent(userAgent);
  if (matched && isFormat(matched)) return matched;
  if (acceptHeader.toLowerCase().includes('application/json')) return 'json';
  return 'plain';
}

export async function subscriptionRoutes(app: FastifyInstance): Promise<void> {
  // GET /sub/:token — public (the token IS the credential).
  // Tight rate-limit: keyed by (ip, token). Without this, an attacker can
  // bandwidth-flood by re-fetching one valid token, or burn through token
  // candidates by enumeration. Default 30/min is well above legit clients
  // (Hiddify refreshes every 24h) and well below scan/exfil throughput.
  app.get('/sub/:token', {
    config: {
      rateLimit: {
        max: config.RATE_LIMIT_SUB_PER_MIN,
        timeWindow: '1 minute',
        // Per-token bucket so one client polling on the same token doesn't
        // share rate-budget with unrelated subscriptions on shared CGNAT.
        keyGenerator: (req) => {
          const t = (req.params as { token?: string })?.token ?? 'unknown';
          return `${req.ip}:${t}`;
        },
      },
    },
  }, async (request, reply) => {
    const params = TokenParamSchema.parse(request.params);
    const query = QuerySchema.parse(request.query);
    const userAgent = typeof request.headers['user-agent'] === 'string'
      ? request.headers['user-agent']
      : null;
    const format = await resolveFormat(
      query,
      (request.headers.accept ?? '').toString(),
      userAgent,
    );

    try {
      // Slice S2 — HWID enforcement runs BEFORE generateSubscription so
      // a denied client doesn't burn a subscription_request_history row
      // or stress the binding query. Cost is one cheap user lookup.
      const hwidHeader = request.headers['x-hwid'];
      const hwid =
        typeof hwidHeader === 'string' && hwidHeader.length > 0 && hwidHeader.length <= 255
          ? hwidHeader
          : null;
      const userMin = await prisma.user.findFirst({
        where: { subscriptionToken: params.token, deletedAt: null },
        select: { id: true, hwidDeviceLimit: true },
      });
      if (userMin) {
        const hwidResult = await enforceHwid(
          userMin.id,
          hwid,
          userMin.hwidDeviceLimit,
        );
        // Always emit the gauge header so the client can render "2/3" in
        // its profile detail UI — even on success, even when no limit set.
        // HTTP headers are ISO-8859-1; use ASCII-only "unlimited" instead
        // of '∞' which throws on the wire.
        if (hwidResult.limit !== null) {
          reply.header(
            'X-Hwid-Active',
            `${hwidResult.active}/${hwidResult.limit}`,
          );
        } else {
          reply.header(
            'X-Hwid-Active',
            `${hwidResult.active}/unlimited`,
          );
        }
        if (hwidResult.status === 'denied') {
          // 403 with a structured body — clients that don't read headers
          // still get a parseable reason.
          return reply.code(403).send({
            error: 'HWID_LIMIT',
            message: `Device limit reached (${hwidResult.active}/${hwidResult.limit})`,
            active: hwidResult.active,
            limit: hwidResult.limit,
          });
        }
      }

      const result = await service.generateSubscription(params.token, {
        ip: request.ip,
        userAgent,
      });

      // Slice 30 — host-level format gating. Each endpoint carries an
      // optional `disableForFormats[]` from its originating host row; we
      // filter before invoking the format-specific formatter so each
      // formatter can stay agnostic of host presence.
      const filtered = result.endpoints.filter(
        (e) => !(e.disableForFormats ?? []).includes(format),
      );
      const filteredPlain = result.endpoints
        .filter((e) => !(e.disableForFormats ?? []).includes('plain'))
        .map((e) => e.uri);

      // Slice S1 — emit subscription-metadata HTTP headers every client
      // app reads to set its profile name, refresh interval, quota gauge,
      // support link, and announce banner. Done after generateSubscription
      // so we have the user's traffic/expire snapshot.
      await applySubscriptionHeaders(reply, result.json.user);

      switch (format) {
        case 'json':
          return reply
            .type('application/json')
            .send({ ...result.json, endpoints: filtered });
        case 'clash':
          return reply
            .type('text/yaml; charset=utf-8')
            .send(buildClashYaml(filtered));
        case 'singbox':
          return reply
            .type('application/json')
            .send(buildSingboxJson(filtered));
        case 'wgconf':
          return reply
            .type('text/plain; charset=utf-8')
            .send(buildWgQuickConf(filtered));
        case 'xrayjson':
          return reply
            .type('application/json')
            .send(buildXrayJson(filtered));
        case 'plain':
        default:
          return reply
            .type('text/plain; charset=utf-8')
            .send(Buffer.from(filteredPlain.filter((u) => u.length > 0).join('\n'), 'utf8').toString('base64'));
      }
    } catch (err) {
      if (err instanceof service.SubscriptionNotFoundError) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      if (err instanceof service.SubscriptionForbiddenError) {
        return reply.code(403).send({
          error: 'FORBIDDEN',
          message: err.message,
          reason: err.reason,
        });
      }
      throw err;
    }
  });
}
