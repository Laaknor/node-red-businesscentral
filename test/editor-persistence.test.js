"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("businesscentral-get editor persists lookup names and refreshes on load", () => {
  const html = fs.readFileSync(path.join(__dirname, "../nodes/businesscentral-get.html"), "utf8");

  assert.match(html, /companyOptions: \{ value: "\[\]" \}/);
  assert.match(html, /endpointOptions: \{ value: "\[\]" \}/);
  assert.match(html, /fieldOptions: \{ value: "\[\]" \}/);
  assert.match(html, /endpointName: \{ value: "" \}/);
  assert.match(html, /id="node-input-companyOptions"/);
  assert.match(html, /id="node-input-endpointName"/);
  assert.match(html, /id="node-input-endpointOptions"/);
  assert.match(html, /id="node-input-fieldOptions"/);
  assert.match(html, /id="bc-selected-fields"/);
  assert.match(html, /id="node-input-selectedFields"/);
  assert.match(html, /function persistLookups\(/);
  assert.match(html, /companyCache = slimCompanies\(items\)/);
  assert.match(html, /endpointCache = slimEndpoints\(items\)/);
  assert.match(html, /fieldCache = slimFields\(items\)/);
});
