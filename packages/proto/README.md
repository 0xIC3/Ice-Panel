# Proto (deprecated)

> ⚠️ **Empty by design — gRPC is not used.** The original plan had a gRPC
> transport between panel and node, with shared `.proto` schemas in this
> package. After studying Remnawave's deployment patterns we switched to
> **REST over HTTPS with mutual TLS** (slice 9 decision).
>
> Why REST won:
> - Simpler debugging (`curl` works, no `grpcurl` setup)
> - TS↔Go type-sharing via plain JSON DTOs ([`packages/shared/src/transport.ts`](../shared/src/transport.ts))
> - Same security guarantee as gRPC+TLS via mutual TLS
> - No proto codegen toolchain required in CI
>
> Folder is kept as a vestigial marker. May be reused if Phase 3 needs a
> high-throughput streaming channel (e.g. real-time stats push from node to
> panel) — gRPC server-streaming is genuinely better for that case.
