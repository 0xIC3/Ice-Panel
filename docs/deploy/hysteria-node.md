# Deploying a Hysteria 2 Node (manual / Phase 1 era)

> **For most cases use the one-command installer instead — see [install.md](./install.md).**
> This runbook is the manual step-by-step that the installer encapsulates.
> Useful if you want to understand exactly what gets installed, or if you're
> debugging a failed install.

Runbook for provisioning a single VPS as an Ice-Panel proxy node running
Hysteria 2. Validated on Ubuntu 24.04 (AEZA, Hetzner) with a 1 vCPU / 1-4 GB
RAM box.

## What you need before starting

- A VPS with **public IPv4** (no CGNAT, no shared IP) and root SSH access.
- A **DNS A-record** pointing a hostname at that IP (e.g. `n1.example.com`).
  In Cloudflare, set **DNS only** (gray cloud) — Cloudflare proxy does not
  pass UDP and Hysteria 2 is QUIC over UDP.
- **Open ports** on the VPS: `22/tcp` (SSH), `8443/tcp` (panel→node mTLS),
  `443/udp` (Hysteria client traffic), `80/tcp` (one-time, for ACME HTTP-01).
- **Panel running** at a reachable address (locally during development is
  fine — the node never dials the panel back; the panel polls the node).

## 1. Prepare the VPS

```bash
ssh root@<vps-ip>

# Firewall
ufw allow 22/tcp
ufw allow 8443/tcp
ufw allow 443/udp
ufw allow 80/tcp     # one-time, can be removed after first cert renewal
ufw enable
```

(Check the provider's external firewall too — some providers layer one in
front of the VPS regardless of `ufw`.)

## 2. Install Hysteria 2

```bash
bash <(curl -fsSL https://get.hy2.sh/)
```

This installs the official binary at `/usr/local/bin/hysteria` and creates
a `hysteria-server.service` systemd unit running as user `hysteria`.

## 3. Configure Hysteria

Replace `/etc/hysteria/config.yaml`:

```yaml
listen: :443

acme:
  domains:
    - n1.example.com           # ← your A-record
  email: ops@example.com       # ← your email for LE
  ca: letsencrypt
  type: http
  dir: /etc/hysteria/acme

auth:
  type: http
  http:
    url: http://127.0.0.1:9000/auth   # node-agent's loopback callback
    insecure: false

masquerade:
  type: 404
```

Then ensure the ACME directory belongs to `hysteria`:

```bash
mkdir -p /etc/hysteria/acme
chown -R hysteria:hysteria /etc/hysteria
```

Start the server. The first start performs an ACME HTTP-01 challenge against
`http://n1.example.com/.well-known/acme-challenge/...`, which is why port 80
must be open during this window.

```bash
systemctl enable --now hysteria-server.service
journalctl -u hysteria-server.service -f --since "1 minute ago"
```

Wait for `obtain  certificate obtained successfully` and
`server up and running  {"listen": ":443"}`.

## 4. Build and upload the node-agent

From your dev machine (the repo checkout):

```bash
cd apps/node
GOOS=linux GOARCH=amd64 go build -o ice-panel-node-linux .

scp ice-panel-node-linux root@<vps-ip>:/usr/local/bin/ice-panel-node
ssh root@<vps-ip> "chmod +x /usr/local/bin/ice-panel-node"
```

## 5. Create the node on the panel

The panel issues an mTLS payload that the agent uses to identify itself:

```bash
# (assumes you have an admin token in $TOKEN)
curl -X POST https://panel.example.com/api/nodes \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "n1",
    "address": "n1.example.com:8443",
    "countryCode": "SE"
  }'
```

The response contains a `payload` field — a long base64url-encoded blob.
**This is the only time the panel will return it.** Save it immediately;
it contains the node's mTLS private key.

## 6. Wire up the node-agent on the VPS

On the VPS, create the systemd unit and the env file:

```bash
cat > /etc/systemd/system/ice-panel-node.service <<'UNIT'
[Unit]
Description=Ice-Panel Node Agent
After=network.target hysteria-server.service
Wants=hysteria-server.service

[Service]
Type=simple
EnvironmentFile=/etc/ice-panel-node/env
ExecStart=/usr/local/bin/ice-panel-node
Restart=on-failure
RestartSec=5
User=root

[Install]
WantedBy=multi-user.target
UNIT

mkdir -p /etc/ice-panel-node
chmod 700 /etc/ice-panel-node
```

Drop the payload into `/etc/ice-panel-node/env` (use `nano` or your editor of
choice — it's a single very long line, do not break it):

```ini
NODE_PAYLOAD=<paste-the-payload-from-step-5-here>
NODE_HOST=0.0.0.0
NODE_PORT=8443
HYSTERIA_AUTH_HOST=127.0.0.1
HYSTERIA_AUTH_PORT=9000
```

```bash
chmod 600 /etc/ice-panel-node/env
systemctl daemon-reload
systemctl enable --now ice-panel-node.service
systemctl status ice-panel-node.service
```

## 7. Verify

```bash
# Both ports listening
ss -tnlp | grep -E ':8443|:9000'
ss -unlp | grep ':443'

# Logs from the agent
journalctl -u ice-panel-node.service -n 30 --no-pager
```

Expected agent log lines: `listening 0.0.0.0:8443`,
`hysteria auth callback listening 127.0.0.1:9000`.

From the panel (or the dev machine via tunnel), create a user and watch the
agent log light up:

```bash
curl -X POST https://panel.example.com/api/users \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"username":"e2e-test-01"}'
```

In the VPS journal you should see:
```
addUser ok  userId=... username=e2e-test-01
```

That confirms the panel↔node mTLS path and the HysteriaAdapter state map.

## 8. Test with a real client

Pull the subscription URI:

```bash
curl -s https://panel.example.com/sub/<subscriptionToken> | base64 -d
```

Output: `hysteria2://<password>@n1.example.com:443/?#n1`

Import into a Hysteria 2-compatible client (Hiddify, NekoBox, Streisand, the
upstream `hysteria` CLI), connect, and verify the public IP your traffic
egresses from is the VPS IP.

## Rolling the node

If the node's mTLS key leaks or the box is reinstalled, the cleanest path is:

1. Delete the node on the panel (`DELETE /api/nodes/:id`) — soft-deletes,
   stops fan-out.
2. Re-create with `POST /api/nodes` to mint a fresh payload.
3. Copy the new payload onto the VPS env file, restart `ice-panel-node`.

## Known gotchas

- **AEZA promo / cheap providers**: some budget plans throttle or filter
  outbound UDP on Hysteria's port. UDP from a PC may work, but consumer
  devices on cellular get black-holed. Test from multiple networks before
  blaming the panel.
- **Cloudflare proxy must be off**. Orange cloud breaks Hysteria — UDP is
  not proxied by Cloudflare.
- **First-start ACME failure**: usually means port 80 is blocked or DNS
  hasn't propagated. `dig +short <hostname>` from the VPS itself first.
