import { test } from "node:test";
import assert from "node:assert/strict";
import * as L from "../src/index.js";
test("T06 repeated keys", () => {
  assert.deepEqual(L.parseQuery("a=1&a=2&b=3"), { a: ["1", "2"], b: "3" });
  assert.equal(L.stringifyQuery({ a: ["1", "2"], b: "3" }), "a=1&a=2&b=3");
  assert.deepEqual(L.parseQuery("q=hello+world"), { q: "hello world" });
  assert.deepEqual(L.parseQuery("?a=1&b=two%20words"), { a: "1", b: "two words" });
  assert.equal(L.stringifyQuery({ a: "1", b: "x y" }), "a=1&b=x%20y");
  assert.deepEqual(L.parseQuery("x=1&x=2&x=3"), { x: ["1", "2", "3"] });
});
