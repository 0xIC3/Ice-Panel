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

## Option 3: Cloudflare tunnel (testing only)

**Why:** you want to expose a panel behind CGNAT or without a public IP. **Do
not use this in production** — Cloudflare sees all your subscription tokens
in cleartext during their TLS-termination, which defeats the threat model.

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
tunnels back to your VPS. TLS handled by Cloudflare.

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
