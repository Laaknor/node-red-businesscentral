"use strict";

const { bcRequest, pagedGetAll } = require("../lib/businesscentral-client");
const { validateNodeConfig } = require("../lib/validation");
const { buildFilterString } = require("../lib/filter-builder");
const { normalizeEndpointEntry, buildDependencyMap } = require("../lib/endpoints");

const DEFAULT_SCOPE = "https://api.businesscentral.dynamics.com/.default";
const DEFAULT_MAX_PARENTS = 500;
const DEFAULT_CONCURRENCY = 5;

async function withRetry(task, options = {}) {
  const retries = options.retries ?? 2;
  const baseDelayMs = options.baseDelayMs ?? 500;
  let lastErr;
  for (let i = 0; i <= retries; i += 1) {
    try {
      return await task();
    } catch (err) {
      lastErr = err;
      const retryable = err.statusCode === 429 || (err.statusCode >= 500 && err.statusCode <= 599);
      if (!retryable || i === retries) {
        throw err;
      }
      const wait = baseDelayMs * (i + 1);
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
  throw lastErr;
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = [];
  const workers = new Array(Math.max(1, limit)).fill(0).map(async (_, workerIndex) => {
    for (let i = workerIndex; i < items.length; i += limit) {
      results[i] = await mapper(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

function normalizeFilterGroups(input) {
  if (!input) return null;
  let parsed = input;
  if (typeof input === "string") {
    try {
      parsed = JSON.parse(input);
    } catch (error) {
      return null;
    }
  }
  if (Array.isArray(parsed)) {
    return { logic: "and", groups: parsed };
  }
  if (parsed && typeof parsed === "object") {
    if (Array.isArray(parsed.groups)) {
      // Common payload shape from upstream nodes:
      // { logic, conditions:[...], groups:[] }
      // Convert to root wrapper expected by buildFilterString.
      if (parsed.groups.length === 0 && Array.isArray(parsed.conditions) && parsed.conditions.length > 0) {
        return {
          logic: parsed.logic || "and",
          groups: [{
            logic: parsed.logic || "and",
            conditions: parsed.conditions,
            groups: []
          }]
        };
      }
      return parsed;
    }
    // Allow a single group object shape: { logic, conditions, groups }
    if (Array.isArray(parsed.conditions) || Array.isArray(parsed.groups)) {
      return {
        logic: "and",
        groups: [parsed]
      };
    }
  }
  return null;
}

function normalizeSelectedFields(input) {
  if (!input) return [];
  if (Array.isArray(input)) return input;
  if (typeof input === "string") {
    return input
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

function resolveParentId(nodeConfig, msg) {
  const source = nodeConfig.parentIdSource || "msg";
  if (source === "fixed") {
    return nodeConfig.parentIdFixed;
  }
  const field = nodeConfig.parentIdMsgField || "parentId";
  return msg[field];
}

function resolveEndpointPath(companyId, endpointValue) {
  if (typeof endpointValue === "string" && endpointValue.startsWith("/")) {
    return endpointValue.replace(/\{companyId\}/g, companyId);
  }
  return `/companies(${companyId})/${endpointValue}`;
}

function usesRootApiPrefix(path) {
  return typeof path === "string" && path.startsWith("/api/");
}

function needsCompanyQuery(path) {
  return usesRootApiPrefix(path) && path.indexOf("/companies(") === -1;
}

function parseEntitySetsFromMetadata(xmlText) {
  const xml = String(xmlText || "");
  const setMatches = [...xml.matchAll(/EntitySet Name="([^"]+)"/g)];
  return setMatches.map((match) => match[1]);
}

function parseFieldsFromMetadata(xmlText, entitySetName) {
  const xml = String(xmlText || "");
  const escapedEntitySet = String(entitySetName || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // First resolve entity set -> entity type full name (e.g. Microsoft.NAV.customer)
  const setRegex = new RegExp(`EntitySet\\s+Name="${escapedEntitySet}"\\s+EntityType="([^"]+)"`, "i");
  const entityTypeFullName = xml.match(setRegex)?.[1];

  // Then resolve type short name for matching <EntityType Name="...">
  const typeCandidates = [];
  if (entityTypeFullName) {
    typeCandidates.push(entityTypeFullName.split(".").pop());
  }
  if (entitySetName) {
    typeCandidates.push(entitySetName);
  }

  let entityBlock = "";
  for (const candidate of typeCandidates) {
    if (!candidate) continue;
    const escapedCandidate = String(candidate).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const entityRegex = new RegExp(`<EntityType\\s+Name="${escapedCandidate}"([\\s\\S]*?)</EntityType>`, "i");
    entityBlock = xml.match(entityRegex)?.[1] || "";
    if (entityBlock) break;
  }
  if (!entityBlock) return [];

  return [...entityBlock.matchAll(/Property\s+Name="([^"]+)"\s+Type="([^"]+)"/g)].map((m) => ({
    name: m[1],
    label: m[1],
    type: m[2].includes("Int") || m[2].includes("Decimal") ? "number" : "string"
  }));
}

function deriveMetadataContext(endpointValue, providedEntitySet, providedMetadataPath) {
  if (providedEntitySet && providedMetadataPath) {
    return { entitySet: providedEntitySet, metadataPath: providedMetadataPath };
  }
  const endpoint = String(endpointValue || "");
  if (!endpoint) return { entitySet: "", metadataPath: "/$metadata" };
  const entitySet = providedEntitySet || endpoint.split("/").filter(Boolean).pop() || endpoint;
  if (providedMetadataPath) {
    return { entitySet, metadataPath: providedMetadataPath };
  }
  if (endpoint.startsWith("/api/")) {
    const parts = endpoint.split("/").filter(Boolean);
    // /api/{publisher}/{group}/{version}/{entitySet}
    if (parts.length >= 5) {
      return {
        entitySet,
        metadataPath: `/${parts.slice(0, 4).join("/")}/$metadata`
      };
    }
  }
  return { entitySet, metadataPath: "/$metadata" };
}

function parseCustomApiNamespaces(rawValue) {
  if (!rawValue) return [];
  try {
    const parsed = typeof rawValue === "string" ? JSON.parse(rawValue) : rawValue;
    const asArray = Array.isArray(parsed) ? parsed : [parsed];
    return asArray
      .map((row) => ({
        apiPublisher: String(row.apiPublisher || "").trim(),
        apiGroup: String(row.apiGroup || "").trim(),
        apiVersion: String(row.apiVersion || "").trim()
      }))
      .filter((row) => row.apiPublisher && row.apiGroup && row.apiVersion);
  } catch (error) {
    return [];
  }
}

function getByPath(obj, path) {
  const parts = String(path || "").split(".").filter(Boolean);
  let current = obj;
  for (const part of parts) {
    if (current == null) return undefined;
    current = current[part];
  }
  return current;
}

function resolveTemplateValue(value, msg) {
  if (typeof value !== "string") return value;
  const onlyTemplate = value.match(/^\{\{\s*msg\.([^\}]+)\s*\}\}$/);
  if (onlyTemplate) {
    return getByPath(msg, onlyTemplate[1].trim());
  }
  return value.replace(/\{\{\s*msg\.([^\}]+)\s*\}\}/g, (_, path) => {
    const resolved = getByPath(msg, String(path).trim());
    return resolved === undefined || resolved === null ? "" : String(resolved);
  });
}

function resolveTemplatesDeep(input, msg) {
  if (Array.isArray(input)) {
    return input.map((item) => resolveTemplatesDeep(item, msg));
  }
  if (input && typeof input === "object") {
    const out = {};
    Object.keys(input).forEach((key) => {
      out[key] = resolveTemplatesDeep(input[key], msg);
    });
    return out;
  }
  return resolveTemplateValue(input, msg);
}

function getCredentials(RED, node, msg) {
  const configNodeId = node.config.bcConfig;
  const storedCredentials = configNodeId ? RED.nodes.getCredentials(configNodeId) : null;
  return {
    clientId: msg.clientId || storedCredentials?.clientId,
    clientSecret: msg.clientSecret || storedCredentials?.clientSecret
  };
}

module.exports = function (RED) {
  function BusinessCentralConfigNode(config) {
    RED.nodes.createNode(this, config);
    this.tenantId = config.tenantId;
    this.environment = config.environment;
    this.customApiNamespaces = config.customApiNamespaces || "[]";
  }

  function BusinessCentralGetNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;
    node.config = config;
    node.bcConfigNode = RED.nodes.getNode(config.bcConfig);

    node.on("input", async function (msg, send, done) {
      send = send || function () { node.send.apply(node, arguments); };
      try {
        const hasRuntimeFilterGroups = Object.prototype.hasOwnProperty.call(msg, "filterGroups");
        const tenantId = msg.tenantId || node.bcConfigNode?.tenantId;
        const environment = msg.environment || node.bcConfigNode?.environment;
        const effective = {
          ...config,
          tenantId,
          environment,
          company: msg.company || config.company,
          companyName: msg.companyName || config.companyName || config.company,
          endpoint: msg.endpoint || config.endpoint
        };
        const normalizedConfiguredFilterGroups = normalizeFilterGroups(effective.filterGroups);
        // Guard against legacy/invalid persisted values; msg.filterGroups can still override at runtime.
        effective.filterGroups =
          normalizedConfiguredFilterGroups && typeof normalizedConfiguredFilterGroups === "object"
            ? normalizedConfiguredFilterGroups
            : null;
        const credentials = getCredentials(RED, node, msg);
        validateNodeConfig(effective, credentials);

        const query = { ...(msg.query || {}) };
        const selectedFields = normalizeSelectedFields(effective.selectedFields || msg.selectedFields);
        if (selectedFields.length) {
          query.$select = selectedFields.join(",");
        }

        const fetchMode = effective.fetchMode || "All";
        const rawFilterGroups = hasRuntimeFilterGroups ? msg.filterGroups : effective.filterGroups;
        const runtimeFilterGroups = normalizeFilterGroups(rawFilterGroups);
        let appliedFilter = "";
        if (hasRuntimeFilterGroups && !runtimeFilterGroups) {
          throw new Error("msg.filterGroups is invalid. Expected {logic,groups} or equivalent group structure.");
        }
        if (fetchMode === "Filtered" && !runtimeFilterGroups) {
          throw new Error("fetchMode is Filtered, but no valid filterGroups were provided.");
        }
        if (runtimeFilterGroups && (fetchMode === "Filtered" || hasRuntimeFilterGroups)) {
          const filterString = buildFilterString(runtimeFilterGroups);
          if (filterString) {
            query.$filter = filterString;
            appliedFilter = filterString;
          } else if (fetchMode === "Filtered") {
            throw new Error("fetchMode is Filtered, but filterGroups did not produce a valid OData filter.");
          }
        }

        const dependencyMeta = normalizeFilterGroups(effective.endpointDependencyMeta || msg.endpointDependencyMeta) || {};
        const requiresParent = Boolean(dependencyMeta.requiresParent);
        const parentMode = effective.parentMode || "Single Parent";
        const maxParents = Number(effective.maxParents || DEFAULT_MAX_PARENTS);
        const concurrency = Number(effective.concurrencyLimit || DEFAULT_CONCURRENCY);

        if (!requiresParent) {
          const path = resolveEndpointPath(effective.company, effective.endpoint);
          const queryWithCompany = { ...query };
          if (needsCompanyQuery(path) && !queryWithCompany.company) {
            queryWithCompany.company = effective.companyName;
          }
          const response = await withRetry(() =>
            bcRequest({
              tenantId: effective.tenantId,
              environment: effective.environment,
              clientId: credentials.clientId,
              clientSecret: credentials.clientSecret,
              scope: effective.scope || DEFAULT_SCOPE,
              apiPathPrefix: usesRootApiPrefix(path) ? "" : "/api/v2.0",
              path,
              query: queryWithCompany
            })
          );
          msg.payload = response.data;
          msg.statusCode = response.statusCode;
          msg.bc = {
            companyId: effective.company,
            endpoint: effective.endpoint,
            requestUrl: response.url,
            requestId: response.headers.get("x-ms-correlation-id") || response.headers.get("request-id") || null,
            requiresParent: false,
            appliedFilter: appliedFilter || null
          };
          send(msg);
          done();
          return;
        }

        const meta = {
          companyId: effective.company,
          endpoint: effective.endpoint,
          requiresParent: true,
          parentEndpoint: dependencyMeta.parentEndpoint || null,
          parentsProcessed: 0,
          failedParents: []
        };

        if (parentMode === "Single Parent") {
          const parentId = resolveParentId(effective, msg);
          if (!parentId) {
            throw new Error("Dependent endpoint requires parent id for Single Parent mode");
          }
          const pathTemplate = dependencyMeta.childPathTemplate
            || `/companies({companyId})/${dependencyMeta.parentEndpoint || "parents"}({parentId})/${effective.endpoint}`;
          const path = pathTemplate
            .replace("{companyId}", effective.company)
            .replace("{parentId}", parentId);
          const response = await withRetry(() =>
            bcRequest({
              tenantId: effective.tenantId,
              environment: effective.environment,
              clientId: credentials.clientId,
              clientSecret: credentials.clientSecret,
              scope: effective.scope || DEFAULT_SCOPE,
              path,
              query
            })
          );
          meta.parentsProcessed = 1;
          msg.payload = response.data;
          msg.statusCode = response.statusCode;
          msg.bc = {
            ...meta,
            requestUrl: response.url
          };
          send(msg);
          done();
          return;
        }

        const parentEndpoint = dependencyMeta.parentEndpoint;
        const parentIdField = dependencyMeta.parentIdField || "id";
        if (!parentEndpoint) {
          throw new Error("Missing parentEndpoint metadata for dependent endpoint");
        }

        const parentRows = await withRetry(() =>
          pagedGetAll({
            tenantId: effective.tenantId,
            environment: effective.environment,
            clientId: credentials.clientId,
            clientSecret: credentials.clientSecret,
            scope: effective.scope || DEFAULT_SCOPE,
            path: `/companies(${effective.company})/${parentEndpoint}`,
            query: msg.parentQuery || {}
          })
        );
        if (parentRows.length > maxParents) {
          throw new Error(`Parent record cap exceeded (${parentRows.length} > ${maxParents})`);
        }

        const pathTemplate = dependencyMeta.childPathTemplate
          || `/companies({companyId})/${parentEndpoint}({parentId})/${effective.endpoint}`;
        const childrenByParent = await mapWithConcurrency(parentRows, concurrency, async (row) => {
          const parentId = row[parentIdField];
          if (!parentId) {
            return { error: "Missing parent id field", parent: row };
          }
          const path = pathTemplate
            .replace("{companyId}", effective.company)
            .replace("{parentId}", parentId);
          try {
            const response = await withRetry(() =>
              pagedGetAll({
                tenantId: effective.tenantId,
                environment: effective.environment,
                clientId: credentials.clientId,
                clientSecret: credentials.clientSecret,
                scope: effective.scope || DEFAULT_SCOPE,
                path,
                query
              })
            );
            return { parentId, rows: response };
          } catch (error) {
            return {
              parentId,
              error: error.message,
              statusCode: error.statusCode || null
            };
          }
        });

        const aggregated = [];
        childrenByParent.forEach((entry) => {
          if (entry.error) {
            meta.failedParents.push(entry);
            return;
          }
          aggregated.push(...entry.rows);
        });
        meta.parentsProcessed = parentRows.length;
        msg.payload = aggregated;
        msg.statusCode = meta.failedParents.length ? 207 : 200;
        msg.bc = meta;
        send(msg);
        done();
      } catch (error) {
        if (error && typeof error.message === "string") {
          const msgText = error.message;
          const typeMismatch = /incompatible types/i.test(msgText)
            && /Edm\.String/i.test(msgText)
            && /Edm\.(Int|Decimal|Double|Single)/i.test(msgText);
          if (typeMismatch) {
            error.message = `${msgText} Hint: this endpoint field is text. In businesscentral-filter, set condition valueType to "string" (or send the value as a quoted string template).`;
          }
        }
        node.error(error, msg);
        done(error);
      }
    });
  }

  function BusinessCentralFilterNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;
    node.on("input", function (msg, send, done) {
      send = send || function () { node.send.apply(node, arguments); };
      try {
        const parsed = normalizeFilterGroups(config.filterGroups);
        if (parsed) {
          msg.filterGroups = resolveTemplatesDeep(parsed, msg);
        }
        send(msg);
        done();
      } catch (error) {
        node.error(error, msg);
        done(error);
      }
    });
  }

  RED.nodes.registerType("businesscentral-get", BusinessCentralGetNode, {
    credentials: {}
  });

  RED.nodes.registerType("businesscentral-filter", BusinessCentralFilterNode, {
    credentials: {}
  });

  RED.nodes.registerType("businesscentral-config", BusinessCentralConfigNode, {
    credentials: {
      clientId: { type: "text", required: true },
      clientSecret: { type: "password", required: true }
    }
  });

  function requireAdminAuth(req, res, next) {
    const middleware = RED.auth && RED.auth.needsPermission && RED.auth.needsPermission("flows.read");
    if (!middleware) return next();
    return middleware(req, res, next);
  }

  function getAdminCredentials(req) {
    const configNodeId = req.query.configNodeId;
    if (!configNodeId) {
      const err = new Error("Missing configNodeId");
      err.statusCode = 400;
      throw err;
    }
    const configNode = RED.nodes.getNode(configNodeId);
    const storedCredentials = RED.nodes.getCredentials(configNodeId);
    if (!configNode) {
      const err = new Error(
        "Config node not found on runtime. Deploy after creating/updating the config node, then retry."
      );
      err.statusCode = 404;
      throw err;
    }
    if (!configNode.tenantId || !configNode.environment || !storedCredentials?.clientId || !storedCredentials?.clientSecret) {
      const err = new Error(
        "Config node is missing tenantId/environment/clientId/clientSecret. Open the config node, fill all fields, deploy, and retry."
      );
      err.statusCode = 400;
      throw err;
    }
    return {
      tenantId: configNode.tenantId,
      environment: configNode.environment,
      customApiNamespaces: parseCustomApiNamespaces(configNode.customApiNamespaces),
      clientId: storedCredentials.clientId,
      clientSecret: storedCredentials.clientSecret
    };
  }

  RED.httpAdmin.get("/businesscentral/companies", requireAdminAuth, async (req, res) => {
    try {
      const adminCreds = getAdminCredentials(req);
      validateNodeConfig({
        tenantId: adminCreds.tenantId,
        environment: adminCreds.environment,
        company: req.query.company || "placeholder",
        endpoint: req.query.endpoint || "placeholder",
        fetchMode: "All"
      }, adminCreds);
      const response = await bcRequest({
        tenantId: adminCreds.tenantId,
        environment: adminCreds.environment,
        clientId: adminCreds.clientId,
        clientSecret: adminCreds.clientSecret,
        path: "/companies",
        query: { $select: "id,name" }
      });
      const companies = (response.data.value || []).map((row) => ({ id: row.id, name: row.name }));
      res.json(companies);
    } catch (error) {
      res.status(error.statusCode || 500).json({ error: error.message });
    }
  });

  RED.httpAdmin.get("/businesscentral/endpoints", requireAdminAuth, async (req, res) => {
    try {
      const adminCreds = getAdminCredentials(req);
      const stdMetadata = await bcRequest({
        tenantId: adminCreds.tenantId,
        environment: adminCreds.environment,
        clientId: adminCreds.clientId,
        clientSecret: adminCreds.clientSecret,
        path: "/$metadata"
      });
      const standardEntitySets = parseEntitySetsFromMetadata(stdMetadata.data.raw || stdMetadata.data);
      const standardEndpoints = standardEntitySets.map((entitySet) => normalizeEndpointEntry({
        id: `/companies({companyId})/${entitySet}`,
        name: `${entitySet} [builtin/microsoft/v2.0]`,
        path: `/companies({companyId})/${entitySet}`,
        entitySet,
        groupLabel: "builtin/microsoft/v2.0",
        metadataPath: "/$metadata"
      }));

      const extensionEndpoints = [];
      const familyErrors = [];
      const configuredNamespaces = adminCreds.customApiNamespaces || [];
      for (const ns of configuredNamespaces) {
        const { apiPublisher, apiGroup, apiVersion } = ns;
        const metadataPath = `/api/${encodeURIComponent(apiPublisher)}/${encodeURIComponent(apiGroup)}/${encodeURIComponent(apiVersion)}/$metadata`;
        try {
          const extMetadata = await bcRequest({
            tenantId: adminCreds.tenantId,
            environment: adminCreds.environment,
            clientId: adminCreds.clientId,
            clientSecret: adminCreds.clientSecret,
            apiPathPrefix: "",
            path: metadataPath
          });
          const entitySets = parseEntitySetsFromMetadata(extMetadata.data.raw || extMetadata.data);
          const groupLabel = `extension/${apiPublisher}/${apiGroup}/${apiVersion}`;
          entitySets.forEach((entitySet) => {
            extensionEndpoints.push(normalizeEndpointEntry({
                  id: `/api/${apiPublisher}/${apiGroup}/${apiVersion}/${entitySet}`,
              name: `${entitySet} [${groupLabel}]`,
                  path: `/api/${apiPublisher}/${apiGroup}/${apiVersion}/${entitySet}`,
              entitySet,
              groupLabel,
              apiPublisher,
              apiGroup,
              apiVersion,
              metadataPath
            }));
          });
        } catch (familyError) {
          familyErrors.push(`${metadataPath} -> ${familyError.message}`);
        }
      }
      if (familyErrors.length) {
        RED.log.warn(
          `businesscentral-get: Extension endpoint metadata failed for ${familyErrors.length} configured namespace(s): ` +
          familyErrors.slice(0, 3).join(" | ")
        );
      }

      const dedup = new Map();
      [...standardEndpoints, ...extensionEndpoints].forEach((entry) => {
        if (!entry || !entry.id) return;
        dedup.set(entry.id, entry);
      });
      res.json(Array.from(dedup.values()));
    } catch (error) {
      res.status(error.statusCode || 500).json({ error: error.message });
    }
  });

  RED.httpAdmin.get("/businesscentral/endpoint-fields", requireAdminAuth, async (req, res) => {
    try {
      const adminCreds = getAdminCredentials(req);
      const ctx = deriveMetadataContext(req.query.endpoint, req.query.entitySet, req.query.metadataPath);
      const metadataPath = ctx.metadataPath || "/$metadata";
      const response = await bcRequest({
        tenantId: adminCreds.tenantId,
        environment: adminCreds.environment,
        clientId: adminCreds.clientId,
        clientSecret: adminCreds.clientSecret,
        apiPathPrefix: metadataPath.startsWith("/api/") ? "" : "/api/v2.0",
        path: metadataPath
      });
      const endpointName = ctx.entitySet || req.query.endpoint;
      const fields = parseFieldsFromMetadata(response.data.raw || response.data, endpointName);
      res.json(fields);
    } catch (error) {
      res.status(error.statusCode || 500).json({ error: error.message });
    }
  });

  RED.httpAdmin.get("/businesscentral/endpoint-dependencies", requireAdminAuth, async (req, res) => {
    try {
      const dependencies = buildDependencyMap([
        {
          id: "salesOrderLines",
          requiresParent: true,
          parentEndpoint: "salesOrders",
          parentIdField: "id",
          childPathTemplate: "/companies({companyId})/salesOrders({parentId})/salesOrderLines"
        }
      ]);
      if (req.query.endpoint) {
        res.json(dependencies[req.query.endpoint] || {});
        return;
      }
      res.json(dependencies);
    } catch (error) {
      res.status(error.statusCode || 500).json({ error: error.message });
    }
  });
};
