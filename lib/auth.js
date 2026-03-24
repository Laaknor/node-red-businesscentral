"use strict";

const tokenCache = new Map();

function cacheKey({ tenantId, clientId, scope }) {
  return `${tenantId}::${clientId}::${scope}`;
}

function toBody(params) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    search.set(key, value);
  });
  return search.toString();
}

async function requestToken(config) {
  const { tenantId, clientId, clientSecret, scope, fetchImpl } = config;
  const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`;

  const response = await fetchImpl(tokenUrl, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded"
    },
    body: toBody({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    const err = new Error(payload.error_description || payload.error || "Token request failed");
    err.statusCode = response.status;
    err.payload = payload;
    throw err;
  }

  const nowMs = Date.now();
  const expiresInMs = Math.max(Number(payload.expires_in || 0) * 1000, 60000);
  return {
    accessToken: payload.access_token,
    expiresAt: nowMs + expiresInMs
  };
}

async function getAccessToken(config) {
  const {
    tenantId,
    clientId,
    clientSecret,
    scope = "https://api.businesscentral.dynamics.com/.default",
    fetchImpl = globalThis.fetch,
    refreshBufferMs = 60000
  } = config;

  if (!tenantId || !clientId || !clientSecret) {
    throw new Error("Missing tenantId/clientId/clientSecret for token retrieval");
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("No fetch implementation available");
  }

  const key = cacheKey({ tenantId, clientId, scope });
  const cached = tokenCache.get(key);
  const now = Date.now();
  if (cached && cached.expiresAt - now > refreshBufferMs) {
    return cached.accessToken;
  }

  const token = await requestToken({ tenantId, clientId, clientSecret, scope, fetchImpl });
  tokenCache.set(key, token);
  return token.accessToken;
}

function clearTokenCache() {
  tokenCache.clear();
}

module.exports = {
  getAccessToken,
  clearTokenCache
};
