import { test } from "node:test";
import assert from "node:assert/strict";
import * as L from "../src/index.js";
const d = (s) => new Date(s + "T00:00:00Z");
const iso = (x) => x.toISOString().slice(0, 10);
test("T03 weekends", () => {
  assert.equal(iso(L.addBusinessDays(d("2026-11-06"), 1)), "2026-11-09");
  assert.equal(iso(L.addBusinessDays(d("2026-11-06"), 3)), "2026-11-11");
  assert.equal(iso(L.addBusinessDays(d("2026-11-07"), 1)), "2026-11-09");
  assert.equal(iso(L.addBusinessDays(d("2026-11-08"), 1)), "2026-11-09");
  assert.equal(iso(L.addBusinessDays(d("2026-11-02"), 0)), "2026-11-02");
  assert.equal(iso(L.addBusinessDays(d("2026-11-02"), 10)), "2026-11-16");
  const start = d("2026-11-06"); L.addBusinessDays(start, 2); assert.equal(iso(start), "2026-11-06");
});
