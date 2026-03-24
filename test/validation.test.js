"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { validateNodeConfig } = require("../lib/validation");

test("validateNodeConfig accepts minimal valid config", () => {
  assert.doesNotThrow(() => {
    validateNodeConfig(
      {
        tenantId: "tenant",
        environment: "Sandbox",
        company: "company",
        endpoint: "customers",
        fetchMode: "All"
      },
      { clientId: "id", clientSecret: "secret" }
    );
  });
});

test("validateNodeConfig rejects invalid fetchMode", () => {
  assert.throws(() => {
    validateNodeConfig(
      {
        tenantId: "tenant",
        environment: "Sandbox",
        company: "company",
        endpoint: "customers",
        fetchMode: "Everything"
      },
      { clientId: "id", clientSecret: "secret" }
    );
  });
});
