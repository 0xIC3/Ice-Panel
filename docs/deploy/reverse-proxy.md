# Reverse-proxy guide for Ice-Panel

The panel's installer binds the SPA on plain HTTP at `:8080` (or whatever
`FRONTEND_PORT` you set). **For any production exposure you must front it
with a reverse proxy that terminates TLS.** Without TLS the JWT token
travels in cleartext on the wire.

This page lists the recommended setups in order of "least friction first".

## Constraints (read before configuring)

- **Root path only.** Ice-Panel is hard-coded to be served from `/` of a
  domain or subdomain. Do **not** try to reverse-proxy `/ice-panel` — the
  SPA's asset paths and the backend's CORS allow-list expect root.
- **DNS A-record required.** No exceptions for Hysteria nodes (Hysteria
  needs proper hostname for ACME). For the **panel** specifically you can
  use Cloudflare proxied (yellow cloud) — works fine.
- **One domain serves both API + SPA + subscription URLs.** The frontend
  and backend live in the same Docker compose; nginx in the frontend
  container reverse-proxies `/api/`, `/sub/`, `/health` to the backend.
  External reverse-proxy just forwards everything to that one HTTP port.

## Option 1: Caddy (recommended)

**Why:** zero-config TLS via Let's Encrypt, single binary, the configuration
fits on a postcard. This is the path the panel installer hints at in its
post-install message.

### Install Caddy on the panel host

```bash
apt-get install -y caddy
```

(Modern Ubuntu/Debian have Caddy 2 in apt. If you need the latest features,
follow the official Caddy install guide for the official APT repo.)

### Caddyfile

```caddyfile
panel.yourdomain.com {
    reverse_proxy 127.0.0.1:8080
}

# Anti-probing: scanners hitting the bare server IP on :443 get a silent 204
# so they can't fingerprint Ice-Panel by hostname or banner. Caddy issues a
# self-signed internal cert just for this catch-all — never sees real CT
# logs and reveals nothing.
:443 {
    tls internal
    respond 204
}
```

### Apply

```bash
cat > /etc/caddy/Caddyfile <<'EOF'
panel.yourdomain.com {
    reverse_proxy 127.0.0.1:8080
}
:443 {
    tls internal
    respond 204
}
EOF
systemctl reload caddy
```

Then re-run the panel installer with `CORS_ORIGIN=https://panel.yourdomain.com`
so the backend whitelists the new origin.

### Verify

```bash
curl -fsSL https://panel.yourdomain.com/health
# → {"status":"ok","db":"ok","redis":"ok"}

curl -k https://<your-vps-ip>     # bare IP probe
# → silent 204, no body, no banner
```

---

## Option 2: nginx (manual TLS)

**Why:** you already run nginx, or your VPS provider blocks Let's Encrypt
on `:80` and you want to use a different ACME challenge type (DNS-01 via
certbot's Cloudflare plugin etc.).

### Install + obtain cert

```bash
apt-get install -y nginx certbot python3-certbot-nginx
certbot --nginx -d panel.yourdomain.com  # interactive — answers HTTP-01
```

Certbot writes the server block automatically. If you prefer to manage it
manually, here's the minimum:

### `/etc/nginx/sites-available/ice-panel`

```nginx
server {
    listen 80;
    server_name panel.yourdomain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name panel.yourdomain.com;

    ssl_certificate     /etc/letsencrypt/live/panel.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/panel.yourdomain.com/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    # Pass everything to the panel — the SPA's nginx layer sorts out
    # /api/ vs /sub/ vs static assets internally.
    location / {
        proxy_pass         http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }
}

# Anti-probing default-server: anyone hitting :443 with a different host
# (e.g. the bare IP) gets dropped with a 444 — connection closed without
# response, mimics a closed port to scanners.
server {
    listen 443 ssl http2 default_server;
    server_name _;
    ssl_certificate     /etc/letsencrypt/live/panel.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/panel.yourdomain.com/privkey.pem;
    return 444;
}
```

### Activate

```bash
ln -s /etc/nginx/sites-available/ice-panel /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

Then re-run the panel installer with `CORS_ORIGIN=https://panel.yourdomain.com`.

---

## Option 3: Cloudflare proxied (yellow cloud) + Origin Certificate

**Why:** hide the panel's real VPS IP, get free DDoS protection, free
HTTP/3, free brotli, automatic geo-WAF rules. The most popular production
path for the panel.

> ⚠️ **Cloudflare proxy works for the PANEL ONLY**, not for proxy nodes —
> see the warning at the bottom of this section.

### Step 1: DNS

In your Cloudflare dashboard for the domain:

```
Type:    A
Name:    panel
Content: <your-vps-public-ip>
Proxy:   ☁ Proxied (yellow / orange cloud)
TTL:     Auto
```

### Step 2: SSL/TLS mode

Cloudflare → SSL/TLS → Overview:
- **Full (strict)** — recommended. CF talks HTTPS to origin, validates the
  cert. Requires you to install Cloudflare's Origin Certificate on the VPS
  (next step).
- **Flexible** is the lazy mode (CF↔origin in plain HTTP) — works without
  installing any cert, but cleartext between CF and your VPS is a real
  attack surface for anyone snooping that link. Only acceptable for
  throwaway testing.

### Step 3: Origin Certificate

Cloudflare → SSL/TLS → Origin Server → **Create Certificate**:
- Hostnames: `panel.yourdomain.com` (or `*.yourdomain.com` if you want
  one cert for many subdomains)
- Validity: 15 years (default — Cloudflare CA, not browser-trusted, but
  trusted by CF edge)

Save the two PEM blobs to the VPS:

```bash
mkdir -p /etc/caddy/cf
nano /etc/caddy/cf/cert.pem        # paste "Origin Certificate" PEM
nano /etc/caddy/cf/privkey.pem     # paste "Private Key" PEM
chmod 600 /etc/caddy/cf/*
```

### Step 4: Caddy with the Origin cert

```caddyfile
panel.yourdomain.com {
    tls /etc/caddy/cf/cert.pem /etc/caddy/cf/privkey.pem
    reverse_proxy 127.0.0.1:8080
}

# Anti-probing — anyone hitting the bare VPS IP on :443 gets a silent 204.
# Caddy serves this with its self-signed internal cert; bots that resolved
# the domain via dig / cert-transparency logs and tried to bypass CF will
# bounce off this with no banner / no fingerprint.
:443 {
    tls internal
    respond 204
}
```

```bash
apt-get install -y caddy
mv Caddyfile /etc/caddy/Caddyfile  # or edit /etc/caddy/Caddyfile
systemctl reload caddy
```

### Step 5: Update CORS in panel

```bash
cd /opt/ice-panel
sed -i 's|^CORS_ORIGIN=.*|CORS_ORIGIN=https://panel.yourdomain.com|' .env.production
docker compose -f docker-compose.prod.yml --env-file .env.production restart backend
```

### Step 6: Close port 8080 from the public internet

The panel-installer left `:8080` open as a fallback for IP-direct testing.
With CF + Caddy in front you don't need that anymore — Caddy talks to
backend via `127.0.0.1:8080` (loopback, ufw doesn't filter loopback).

```bash
ufw delete allow 8080/tcp
ufw reload
```

Now the only ways into the panel are:
1. `https://panel.yourdomain.com` via CF edge → Caddy → backend
2. SSH into the VPS and curl `127.0.0.1:8080` directly

### Step 7: Lock origin to CF IPs only (optional, recommended)

If somebody discovers your real VPS IP (e.g. via leaked email headers),
they could bypass CF and hit your VPS directly on `:443`. Plug that hole
by allowing only Cloudflare's IP ranges to reach `:443`:

```bash
# Pull the current CF IP list
for ip in $(curl -fsSL https://www.cloudflare.com/ips-v4); do
  ufw allow from "$ip" to any port 443 proto tcp
done
ufw delete allow 443/tcp        # remove the wide-open rule
ufw reload
```

Re-run this script periodically — Cloudflare adds IP ranges occasionally.

### Verify

```bash
# From outside (your laptop)
curl https://panel.yourdomain.com/health
# → {"status":"ok","db":"ok","redis":"ok"}

# Real VPS IP NOT visible
nslookup panel.yourdomain.com
# → resolves to a Cloudflare IP, not yours

curl -k https://<your-vps-ip>
# → silent 204 from the anti-probing block (or connection refused if
#   you locked :443 to CF-only IPs in step 7)
```

### ⚠️ Cloudflare proxy works ONLY for the panel — nodes must be DNS-only

| Protocol on the node | CF Proxied (yellow) | DNS only (gray) |
|---|---|---|
| **Hysteria 2** (UDP/443) | ❌ CF Free does **not** pass UDP — kills the protocol | ✅ Required |
| **AmneziaWG** (UDP/51820) | ❌ Same — UDP not proxied | ✅ Required |
| **Xray + REALITY (raw)** | ❌ CF terminates TLS → REALITY's anti-fingerprint trick relies on the client doing the real TLS handshake itself, CF in the middle breaks it | ✅ Required for REALITY |
| **Xray + WS + TLS** | ✅ Works — this is the canonical CDN-fronting pattern | Also works |
| **NaiveProxy** | ⚠️ Technically works but CF in the middle disturbs the Chromium-fingerprint claim | ✅ Safer |

**Rule of thumb**: when adding a Node DNS record, the default is **DNS only
(gray cloud)**. Only Xray-with-WS+TLS inbounds may be proxied.

---

## Option 4: Cloudflare Tunnel (testing only / CGNAT)

**Why:** you want to expose a panel from a VPS behind CGNAT, or without
opening any inbound port at all (CF connects out from your host). **Don't
use this in production for the same reason as Flexible TLS** — Cloudflare
sees all your subscription tokens in cleartext during their TLS-termination,
which defeats the panel's threat model.

```bash
# On the panel host
cloudflared tunnel login
cloudflared tunnel create ice-panel
cloudflared tunnel route dns ice-panel panel.yourdomain.com

cat > ~/.cloudflared/config.yml <<EOF
tunnel: ice-panel
credentials-file: /root/.cloudflared/<tunnel-uuid>.json
ingress:
  - hostname: panel.yourdomain.com
    service: http://127.0.0.1:8080
  - service: http_status:404
EOF

cloudflared service install
```

After this `panel.yourdomain.com` resolves to Cloudflare edge, which
tunnels back to your VPS through the outbound `cloudflared` daemon. TLS
handled by Cloudflare.

---

## Verifying the firewall

The panel installer enables `ufw` and opens `22/tcp`, `80/tcp`, `443/tcp`,
and `${FRONTEND_PORT}/tcp` (default `8080`). After you set up a reverse
proxy on `:443`, you should **close `:8080` from the public internet**:

```bash
ufw delete allow 8080/tcp   # uses default rule numbering
ufw reload
```

The reverse proxy is on the same host, so it still talks to backend via
`127.0.0.1:8080` (loopback bypasses ufw inbound rules).

---

## Subscription URLs

`/sub/:token` is served by the same backend as the admin API. After
TLS setup, subscription URLs your users paste into VPN clients look like:

```
https://panel.yourdomain.com/sub/<base64-subscription-token>
```

The token IS the credential — keep them out of logs and don't accidentally
share via screenshots.

If you want subscription URLs on a **different subdomain** for branding
(e.g. `sub.yourdomain.com`), add a second Caddy/nginx server block that
proxies only `/sub/*` to the panel — Phase 3 slice 39 (External Squads)
will give you per-bucket URL prefixing in-app.

---

## What we deliberately don't do

- **Sub-path mounting** (`https://yourdomain.com/ice-panel`) is **not
  supported**. The SPA expects to live at root. Keeping this constraint
  saves us from rewriting absolute asset paths in the build.
- **Cloudflare-proxied production deploys** — works for the panel UI
  but Cloudflare can't pass UDP, which kills Hysteria nodes. Use direct
  TLS (gray cloud / DNS-only) on Hysteria nodes.
- **mTLS at the reverse proxy** — the **panel ↔ node** link is mTLS, but
  the **client ↔ panel** link is plain JWT-over-TLS. Adding mTLS at the
  user edge would lock out 90% of mobile VPN clients.
