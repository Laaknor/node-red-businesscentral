# node-red-businesscentral

Node-RED nodes for reading data from Microsoft Dynamics 365 Business Central REST APIs (built-in and custom APIs).

## Features

- `businesscentral-config` config node for shared connection/auth settings
  - Tenant ID
  - Environment
  - Client ID / Client Secret
  - Custom API namespaces (`publisher/group/version`)
- `businesscentral-get` node for data retrieval
  - Dynamic company and endpoint lookup
  - Built-in and extension endpoints
  - Optional field selection (`$select`)
  - Filter support (`$filter`) from config or `msg.filterGroups`
  - Dependency handling for parent/child endpoints (for example sales orders -> sales lines)
- `businesscentral-filter` node to visually build `msg.filterGroups`
  - Group logic (`and` / `or`)
  - Conditions and nested groups
  - Dynamic templates from incoming message values (`{{msg.payload.id}}`)

## Installation

### Option 1: Install from npm (recommended)

When published:

```bash
npm install node-red-businesscentral
```

### Option 2: Install locally for development

From your Node-RED user directory (typically `~/.node-red`):

```bash
npm install <path-to-this-project>
```

Then restart Node-RED.

## Node-RED Palette Manager

After publishing to npm, this package can be added from **Manage palette** in Node-RED by searching:

- `node-red-businesscentral`

## Quick Start

1. Add a `businesscentral-config` node and fill:
   - Tenant ID
   - Environment name
   - Client ID / Client Secret
2. Add `businesscentral-get` and select:
   - Config node
   - Company
   - Endpoint
3. (Optional) Add `businesscentral-filter` before `businesscentral-get` to build advanced filters.
4. Deploy and trigger with an Inject node.

## Message contract

Input overrides supported by `businesscentral-get`:

- `msg.company`
- `msg.companyName`
- `msg.endpoint`
- `msg.selectedFields` (array or comma-separated string)
- `msg.filterGroups`
- `msg.query` (additional query parameters)

Output:

- `msg.payload` - API response rows/object
- `msg.statusCode` - HTTP status
- `msg.bc` - metadata (`requestUrl`, `requestId`, `appliedFilter`, endpoint/company context)

## Permissions and authentication

The node uses OAuth2 client credentials against Business Central API scope:

- `https://api.businesscentral.dynamics.com/.default`

Ensure your Azure app registration has required Business Central API application permissions with admin consent.

## Development

Run tests:

```bash
npm test
```

## Packaging checklist

Before publishing:

1. Update `package.json`:
   - `name` (must be unique on npm)
   - `version`
   - `author`
   - `repository`, `homepage`, `bugs`
2. Verify with:
   - `npm pack`
3. Publish:
   - `npm publish`

## License

MIT - see [LICENSE](./LICENSE).
