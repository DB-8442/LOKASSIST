const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
if (!script) throw new Error("Inline script not found in index.html");

const helpers = script.match(
  /function extractCategoryFromLine[\s\S]*?\n}\nfunction getTfClassification[\s\S]*?\n}/,
)?.[0];
if (!helpers) throw new Error("Line classification helpers not found");

const context = {};
vm.createContext(context);
vm.runInContext(helpers, context);

test("splits unambiguous API line labels into category and normalized line", () => {
  for (const [raw, category, line] of [
    ["MEX18", "MEX", "MEX 18"],
    ["MEX 18", "MEX", "MEX 18"],
    ["RE6", "RE", "RE 6"],
    ["RE 6", "RE", "RE 6"],
    ["RB18", "RB", "RB 18"],
    ["RB 18", "RB", "RB 18"],
    ["S8", "S", "S 8"],
  ]) {
    assert.deepEqual(
      JSON.parse(JSON.stringify(context.extractCategoryFromLine(raw))),
      { category, line },
    );
  }
});

test("leaves unclear labels without a category", () => {
  assert.deepEqual(
    JSON.parse(JSON.stringify(context.extractCategoryFromLine("Express Süd"))),
    { category: "", line: "Express Süd" },
  );
});

test("derives legacy automatic display values without changing manual values", () => {
  assert.deepEqual(
    JSON.parse(JSON.stringify(context.getTfClassification({ source: "automatic", line: "MEX18" }))),
    { category: "MEX", line: "MEX 18" },
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(context.getTfClassification({ source: "manual", category: "Sonstige", line: "MEX18" }))),
    { category: "Sonstige", line: "MEX18" },
  );
});
