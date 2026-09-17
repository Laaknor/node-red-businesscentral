"use strict";

function normalizeCsvList(input) {
  if (!input) return [];
  if (Array.isArray(input)) {
    return input.map((value) => String(value).trim()).filter(Boolean);
  }
  if (typeof input === "string") {
    return input.split(",").map((value) => value.trim()).filter(Boolean);
  }
  return [];
}

function uniqueNames(values) {
  const seen = new Set();
  const names = [];
  normalizeCsvList(values).forEach((name) => {
    if (seen.has(name)) return;
    seen.add(name);
    names.push(name);
  });
  return names;
}

function namesFromExpandOptions(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return uniqueNames(raw.map((item) => (typeof item === "string" ? item : item && item.name)));
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith("[")) {
      try {
        return namesFromExpandOptions(JSON.parse(trimmed));
      } catch (error) {
        return uniqueNames(trimmed);
      }
    }
    return uniqueNames(trimmed);
  }
  return [];
}

function splitSelectAndExpand({ selectedFields, selectedExpands, expandNames } = {}) {
  const expandSet = new Set(uniqueNames(expandNames));
  const fields = [];
  const expands = [];
  uniqueNames(selectedFields).forEach((name) => {
    if (expandSet.has(name)) expands.push(name);
    else fields.push(name);
  });
  uniqueNames(selectedExpands).forEach((name) => {
    if (!expands.includes(name)) expands.push(name);
  });
  return { selectedFields: fields, selectedExpands: expands };
}

function applySelectAndExpand(query, options = {}) {
  const next = { ...(query || {}) };
  const split = splitSelectAndExpand(options);
  if (split.selectedFields.length) {
    next.$select = split.selectedFields.join(",");
  }
  if (split.selectedExpands.length) {
    next.$expand = split.selectedExpands.join(",");
  }
  return next;
}

module.exports = {
  normalizeCsvList,
  uniqueNames,
  namesFromExpandOptions,
  splitSelectAndExpand,
  applySelectAndExpand
};
