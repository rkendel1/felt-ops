import { test } from "node:test";
import assert from "node:assert/strict";
import * as L from "../src/index.js";
test("T01 negative amounts", () => {
  assert.equal(L.formatMoney(-500), "-$5.00");
  assert.equal(L.formatMoney(-123456), "-$1,234.56");
  assert.equal(L.formatMoney(-5), "-$0.05");
  assert.equal(L.formatMoney(-99), "-$0.99");
  assert.equal(L.formatMoney(-150, "EUR"), "-€1.50");
  assert.equal(L.formatMoney(0), "$0.00");
  assert.equal(L.formatMoney(123456), "$1,234.56");
});
