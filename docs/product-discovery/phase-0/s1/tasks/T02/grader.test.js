import { test } from "node:test";
import assert from "node:assert/strict";
import * as L from "../src/index.js";
test("T02 quoted fields", () => {
  assert.deepEqual(L.parseCSV('id,name\n1,"Smith, Jane"\n2,"He said ""hi"""\n'), [["id","name"],["1","Smith, Jane"],["2",'He said "hi"']]);
  assert.deepEqual(L.parseCSV('a,"b,c",d'), [["a","b,c","d"]]);
  assert.deepEqual(L.parseCSV('"",x,""'), [["","x",""]]);
  assert.deepEqual(L.parseCSV("a,b\r\n1,2\r\n"), [["a","b"],["1","2"]]);
  assert.deepEqual(L.parseCSV("a,,c"), [["a","","c"]]);
});
