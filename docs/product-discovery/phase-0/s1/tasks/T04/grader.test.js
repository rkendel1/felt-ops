import { test } from "node:test";
import assert from "node:assert/strict";
import * as L from "../src/index.js";
test("T04 recency on get", () => {
  const c = new L.LRUCache(2);
  c.set("a", 1).set("b", 2); assert.equal(c.get("a"), 1); c.set("c", 3);
  assert.equal(c.has("a"), true); assert.equal(c.has("b"), false); assert.equal(c.has("c"), true);
  assert.equal(c.get("missing"), undefined); assert.equal(c.size, 2);
  const d = new L.LRUCache(2); d.set("x", 0); d.set("y", 1); d.get("x"); d.set("y", 2); d.set("z", 3);
  assert.equal(d.has("x"), false); assert.equal(d.get("y"), 2);
});
