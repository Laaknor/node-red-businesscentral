"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { getAccessToken, clearTokenCache } = require("../lib/auth");

test("getAccessToken caches token", async () => {
  clearTokenCache();
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return {
      ok: true,
      json: async () => ({ access_token: "abc", expires_in: 3600 })
    };
  };

  const config = {
    tenantId: "t",
    clientId: "c",
    clientSecret: "s",
    fetchImpl
  };

  const t1 = await getAccessToken(config);
  const t2 = await getAccessToken(config);
  assert.equal(t1, "abc");
  assert.equal(t2, "abc");
  assert.equal(calls, 1);
});
