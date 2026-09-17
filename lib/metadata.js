"use strict";

function parseEntitySetsFromMetadata(xmlText) {
  const xml = String(xmlText || "");
  return [...xml.matchAll(/EntitySet Name="([^"]+)"/g)].map((match) => match[1]);
}

function getEntityTypeBlock(xmlText, entitySetName) {
  const xml = String(xmlText || "");
  const wantedSet = String(entitySetName || "").toLowerCase();
  const typeCandidates = [];

  for (const match of xml.matchAll(/<EntitySet\b([^>]*)\/?>/gi)) {
    const attrs = match[1] || "";
    const setName = attrs.match(/\bName="([^"]+)"/i)?.[1] || "";
    if (setName.toLowerCase() !== wantedSet) continue;
    const entityTypeFullName = attrs.match(/\bEntityType="([^"]+)"/i)?.[1];
    if (entityTypeFullName) {
      typeCandidates.push(entityTypeFullName.split(".").pop());
    }
  }
  if (entitySetName) {
    typeCandidates.push(entitySetName);
  }

  const wantedTypes = new Set(typeCandidates.map((name) => String(name || "").toLowerCase()).filter(Boolean));
  for (const match of xml.matchAll(/<EntityType\b([^>]*)>([\s\S]*?)<\/EntityType>/gi)) {
    const name = (match[1] || "").match(/\bName="([^"]+)"/i)?.[1] || "";
    if (wantedTypes.has(name.toLowerCase())) {
      return match[2] || "";
    }
  }
  return "";
}

function parseFieldsFromMetadata(xmlText, entitySetName) {
  const entityBlock = getEntityTypeBlock(xmlText, entitySetName);
  if (!entityBlock) return [];

  return [...entityBlock.matchAll(/<Property\s+Name="([^"]+)"\s+Type="([^"]+)"/g)].map((match) => ({
    name: match[1],
    label: match[1],
    type: match[2].includes("Int") || match[2].includes("Decimal") ? "number" : "string"
  }));
}

function parseExpandPropertiesFromMetadata(xmlText, entitySetName) {
  const entityBlock = getEntityTypeBlock(xmlText, entitySetName);
  if (!entityBlock) return [];

  const seen = new Set();
  const expands = [];
  for (const match of entityBlock.matchAll(/<NavigationProperty\s+([^>/]+)/gi)) {
    const attrs = match[1] || "";
    const name = attrs.match(/\bName="([^"]+)"/i)?.[1];
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const type = attrs.match(/\bType="([^"]+)"/i)?.[1] || "";
    const isCollection = /Collection\s*\(/i.test(type);
    expands.push({
      name,
      label: isCollection ? `${name} (expand, collection)` : `${name} (expand)`,
      type,
      isCollection
    });
  }
  return expands;
}

function deriveMetadataContext(endpointValue, providedEntitySet, providedMetadataPath) {
  const endpoint = String(endpointValue || "");
  const entitySet = providedEntitySet || endpoint.split("/").filter(Boolean).pop() || endpoint || "";
  let metadataPath = providedMetadataPath || "";
  if (endpoint.startsWith("/api/")) {
    const parts = endpoint.split("/").filter(Boolean);
    if (parts.length >= 5) {
      const derivedPath = `/${parts.slice(0, 4).join("/")}/$metadata`;
      if (!metadataPath || metadataPath === "/$metadata") {
        metadataPath = derivedPath;
      }
    }
  }
  return { entitySet, metadataPath: metadataPath || "/$metadata" };
}

module.exports = {
  parseEntitySetsFromMetadata,
  parseFieldsFromMetadata,
  parseExpandPropertiesFromMetadata,
  deriveMetadataContext
};
