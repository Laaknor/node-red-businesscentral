# Node-RED Business Central Plugin Design

## Purpose

Define the design for a Node-RED plugin that connects to Microsoft Dynamics 365 Business Central REST APIs and allows users to:

- Configure authentication with **Client ID** and **Client Secret**
- Select **Company** from a dropdown
- Select **Endpoint** from a dropdown
- Execute requests and return data into Node-RED message flows

This document focuses on plugin architecture, node configuration UX, API interaction, and validation behavior.

## Scope

In scope:

- Node configuration fields and editor behavior
- OAuth2 token handling with Azure AD app credentials
- Loading companies and endpoints for dropdown lists
- Runtime request flow and message output shape
- Error handling and security considerations

Out of scope:

- Full implementation code
- Deployment automation
- UI styling beyond standard Node-RED editor patterns

## Node Type and Responsibilities

Suggested node type:

- `businesscentral-get` (single node for read operations)

Responsibilities:

1. Read credentials and node settings.
2. Acquire and cache OAuth2 access token.
3. Resolve selected company and endpoint.
4. Build REST API URL.
5. Execute HTTP GET request.
6. Return API response in `msg.payload`.

## Authentication Design

### Credentials Model

Use a dedicated Node-RED config node (`businesscentral-config`) for connection/auth settings.

Config node properties:

- `tenantId` (required, non-secret)
- `environment` (required, non-secret text field)
- `clientId` (required credential)
- `clientSecret` (required credential/password)
- `customApiNamespaces` (optional JSON array with `{ apiPublisher, apiGroup, apiVersion }`)
  - UI should provide add/remove rows via dialog form, not raw JSON editing as primary UX

Main data node (`businesscentral-get`) should reference this config node via `bcConfig`.

Use Node-RED credential fields for sensitive values:

- `clientId` (string)
- `clientSecret` (password)

Do not store secrets in normal node properties.

### OAuth2 Flow

Use Azure AD client credentials grant:

- Token URL pattern: `https://login.microsoftonline.com/{tenantId}/oauth2/v2.0/token`
- Grant type: `client_credentials`
- Scope: Business Central API scope (for example `https://api.businesscentral.dynamics.com/.default`)

Additional non-secret data node properties:

### Token Caching

Cache token in runtime memory per unique credential set (`tenantId + clientId + scope`):

- Reuse token until near expiration (for example refresh when less than 60 seconds remain)
- On 401 from Business Central, refresh token once and retry request

## Configuration UI Design (Node-RED Editor)

Filter authoring is handled in a separate node type:

- `businesscentral-filter` (builds `msg.filterGroups` visually)
- `businesscentral-get` consumes `msg.filterGroups` at runtime when present

## Fields

Standard node properties:

- `name` (optional display name)
- `bcConfig` (required; reference to `businesscentral-config`)
- `company` (required; dropdown)
- `endpoint` (required; dropdown)
- `fetchMode` (required; dropdown: `All` or `Filtered`)
- `selectedFields` (optional; multi-select of endpoint fields for `$select`)
- `filterGroups` (optional stored fallback config; visual editing moved to `businesscentral-filter`)
- `customEndpointPath` (optional; enabled when endpoint is `Custom`)

Config node credential properties:

- `clientId` (required)
- `clientSecret` (required)

## Dropdown Behavior

### Environment Text Field (Config Node)

Environment is configured as a required text field on `businesscentral-config`.

Rules:

- Environment is entered manually in config node (for example `Production` or sandbox name).
- No runtime autodiscovery call is made for environments.
- Company and endpoint discovery use the configured environment value.

### Company Dropdown

Behavior:

1. User selects `businesscentral-config` (which includes environment).
2. User clicks `Load companies` (or auto-load on valid credential change).
3. Editor calls plugin admin endpoint to retrieve available companies.
4. Dropdown is populated with:
   - Label: company display name
   - Value: company id

Rules:

- Disable dropdown while loading.
- Show loading indicator and error text on failure.
- Preserve current selection if still available after refresh.

### Endpoint Dropdown

Endpoint options must be discovered from the currently selected environment (and company context where required), not hardcoded.

Rules:

- Load endpoint list after `company` is selected.
- Editor calls admin endpoint to discover available API resources in the environment configured in `businesscentral-config`.
- Disable endpoint dropdown while loading and show clear error state on failure.
- Preserve selected endpoint if it still exists after refresh; otherwise clear selection.
- Endpoint selection must come from discovered list; no static fallback list in normal mode.
- Discovery must include both:
  - Built-in Microsoft APIs (`/api/v2.0/...`)
  - Extension/custom APIs from configured namespaces (`/api/{publisher}/{group}/{version}/...`)
- Endpoint label should include API namespace to disambiguate duplicates (for example `salesOrders [microsoft/v2.0]` or `myEntity [contoso/integration/v1.0]`).
- Endpoint value should store full request path template including company placeholder (for example `/api/contoso/integration/v1.0/companies({companyId})/myEntity`).
- For extension endpoints that are company-scoped by query parameter, use path without `/companies(...)` and append `?company=<company name>`.
- Endpoint picker should be grouped by source/namespace (for example `builtin/microsoft/v2.0`, `extension/{publisher}/{group}/{version}`).
- Endpoint picker should support search across both endpoint name and group/namespace text.
- Optional break-glass mode: `Custom` endpoint can be enabled only via explicit advanced setting.
- Previously configured company/endpoint selections should remain visible in the editor before reloading dropdown data.

Endpoint loading flow:

1. User selects `company` (environment comes from `businesscentral-config`).
2. User clicks `Load endpoints` (or auto-load on valid selection change).
3. Editor calls admin endpoint for endpoint discovery.
4. Built-in endpoints are discovered from `/api/v2.0/$metadata`.
5. Extension endpoints are discovered by reading `$metadata` for each namespace configured in `customApiNamespaces`.
6. Dropdown is populated with discovered endpoints.

### Field Multi-Select (`$select`)

Users can choose which fields to return from the API.

Behavior:

1. After endpoint selection, editor loads endpoint metadata/field list.
2. `selectedFields` multi-select is populated with available field names.
3. If fields are selected, plugin sends `$select=field1,field2,...`.
4. If no fields are selected, API returns default/full response fields.

Rules:

- Multi-select supports search to handle large field lists.
- Preserve already selected fields when metadata refreshes, if still valid.
- For unsupported endpoints (or metadata lookup failure), allow fallback free-text list as optional future enhancement.

### Fetch Mode and Visual Filter Builder (`$filter`)

Visual builder is implemented in `businesscentral-filter` node (not in `businesscentral-get` editor).

Provide a clear mode selector:

- `All`: fetch all rows (no `$filter`)
- `Filtered`: build and send `$filter` from visual rules

Filter builder UX model (group cards):

- Root card + nested subgroup cards (parentheses semantics)
- Each group chooses match mode: `ALL (and)` or `ANY (or)`
- Groups contain condition rows and optional nested subgroups

Condition row model:

- Field (dropdown from endpoint fields, e.g. `no`)
- Operator (dropdown, e.g. `eq`, `ne`, `gt`, `ge`, `lt`, `le`, `contains`, `startswith`, `endswith`)
- Value (textfield)

Optional row controls:

- Logical connector to next row (`and` / `or`)
- Add/remove row buttons
- Group start/end controls to build parentheses

Rules:

- In `All` mode, hide or disable filter builder.
- In `Filtered` mode, require at least one valid filter row.
- Validate operator compatibility with field type (for example numeric/date vs string).
- Escape and format values by field type when building OData filter expression.
- Show read-only preview of generated `$filter` string for transparency.
- Support nested groups with parentheses for explicit precedence.
- If no grouping is defined, evaluate connectors left-to-right.
- If grouping is defined, grouped expressions are evaluated first.
- If `msg.filterGroups` is provided at runtime, it should override configured filter groups.

### Dependent Endpoints (Parent-Child Resources)

Some Business Central endpoints require a parent resource id in the URL path and cannot be queried as a top-level collection.

Example:

- `salesOrderLines` requires `salesOrderId`
- Path shape: `/companies({companyId})/salesOrders({salesOrderId})/salesOrderLines`

Endpoint metadata should include dependency hints:

- `requiresParent` (boolean)
- `parentEndpoint` (for example `salesOrders`)
- `parentIdField` (for example `id`)
- `childPathTemplate` (for example `/companies({companyId})/salesOrders({parentId})/salesOrderLines`)

UI behavior when a dependent endpoint is selected:

- Show a clear notice that parent context is required.
- Show retrieval mode selector:
  - `Single Parent` (one parent id)
  - `All Parents` (discover parents, then fetch children for each)
- Hide parent controls for endpoints where `requiresParent=false`.

Recommended parent retrieval options:

1. `Single Parent` mode
   - Input source:
     - Fixed value in node config, or
     - Runtime value from `msg.parentId` / `msg.salesOrderId`
   - Node fetches children for one parent only.

2. `All Parents` mode
   - Node first queries `parentEndpoint` with optional parent filter.
   - Node extracts `parentIdField` values.
   - Node iterates parent ids and fetches child collections per parent.
   - Node combines results into one output payload (or emits per parent if configured in future).

Runtime safeguards for `All Parents` mode:

- Apply paging on both parent and child requests.
- Enforce concurrency limit for child requests.
- Support retry/backoff for transient API failures.
- Add optional safety cap on number of parents processed.
- Expose partial-failure details in metadata without losing successful results.

## API Endpoint Construction

Base URL pattern:

- `https://api.businesscentral.dynamics.com/v2.0/{tenantId}/{environment}/api/v2.0`

For company-scoped endpoints:

- `.../companies({companyId})/{endpoint}`

For extension endpoints using company query parameter:

- `.../api/{publisher}/{group}/{version}/{entitySet}?company={companyName}`

For custom endpoint:

- `.../{customEndpointPath}` (normalized to avoid duplicate slashes)

URL builder should:

- Encode company id safely
- Handle optional query parameters from `msg.query`
- Add `$select` from `selectedFields` when provided
- Add `$filter` from visual filter builder when `fetchMode=Filtered`
- Resolve dependent endpoint path templates using parent ids when `requiresParent=true`
- Support paging links when present in API response

## Runtime Message Contract

Input (`msg`):

- Optional `msg.query` object for query parameters (`$filter`, `$select`, `$top`, etc.)
- Optional override fields (future extension), such as `msg.company`
- Optional parent override fields for dependent endpoints, for example `msg.parentId` or `msg.salesOrderId`

Output (`msg`):

- `msg.payload`: API response body (JSON)
- `msg.statusCode`: HTTP status code
- `msg.bc`: metadata object
  - `companyId`
  - `endpoint`
  - `requestUrl`
  - `requestId` (if available from response headers)
  - `requiresParent` (boolean)
  - `parentEndpoint` (if used)
  - `parentsProcessed` (when `All Parents` mode is used)
  - `failedParents` (array, optional)

Error output:

- Call `node.error(err, msg)` with structured details
- Optional second output for errors can be added in a later version

## Internal Plugin Architecture

Recommended module split:

- `nodes/businesscentral-get.js`
  - Node runtime logic
- `nodes/businesscentral-get.html`
  - Editor UI and field definitions
- `lib/auth.js`
  - Token acquisition and cache
- `lib/businesscentral-client.js`
  - URL builder and HTTP requests
- `lib/endpoints.js`
  - Supported endpoint definitions
- `lib/validation.js`
  - Input validation helpers

## Admin HTTP Endpoints (for Editor Dropdowns)

Expose editor-only endpoints via `RED.httpAdmin`:

- `GET /businesscentral/companies`
  - Inputs: `configNodeId` (server resolves tenant/environment/credentials from config node)
  - Returns: `[{ id, name }]`
- `GET /businesscentral/endpoints`
  - Inputs: `configNodeId` + company
  - Returns discovered endpoint list including namespace/path metadata, for example `[{ id, name, path, entitySet, metadataPath, apiPublisher, apiGroup, apiVersion }]`
  - Extension discovery depends on `customApiNamespaces` in `businesscentral-config`
- `GET /businesscentral/endpoint-fields`
  - Inputs: `configNodeId` + company/endpoint (+ `entitySet` and `metadataPath` for extension APIs)
  - Returns field metadata, for example `[{ name, type, label }]`
- `GET /businesscentral/endpoint-dependencies`
  - Inputs: `configNodeId` + company
  - Returns endpoint dependency metadata used by editor and runtime

Security notes:

- Protect endpoints with Node-RED admin auth middleware
- Never log `clientSecret`
- Avoid returning raw upstream error bodies containing sensitive details
- Never pass `clientSecret` from editor UI query strings; resolve it server-side from config node

## Validation Rules

At edit-time and deploy-time enforce:

- `bcConfig` reference is required
- Config node must contain `tenantId`, `environment`, `clientId`, and `clientSecret`
- If extension endpoints are needed, `customApiNamespaces` should include one or more namespace entries
- `company` is required
- `endpoint` is required and must match one of discovered endpoints for the selected environment/company
- If selected endpoint `requiresParent=true`, parent retrieval mode is required
- In `Single Parent` mode, a parent id source is required (fixed value or runtime message field)
- `fetchMode` is required (`All` or `Filtered`)
- `selectedFields` values must exist in endpoint field metadata (when metadata is available)
- In `Filtered` mode, at least one valid filter condition is required
- Each filter row requires field, operator, and value
- Logical connectors must be valid (`and`/`or`) between rows
- `customEndpointPath` required only when endpoint is `Custom`
- Reject invalid custom paths (`http://`, full URLs, path traversal patterns)

At runtime:

- Validate required values again
- Return clear error messages for missing or invalid configuration

## Error Handling Strategy

Categories:

- Authentication errors (invalid credentials, token failure)
- Authorization errors (missing API permissions)
- Resource errors (company not found, endpoint missing)
- Transport errors (timeouts, DNS/network)
- API errors (4xx/5xx with Business Central response body)

Handling:

- Include status code and concise message
- Include correlation/request id when available
- Retry only safe authentication refresh once on 401

## Observability and Logging

Log minimally and safely:

- Info: node startup and configuration validation success
- Debug: request URL (without secrets), timing, paging info
- Error: status code, message, correlation id

Never log:

- Client secret
- Access tokens

## Permissions and Prerequisites

Business Central setup prerequisites:

- Azure AD app registration with client credentials
- Business Central API application permission `API.ReadWrite.All` granted and admin-consented
- App user mapped and authorized in target Business Central environment

## Testing Plan

Unit tests:

- Token cache behavior and refresh threshold
- URL builder correctness for all endpoint modes
- Validation rules for config and custom path
- OData `$select` generation from multi-select fields
- OData `$filter` generation from visual filter builder rows

Integration tests:

- Load companies using valid credentials
- Discover endpoints from selected environment and company
- Read data from discovered endpoints
- Fetch with `fetchMode=All` and no filter
- Fetch with `fetchMode=Filtered` and single/multiple conditions
- Fetch with selected fields and verify response shape
- Dependent endpoint with `Single Parent` mode (valid parent id)
- Dependent endpoint with `All Parents` mode (fan-out/fan-in behavior)
- Dependent endpoint with missing parent id should fail with clear validation error
- 401 refresh and retry path
- Invalid credentials and permission failure handling

Editor tests:

- Company dropdown loading state and error state
- Endpoint dropdown discovery, loading state, and error state
- Endpoint selection reset behavior when selected company changes
- Dependent endpoint mode toggle (`Single Parent` / `All Parents`)
- Parent-required notice and validation behavior
- Field multi-select population and selection persistence
- Filter builder add/remove rows and operator rendering
- `All` vs `Filtered` mode behavior toggling
- Generated `$filter` preview correctness
- Save prevention on invalid required fields

## Query Generation Examples

These examples show how editor selections map to Business Central query parameters.

### Example 1: Fetch All Data (No Field Selection)

UI selection:

- Endpoint: `customers`
- Fetch mode: `All`
- Selected fields: none

Generated query params:

- No `$filter`
- No `$select`

Resulting request path:

- `/companies({companyId})/customers`

### Example 2: Fetch All Data with Selected Fields

UI selection:

- Endpoint: `customers`
- Fetch mode: `All`
- Selected fields: `no`, `displayName`, `phoneNumber`

Generated query params:

- `$select=no,displayName,phoneNumber`
- No `$filter`

Resulting request path:

- `/companies({companyId})/customers?$select=no,displayName,phoneNumber`

### Example 3: Filtered Fetch with One Condition

UI selection:

- Endpoint: `customers`
- Fetch mode: `Filtered`
- Selected fields: `no`, `displayName`
- Filter rows:
  - Field: `no`
  - Operator: `eq`
  - Value: `1000`

Generated query params:

- `$select=no,displayName`
- `$filter=no eq '1000'`

Resulting request path:

- `/companies({companyId})/customers?$select=no,displayName&$filter=no%20eq%20'1000'`

### Example 4: Filtered Fetch with Multiple Conditions

UI selection:

- Endpoint: `items`
- Fetch mode: `Filtered`
- Selected fields: `number`, `displayName`, `unitPrice`
- Filter rows:
  1. Field: `unitPrice`, Operator: `ge`, Value: `10`
  2. Connector: `and`
  3. Field: `displayName`, Operator: `contains`, Value: `bike`

Generated query params:

- `$select=number,displayName,unitPrice`
- `$filter=unitPrice ge 10 and contains(displayName,'bike')`

Resulting request path:

- `/companies({companyId})/items?$select=number,displayName,unitPrice&$filter=unitPrice%20ge%2010%20and%20contains(displayName,'bike')`

### Example 5: Grouped Conditions with `or` and Parentheses

UI selection:

- Endpoint: `customers`
- Fetch mode: `Filtered`
- Selected fields: `no`, `displayName`, `phoneNumber`
- Filter groups:
  - Group 1:
    - Field: `no`, Operator: `eq`, Value: `1000`
    - Connector: `or`
    - Field: `no`, Operator: `eq`, Value: `2000`
  - Connector to next group: `and`
  - Group 2:
    - Field: `displayName`, Operator: `contains`, Value: `school`

Generated query params:

- `$select=no,displayName,phoneNumber`
- `$filter=(no eq '1000' or no eq '2000') and contains(displayName,'school')`

Resulting request path:

- `/companies({companyId})/customers?$select=no,displayName,phoneNumber&$filter=(no%20eq%20'1000'%20or%20no%20eq%20'2000')%20and%20contains(displayName,'school')`

### Example 6: Dependent Endpoint (`salesOrderLines`) with Single Parent

UI selection:

- Endpoint: `salesOrderLines` (`requiresParent=true`)
- Parent mode: `Single Parent`
- Parent id source: `msg.salesOrderId`
- `msg.salesOrderId`: `2b7f5f2e-8d1a-ef11-9f89-000d3ab12abc`
- Selected fields: `sequence`, `itemId`, `quantity`, `unitPrice`

Generated request path:

- `/companies({companyId})/salesOrders(2b7f5f2e-8d1a-ef11-9f89-000d3ab12abc)/salesOrderLines?$select=sequence,itemId,quantity,unitPrice`

### Example 7: Dependent Endpoint (`salesOrderLines`) with All Parents

UI selection:

- Endpoint: `salesOrderLines` (`requiresParent=true`)
- Parent mode: `All Parents`
- Parent endpoint: `salesOrders`
- Optional parent filter: `documentDate ge 2026-01-01`

Execution flow:

1. Query parent endpoint:
   - `/companies({companyId})/salesOrders?$select=id&$filter=documentDate%20ge%202026-01-01`
2. Extract each parent `id`.
3. Query child endpoint per parent:
   - `/companies({companyId})/salesOrders({parentId})/salesOrderLines`
4. Aggregate child rows into final payload and populate `msg.bc.parentsProcessed`.

### Notes on Value Formatting

- String values are quoted in `$filter` (for example `'1000'`).
- Numeric values are sent without quotes (for example `10`).
- Date/datetime values are formatted to OData-compatible strings before sending.
- Parentheses are preserved in the generated filter expression to enforce intended precedence.
- Recommended UX: render each group as a bordered block with its own internal rows and connectors.

## `filterGroups` JSON Schema Example

Example structure stored in node configuration:

```json
{
  "fetchMode": "Filtered",
  "selectedFields": ["no", "displayName", "phoneNumber"],
  "filterGroups": {
    "logic": "and",
    "groups": [
      {
        "logic": "or",
        "conditions": [
          { "field": "no", "operator": "eq", "value": "1000", "valueType": "string" },
          { "field": "no", "operator": "eq", "value": "2000", "valueType": "string" }
        ]
      },
      {
        "logic": "and",
        "conditions": [
          { "field": "displayName", "operator": "contains", "value": "school", "valueType": "string" }
        ]
      }
    ]
  }
}
```

Normalization rules:

- Root object supports `logic` (`and`/`or`) and `groups`.
- Each group supports `logic` (`and`/`or`) and `conditions`.
- Each condition requires `field`, `operator`, and `value`.
- `valueType` is optional if field metadata can infer type.
- Runtime should normalize legacy/flat filter formats into this grouped model before query generation.

## Open Design Decisions

Pending choices to confirm before implementation:

1. Should company list auto-load or require explicit button click?
2. Should endpoint discovery auto-load or require explicit button click?
3. Should `Custom` endpoint mode be enabled in v1 or postponed?
4. Single output vs dual output (success/error) in v1?
5. Should paging be automatic (`@odata.nextLink`) or exposed to flow logic?

## Implementation Checklist

- [ ] Create Node-RED node runtime and editor files
- [ ] Implement secure credential handling
- [ ] Implement OAuth2 token service with cache
- [ ] Add admin endpoint for company dropdown data
- [ ] Add admin endpoint for dynamic endpoint discovery
- [ ] Add endpoint dropdown loading and refresh behavior
- [ ] Add optional advanced `Custom` endpoint mode (if enabled)
- [ ] Add endpoint dependency metadata (`requiresParent`, `parentEndpoint`, `parentIdField`, path template)
- [ ] Add parent retrieval mode UI for dependent endpoints
- [ ] Add `Single Parent` and `All Parents` runtime execution paths
- [ ] Add fan-out safeguards (pagination, concurrency limit, retry/backoff, safety cap)
- [ ] Add endpoint field metadata endpoint for multi-select and filters
- [ ] Add `fetchMode` control (`All` / `Filtered`)
- [ ] Add field multi-select and `$select` query generation
- [ ] Add visual filter builder and `$filter` query generation
- [ ] Add validation and clear error messages
- [ ] Add tests for auth, URL building, and editor behavior

