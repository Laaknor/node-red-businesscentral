"use strict";

const allowedFetchModes = new Set(["All", "Filtered"]);
const allowedLogic = new Set(["and", "or"]);
const allowedOperators = new Set([
  "eq",
  "ne",
  "gt",
  "ge",
  "lt",
  "le",
  "contains",
  "startswith",
  "endswith"
]);

function assertRequired(value, fieldName) {
  if (value === undefined || value === null || value === "") {
    throw new Error(`Missing required field: ${fieldName}`);
  }
}

function validateFilterGroups(filterGroups) {
  if (!filterGroups) return;
  if (!Array.isArray(filterGroups.groups)) {
    throw new Error("filterGroups.groups must be an array");
  }
  if (filterGroups.logic && !allowedLogic.has(String(filterGroups.logic).toLowerCase())) {
    throw new Error("filterGroups.logic must be and/or");
  }
  filterGroups.groups.forEach((group, index) => {
    validateGroup(group, `filterGroups.groups[${index}]`);
  });
}

function validateGroup(group, path) {
  if (group.logic && !allowedLogic.has(String(group.logic).toLowerCase())) {
    throw new Error(`${path}.logic must be and/or`);
  }
  const conditions = group.conditions || [];
  if (!Array.isArray(conditions)) {
    throw new Error(`${path}.conditions must be an array`);
  }
  conditions.forEach((condition, index) => {
    assertRequired(condition.field, `${path}.conditions[${index}].field`);
    assertRequired(condition.operator, `${path}.conditions[${index}].operator`);
    assertRequired(condition.value, `${path}.conditions[${index}].value`);
    if (!allowedOperators.has(condition.operator)) {
      throw new Error(`${path}.conditions[${index}].operator is invalid`);
    }
  });
  if (group.groups) {
    if (!Array.isArray(group.groups)) {
      throw new Error(`${path}.groups must be an array`);
    }
    group.groups.forEach((nested, index) => {
      validateGroup(nested, `${path}.groups[${index}]`);
    });
  }
}

function validateNodeConfig(config, context = {}) {
  assertRequired(config.tenantId, "tenantId");
  assertRequired(config.environment, "environment");
  assertRequired(config.company, "company");
  assertRequired(config.endpoint, "endpoint");
  assertRequired(context.clientId, "clientId");
  assertRequired(context.clientSecret, "clientSecret");

  const fetchMode = config.fetchMode || "All";
  if (!allowedFetchModes.has(fetchMode)) {
    throw new Error("fetchMode must be All or Filtered");
  }

  if (fetchMode === "Filtered") {
    validateFilterGroups(config.filterGroups);
  }
}

module.exports = {
  validateNodeConfig,
  validateFilterGroups
};
