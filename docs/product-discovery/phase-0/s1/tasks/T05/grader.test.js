import { test } from "node:test";
import assert from "node:assert/strict";
import * as L from "../src/index.js";
test("T05 numeric compare", () => {
  assert.equal(L.compareVersions("1.10.0", "1.9.0"), 1);
  assert.equal(L.compareVersions("1.9.0", "1.10.0"), -1);
  assert.equal(L.compareVersions("1.2", "1.2.0"), 0);
  assert.equal(L.compareVersions("v2.0.0", "2.0.0"), 0);
  assert.equal(L.compareVersions("2", "1.99.99"), 1);
  assert.equal(L.compareVersions("0.0.10", "0.0.9"), 1);
});
