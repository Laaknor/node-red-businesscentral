"use strict";

const { getAccessToken } = require("./auth");

function buildApiBaseUrl({ tenantId, environment, apiPathPrefix = "/api/v2.0" }) {
  return `https://api.businesscentral.dynamics.com/v2.0/${encodeURIComponent(tenantId)}/${encodeURIComponent(environment)}${apiPathPrefix}`;
}

function withQuery(path, queryParams = {}) {
  const search = new URLSearchParams();
  Object.entries(queryParams).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    search.set(key, String(value));
  });
  const query = search.toString();
  return query ? `${path}?${query}` : path;
}

async function bcRequest(config) {
  const {
    tenantId,
    environment,
    clientId,
    clientSecret,
    path,
    method = "GET",
    query,
    body,
    fetchImpl = globalThis.fetch,
    scope = "https://api.businesscentral.dynamics.com/.default",
    retry401 = true,
    apiPathPrefix = "/api/v2.0"
  } = config;

  const token = await getAccessToken({
    tenantId,
    clientId,
    clientSecret,
    scope,
    fetchImpl
  });

  const url = `${buildApiBaseUrl({ tenantId, environment, apiPathPrefix })}${withQuery(path, query)}`;
  const response = await fetchImpl(url, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined
  });

  if (response.status === 401 && retry401) {
    const refreshedToken = await getAccessToken({
      tenantId,
      clientId,
      clientSecret,
      scope,
      fetchImpl,
      refreshBufferMs: Number.MAX_SAFE_INTEGER
    });
    const retryResponse = await fetchImpl(url, {
      method,
      headers: {
        authorization: `Bearer ${refreshedToken}`,
        "content-type": "application/json"
      },
      body: body ? JSON.stringify(body) : undefined
    });
    return parseResponse(retryResponse, url);
  }

  return parseResponse(response, url);
}

async function parseResponse(response, url) {
  const raw = await response.text();
  let data;
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch (error) {
    data = { raw };
  }

  if (!response.ok) {
    const rawSnippet = typeof raw === "string" ? raw.slice(0, 300) : "";
    const fallbackMessage = `Business Central API request failed (${response.status}) at ${url}${rawSnippet ? `: ${rawSnippet}` : ""}`;
    const err = new Error(data.error?.message || data.message || fallbackMessage);
    err.statusCode = response.status;
    err.payload = data;
    err.url = url;
    err.raw = rawSnippet;
    throw err;
  }

  return {
    statusCode: response.status,
    headers: response.headers,
    data,
    url
  };
}

async function pagedGetAll(config) {
  const items = [];
  let nextPath = config.path;
  let pageCount = 0;
  while (nextPath) {
    pageCount += 1;
    const response = await bcRequest({ ...config, path: nextPath, query: pageCount === 1 ? config.query : undefined });
    const value = Array.isArray(response.data?.value) ? response.data.value : [];
    items.push(...value);
    const nextLink = response.data?.["@odata.nextLink"];
    if (!nextLink) break;
    const asUrl = new URL(nextLink);
    nextPath = asUrl.pathname + asUrl.search;
  }
  return items;
}

module.exports = {
  buildApiBaseUrl,
  withQuery,
  bcRequest,
  pagedGetAll
};
