"use strict";

function quoteString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function encodeValue(value, valueType) {
  if (valueType === "number" || valueType === "integer" || valueType === "decimal") {
    return String(value);
  }
  if (valueType === "boolean") {
    return String(value).toLowerCase() === "true" ? "true" : "false";
  }
  return quoteString(value);
}

function conditionToFilter(condition) {
  const field = condition.field;
  const operator = condition.operator;
  const value = encodeValue(condition.value, condition.valueType);
  if (operator === "contains" || operator === "startswith" || operator === "endswith") {
    return `${operator}(${field},${value})`;
  }
  return `${field} ${operator} ${value}`;
}

function buildGroup(group) {
  const logic = (group.logic || "and").toLowerCase();
  const parts = [];
  (group.conditions || []).forEach((condition) => {
    parts.push(conditionToFilter(condition));
  });
  (group.groups || []).forEach((nested) => {
    parts.push(buildGroup(nested));
  });
  if (!parts.length) return "";
  if (parts.length === 1) return parts[0];
  return `(${parts.join(` ${logic} `)})`;
}

function buildFilterString(filterGroups) {
  if (!filterGroups || !Array.isArray(filterGroups.groups)) return "";
  const logic = (filterGroups.logic || "and").toLowerCase();
  const groupParts = filterGroups.groups.map(buildGroup).filter(Boolean);
  if (!groupParts.length) return "";
  if (groupParts.length === 1) return groupParts[0];
  return groupParts.join(` ${logic} `);
}

module.exports = {
  buildFilterString
};
