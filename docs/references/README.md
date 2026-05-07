# Ice-Panel References

Research notes and operational references compiled while designing Ice-Panel. These are **internal working documents** — useful for understanding decisions in the codebase, not user-facing documentation.

> Snapshot date: **2026-05-04** for Phase 1/2 refs (Hysteria2, AmneziaWG, NaiveProxy, Xray, Remnawave). **2026-05-07** for the slice 24d / 40 / 41 additions (Shadowsocks 2022, Mieru, MTProto). Each file has its own refresh policy at the bottom — re-fetch before working on the corresponding slice.

## Layout

```
docs/references/
├── README.md                       this file
├── remnawave.md                    competitor overview — high-level architecture/stack/cron
├── remnawave-modules.md            competitor deep-dive — squads, HWID, templates, plugins, etc.
├── remnawave-operational.md        competitor UX/install — what their users see and do
├── hysteria2.md                    Hysteria2 protocol reference (Slice 11 input)
├── amneziawg.md                    AmneziaWG protocol reference (Slice 19 input)
├── naiveproxy.md                   NaiveProxy protocol reference (Slice 20 input)
├── xray.md                         Xray-core protocol reference (Slice 17 input)
├── shadowsocks2022.md              Shadowsocks 2022 / xray multi-user (Slice 24d input)
├── mieru.md                        Mieru / mita stealth-proxy reference (Slice 40 input)
└── mtproto.md                      MTProto / 9seconds/mtg Telegram-proxy reference (Slice 41 input)
```

## How to use

| When | Read |
|---|---|
| Designing slice 11 (HysteriaAdapter) | `hysteria2.md` |
| Designing slice 17 (XrayAdapter) | `xray.md` |
| Designing slice 19 (AmneziaWGAdapter) | `amneziawg.md` |
| Designing slice 20 (NaiveProxyAdapter) | `naiveproxy.md` |
| Designing slice 24d (ShadowsocksAdapter) | `shadowsocks2022.md` |
| Designing slice 40 (MieruAdapter) | `mieru.md` |
| Designing slice 41 (MTProtoAdapter) | `mtproto.md` |
| Designing any panel feature | `remnawave-modules.md` for "how would Remnawave do this" |
| Writing UX/install docs | `remnawave-operational.md` for "what UX patterns work / don't work" |
| Architecture decisions | `remnawave.md` overview + relevant module file |

## Important notes

1. **These are research notes, not specs.** Opinions, tradeoff calls, and "what to copy / what to avoid" mixed with technical facts. Read critically.

2. **Snapshot dates matter.** Upstream projects (especially Remnawave on `dev` branch and Hysteria2) move fast. Anything older than 30 days is suspect — verify against current docs before committing to a design.

3. **Updates after each slice.** When a slice that uses a reference is completed, the corresponding `.md` should be updated with what we actually shipped vs. what the upstream documents — that delta is valuable.

4. **License caveat.** All upstream projects referenced here are open source (AGPL-3.0, GPL-2.0, BSD, MIT). Quoting their docs for reference is fair use. Don't copy code blocks larger than ~10 lines verbatim into Ice-Panel without preserving attribution.

## Project links

- [Roadmap](../ROADMAP.md) — slice plan and tech stack
- [Main README](../../README.md) — project overview
