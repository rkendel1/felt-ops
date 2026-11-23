import { test } from "node:test";
import assert from "node:assert/strict";
import * as L from "../src/index.js";
test("T08 maxLength", () => {
  assert.equal(L.slugify("The quick brown fox", { maxLength: 12 }), "the-quick");
  assert.equal(L.slugify("The quick brown fox", { maxLength: 15 }), "the-quick-brown");
  assert.equal(L.slugify("Supercalifragilistic", { maxLength: 5 }), "super");
  assert.equal(L.slugify("Héllo, World!"), "hello-world");
  assert.equal(L.slugify("a b c", { maxLength: 100 }), "a-b-c");
  for (const n of [1, 2, 3, 4, 6, 9, 10]) { const s = L.slugify("The quick brown fox", { maxLength: n }); assert.ok(s.length <= n && !s.endsWith("-") && s.length > 0, n + ":" + s); }
});
