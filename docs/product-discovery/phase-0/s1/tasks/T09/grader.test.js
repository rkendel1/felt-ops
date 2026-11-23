import { test } from "node:test";
import assert from "node:assert/strict";
import * as L from "../src/index.js";
test("T09 alignment", () => {
  assert.equal(L.renderTable([{ item: "Pen", qty: 2 }]), "| item | qty |\n| --- | ---: |\n| Pen | 2 |");
  assert.equal(L.renderTable([{ a: "x", b: "y", c: "z" }], { align: { a: "left", b: "right", c: "center" } }), "| a | b | c |\n| :--- | ---: | :---: |\n| x | y | z |");
  assert.equal(L.renderTable([{ n: 1 }, { n: "two" }]), "| n |\n| --- |\n| 1 |\n| two |");
  assert.equal(L.renderTable([]), "");
});
