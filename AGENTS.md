# Agent Guidance For This Repository

## Project Overview

- Package: `node-red-businesscentral`
- Purpose: Node-RED custom node for Microsoft Dynamics 365 Business Central REST APIs.
- Runtime/editor split:
  - Runtime node logic: `nodes/businesscentral-get.js`
  - Node editor UI/help: `nodes/businesscentral-get.html`

## Working Agreements

- Keep changes small and backward compatible for existing Node-RED flows.
- Update runtime and editor files together when adding or changing node configuration.
- Avoid changing output contracts unexpectedly (`msg.payload`, `msg.statusCode`, `msg.error`).
- Never print or persist secrets/tokens in logs, docs, or examples.

## Business Central API Expectations

- Keep request URL and API version construction explicit.
- Validate required identifiers early (tenant/environment/company where applicable).
- Handle OData query options safely and predictably.
- Differentiate auth errors from request/validation/resource errors in emitted messages.

## Test And Validation

- Use `npm test` for repository tests.
- After behavior changes:
  - verify node config defaults still load correctly in editor UI
  - verify request failures produce actionable error messages
  - verify successful responses preserve expected payload shape

## Recommended MCP Integrations

These are optional but useful for future sessions:

- Documentation/search MCP for fast lookup of Node-RED and Business Central API docs
- HTTP/OpenAPI MCP for endpoint and schema inspection
- GitHub MCP for issue and PR workflows

If you add MCP config later, keep credentials out of repo files and use local secrets.
