"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildFilterString } = require("../lib/filter-builder");

test("buildFilterString builds grouped expression", () => {
  const filterGroups = {
    logic: "and",
    groups: [
      {
        logic: "or",
        conditions: [
          { field: "no", operator: "eq", value: "1000", valueType: "string" },
          { field: "no", operator: "eq", value: "2000", valueType: "string" }
        ]
      },
      {
        logic: "and",
        conditions: [
          { field: "unitPrice", operator: "ge", value: 10, valueType: "number" }
        ]
      }
    ]
  };
  assert.equal(buildFilterString(filterGroups), "(no eq '1000' or no eq '2000') and unitPrice ge 10");
});
