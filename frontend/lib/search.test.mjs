// npm test. Node's own test runner, which imports search.ts directly (Node 23.6+ strips the types).
// Expected values follow what the user should see (results always belong to the text in the box),
// not what the component used to do.
import { test } from "node:test";
import assert from "node:assert/strict";
import { enterTarget, normaliseQuery, visibleState } from "./search.ts";

const nurse = { kind: "done", q: "nurse", total: 2, roles: [{ slug: "staff-nurse" }, { slug: "nurse" }] };

test("Enter never opens an earlier query's top result", () => {
  // "nurse" results are showing; the user replaces the text with "chef" and presses Enter before the new results arrive
  assert.equal(enterTarget(nurse, "chef"), undefined);
  // typed on: "data" results are held, the box now says "data analyst"
  const data = { kind: "done", q: "data", total: 1, roles: [{ slug: "data-entry-clerk" }] };
  assert.equal(enterTarget(data, "data analyst"), undefined);
});

test("earlier results are hidden while the new query is pending", () => {
  assert.deepEqual(visibleState(nurse, "chef"), { kind: "loading" });
  assert.deepEqual(visibleState(nurse, "nurses"), { kind: "loading" });
});

test("Enter opens the top result for the current text", () => {
  assert.equal(enterTarget(nurse, "nurse"), "staff-nurse");
});

test("Enter with no results, an error, or too little text does nothing", () => {
  assert.equal(enterTarget({ kind: "done", q: "zzz", total: 0, roles: [] }, "zzz"), undefined);
  assert.equal(enterTarget({ kind: "error" }, "chef"), undefined);
  assert.equal(enterTarget({ kind: "loading" }, "chef"), undefined);
  assert.equal(enterTarget(nurse, "n"), undefined);
  assert.equal(enterTarget(nurse, ""), undefined);
});

test("below two characters the box is idle, whatever was there before", () => {
  assert.deepEqual(visibleState(nurse, "n"), { kind: "idle" });
  assert.deepEqual(visibleState({ kind: "error" }, ""), { kind: "idle" });
});

test("errors and pending searches show as they are", () => {
  assert.deepEqual(visibleState({ kind: "error" }, "chef"), { kind: "error" });
  assert.deepEqual(visibleState({ kind: "loading" }, "chef"), { kind: "loading" });
});

test("query normalisation", () => {
  assert.equal(normaliseQuery("  data   analyst "), "data analyst");
  assert.equal(normaliseQuery("data\tanalyst\n"), "data analyst");
  assert.equal(normaliseQuery("   "), "");
  assert.equal(normaliseQuery("c++"), "c++");
});
