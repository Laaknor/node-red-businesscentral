"use strict";

function normalizeEndpointEntry(entry) {
  if (!entry) return null;
  return {
    id: entry.id || entry.name || entry.path,
    name: entry.name || entry.id || entry.path,
    path: entry.path || entry.id || entry.name,
    entitySet: entry.entitySet || entry.id || entry.name || entry.path,
    groupLabel: entry.groupLabel || null,
    metadataPath: entry.metadataPath || "/$metadata",
    apiPublisher: entry.apiPublisher || null,
    apiGroup: entry.apiGroup || null,
    apiVersion: entry.apiVersion || null,
    supportsSelect: entry.supportsSelect !== false,
    supportsFilter: entry.supportsFilter !== false,
    requiresParent: Boolean(entry.requiresParent),
    parentEndpoint: entry.parentEndpoint || null,
    parentIdField: entry.parentIdField || "id",
    childPathTemplate: entry.childPathTemplate || null
  };
}

function buildDependencyMap(endpoints) {
  const map = {};
  (endpoints || []).forEach((entry) => {
    const normalized = normalizeEndpointEntry(entry);
    if (!normalized) return;
    map[normalized.id] = {
      requiresParent: normalized.requiresParent,
      parentEndpoint: normalized.parentEndpoint,
      parentIdField: normalized.parentIdField,
      childPathTemplate: normalized.childPathTemplate
    };
  });
  return map;
}

module.exports = {
  normalizeEndpointEntry,
  buildDependencyMap
};
