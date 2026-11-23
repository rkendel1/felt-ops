import { test } from "node:test";
import assert from "node:assert/strict";
import * as L from "../src/index.js";
test("T07 factor, onRetry, retryable", async () => {
  const waits = []; const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms) => { waits.push(ms); return realSetTimeout(fn, 0); };
  try {
    const seen = []; let n = 0;
    const v = await L.retry(async () => { n++; if (n < 4) throw new Error("e" + n); return "ok"; }, { attempts: 5, delayMs: 10, factor: 2, onRetry: (err, attempt) => seen.push([err.message, attempt]) });
    assert.equal(v, "ok"); assert.deepEqual(waits, [10, 20, 40]); assert.deepEqual(seen, [["e1", 1], ["e2", 2], ["e3", 3]]);
    waits.length = 0; let m = 0; const fatal = Object.assign(new Error("fatal"), { retryable: false });
    await assert.rejects(L.retry(async () => { m++; throw fatal; }, { attempts: 5, delayMs: 10 }), /fatal/);
    assert.equal(m, 1); assert.deepEqual(waits, []);
    waits.length = 0; let k = 0;
    await assert.rejects(L.retry(async () => { k++; throw new Error("x"); }, { attempts: 3, delayMs: 5 }), /x/);
    assert.equal(k, 3); assert.deepEqual(waits, [5, 5]);
  } finally { globalThis.setTimeout = realSetTimeout; }
});
