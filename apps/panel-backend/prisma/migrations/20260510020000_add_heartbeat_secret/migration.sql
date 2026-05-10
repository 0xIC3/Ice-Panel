-- Slice 38 — heartbeat self-destruct.
-- Each node gets a private 32-byte secret. The bootstrap payload bundles
-- an HMAC over (nodeId, secret); the agent presents that token on every
-- heartbeat poll, panel verifies + checks deletedAt → 200 / 410.

-- Add column nullable first so we can backfill, then enforce NOT NULL.
ALTER TABLE "nodes" ADD COLUMN "heartbeat_secret" BYTEA;

-- Backfill: every existing row gets a fresh random 32-byte secret.
-- pgcrypto's gen_random_bytes is preferred; fall back to a synthetic
-- per-row hash if pgcrypto isn't loaded (postgres 16 includes it but
-- self-managed setups may have it disabled).
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pgcrypto') THEN
        UPDATE "nodes" SET "heartbeat_secret" = gen_random_bytes(32);
    ELSE
        UPDATE "nodes"
        SET "heartbeat_secret" = decode(
            encode(digest(id::text || clock_timestamp()::text || random()::text, 'sha256'), 'hex'),
            'hex'
        );
    END IF;
END $$;

ALTER TABLE "nodes" ALTER COLUMN "heartbeat_secret" SET NOT NULL;
