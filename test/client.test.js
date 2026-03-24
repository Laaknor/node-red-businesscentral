"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildApiBaseUrl, withQuery } = require("../lib/businesscentral-client");

test("buildApiBaseUrl builds expected URL", () => {
  const url = buildApiBaseUrl({ tenantId: "tenant", environment: "Sandbox" });
  assert.equal(url, "https://api.businesscentral.dynamics.com/v2.0/tenant/Sandbox/api/v2.0");
});

test("withQuery appends query parameters", () => {
  assert.equal(withQuery("/companies(1)/customers", { $select: "id,name" }), "/companies(1)/customers?%24select=id%2Cname");
});
