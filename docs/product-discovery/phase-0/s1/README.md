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

## Resume in a new session (S1 was blocked in the first Phase 0 session)

Environment variables are read at session start, so a key updated in the environment settings needs a new session.

1. Check the key: `curl -s -o /dev/null -w '%{http_code}' https://api.anthropic.com/v1/models -H "x-api-key: $BENCH_API_KEY" -H 'anthropic-version: 2023-06-01'` must print `200`.
2. Start Docker if no daemon is running: `dockerd >/tmp/dockerd.log 2>&1 &`.
3. Node 24 for EVE (the container has Node 22): download `node-v24.x-linux-x64.tar.xz` from nodejs.org and put its `bin` first on `PATH` for the harness only.
4. `cd harness/eve-template && npx -y pnpm@10 install`.
5. Model routing (pre-registered model `anthropic/claude-sonnet-5.5` for both harnesses):
   - **H-EVE** must call Anthropic directly with `BENCH_API_KEY`. The AI Gateway key is free tier and refuses Anthropic models. Set the agent's model to the AI SDK Anthropic provider (`@ai-sdk/anthropic`, model `claude-sonnet-5-5`, key from `BENCH_API_KEY`) instead of the gateway string. This is a routing change, not a model change; record it as a deviation.
   - **H-CC** (Claude Code headless, to be built): `ANTHROPIC_API_KEY=$BENCH_API_KEY claude -p ... --model claude-sonnet-5-5 --output-format stream-json`, inside a Docker container with the workspace copy.
6. Run all 10 tasks with both harnesses, one attempt each, and apply the PROTOCOL's pass/fail rule.
