# Grafana dashboards

JSON exports for the Ice-Panel Prometheus metrics (slice 33). Drop into a
Grafana instance pointed at the panel's `/metrics` endpoint.

## Files

- `overview.json` — nodes/users by status, HTTP rate + p95 latency, subscription
  request rate, login attempts, inbound-sync job outcomes, Node.js event-loop lag.
- `security.json` — honeypot hits, geo-block denials, login lockouts/invalid
  attempts at-a-glance + 5m/24h trend lines.

## Prometheus scrape config

`/metrics` is gated behind `requireAuth`. Issue an API token in the panel UI
(Settings → API tokens, scope: read-metrics) and reference it as a bearer:

```yaml
scrape_configs:
  - job_name: ice-panel
    metrics_path: /metrics
    scheme: https
    static_configs:
      - targets: ['panel.example.com']
    authorization:
      type: Bearer
      credentials: 'icp_REDACTED'
```

Default 15s scrape interval works fine — the panel's own metric-refresh loop
runs at 30s, so the gauges have a worst-case 45s skew. The HTTP histogram
and counters update on every request, no skew.

## Import

```
Grafana → Dashboards → New → Import → Upload JSON → pick datasource: Prometheus
```

Both files declare `datasource.uid = "prometheus"`. Adjust to your Grafana
datasource UID if it differs (or import via API and override).

## Alerting (not bundled)

Suggested alert rules to add on top:

- `rate(ice_panel_inbound_sync_jobs_total{result="fail"}[15m]) > 0` — a node is
  consistently failing to receive config pushes (mTLS issue, agent down).
- `increase(ice_panel_geo_block_denials_total[15m]) > 50` — admin paths under
  active probe from disallowed countries.
- `increase(ice_panel_honeypot_hits_total[15m]) > 100` — scanner sweep against
  the panel host; consider tightening the front edge IP allowlist.
- `ice_panel_nodes{status="unreachable"} > 0` — at least one node offline; we
  already get a Telegram alert on flip but a dashboard signal helps post-incident.
