# Phase 0 / S1: EVE coding quality (prepared, not yet run)

Pre-registered in [../PROTOCOL.md](../PROTOCOL.md). Status in [../RESULTS.md](../RESULTS.md).

| Path | What |
|---|---|
| `fixture/` | `ledgerlite`, a zero-dependency ES-module library; visible suite `npm test` (10 tests) |
| `tasks/T01–T10/` | `prompt.md` (given verbatim to both harnesses), `grader.test.js` (hidden), `reference.patch` (validates the grader only) |
| `grade.mjs` | `node grade.mjs <workspace> <task>`: the protocol's *usable* verdict as JSON |
| `harness/run-eve.mjs`, `harness/eve-template/` | H-EVE: `@appport/eve` 1.0.2 (aliased as `eve`), `eve/extensions/code`, Docker sandbox, network deny-all |

Validity checks (all 10 pass): `node grade.mjs fixture <T>` must report `graderPass: false`;
the same on `fixture` + `reference.patch` must report `usable: true`.

Run one EVE attempt (Node 24, Docker, `AI_GATEWAY_API_KEY`; `cd harness/eve-template && pnpm install` first):

```bash
MODEL=anthropic/claude-sonnet-5.5 node harness/run-eve.mjs T01 /tmp/s1/eve/T01
```
