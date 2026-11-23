import { test } from "node:test";
import assert from "node:assert/strict";
import * as L from "../src/index.js";
test("T10 summarizeInvoices", () => {
  const csv = "id,customer,amount\nINV-1,Acme,$1200.00\nINV-2,Globex,$300.50\nINV-3,Acme,$99.50\n";
  assert.deepEqual(L.summarizeInvoices(csv), { count: 3, totalCents: 160000, byCustomer: { Acme: 129950, Globex: 30050 } });
  assert.deepEqual(L.summarizeInvoices("id,customer,amount\n"), { count: 0, totalCents: 0, byCustomer: {} });
  assert.throws(() => L.summarizeInvoices("id,customer,amount\nINV-9,Acme,twelve\n"), /INV-9/);
});
