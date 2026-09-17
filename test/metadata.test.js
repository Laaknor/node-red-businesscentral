"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  parseEntitySetsFromMetadata,
  parseFieldsFromMetadata,
  parseExpandPropertiesFromMetadata,
  deriveMetadataContext
} = require("../lib/metadata");
const { applySelectAndExpand, normalizeCsvList } = require("../lib/query-options");

const sampleMetadata = `
<edmx:Edmx>
  <edmx:DataServices>
    <Schema Namespace="Microsoft.NAV">
      <EntityType Name="salesOrder">
        <Key><PropertyRef Name="id"/></Key>
        <Property Name="id" Type="Edm.Guid" Nullable="false"/>
        <Property Name="number" Type="Edm.String"/>
        <Property Name="customerNumber" Type="Edm.String"/>
        <NavigationProperty Name="salesOrderLines" Type="Collection(Microsoft.NAV.salesOrderLine)">
          <ReferentialConstraint Property="id" ReferencedProperty="documentId"/>
        </NavigationProperty>
        <NavigationProperty Name="customer" Type="Microsoft.NAV.customer"/>
        <NavigationProperty Name="currency" Type="Microsoft.NAV.currency"/>
      </EntityType>
      <EntitySet Name="salesOrders" EntityType="Microsoft.NAV.salesOrder"/>
    </Schema>
  </edmx:DataServices>
</edmx:Edmx>
`;

test("parseEntitySetsFromMetadata returns entity set names", () => {
  assert.deepEqual(parseEntitySetsFromMetadata(sampleMetadata), ["salesOrders"]);
});

test("parseFieldsFromMetadata returns scalar properties only", () => {
  const fields = parseFieldsFromMetadata(sampleMetadata, "salesOrders");
  assert.deepEqual(fields.map((field) => field.name), ["id", "number", "customerNumber"]);
});

test("parseExpandPropertiesFromMetadata returns navigation properties", () => {
  const expands = parseExpandPropertiesFromMetadata(sampleMetadata, "salesOrders");
  assert.deepEqual(expands.map((item) => item.name), ["salesOrderLines", "customer", "currency"]);
  assert.equal(expands[0].isCollection, true);
  assert.equal(expands[0].label, "salesOrderLines (expand, collection)");
  assert.equal(expands[1].isCollection, false);
  assert.equal(expands[1].label, "customer (expand)");
});

test("parseExpandPropertiesFromMetadata finds custom API itemAttributes", () => {
  const xml = `
    <Schema Namespace="Microsoft.NAV">
      <EntityType OpenType="true" Name="item">
        <Property Name="id" Type="Edm.Guid"/>
        <Property Name="no" Type="Edm.String"/>
        <Property Name="abcPriority" Type="Edm.String"/>
        <NavigationProperty Type="Collection(Microsoft.NAV.itemAttribute)" Name="itemAttributes" ContainsTarget="true">
          <ReferentialConstraint Property="id" ReferencedProperty="parentId"/>
        </NavigationProperty>
      </EntityType>
      <EntitySet EntityType="Microsoft.NAV.item" Name="item"/>
    </Schema>
  `;
  const expands = parseExpandPropertiesFromMetadata(xml, "item");
  assert.deepEqual(expands.map((item) => item.name), ["itemAttributes"]);
  const fields = parseFieldsFromMetadata(xml, "item");
  assert.deepEqual(fields.map((field) => field.name), ["id", "no", "abcPriority"]);
});

test("deriveMetadataContext uses provided entity set and metadata path", () => {
  assert.deepEqual(
    deriveMetadataContext("/companies({companyId})/salesOrders", "salesOrders", "/$metadata"),
    { entitySet: "salesOrders", metadataPath: "/$metadata" }
  );
});

test("deriveMetadataContext uses custom API metadata path", () => {
  assert.deepEqual(
    deriveMetadataContext("/api/ScanSense/scs/v1.0/item", "item", "/$metadata"),
    { entitySet: "item", metadataPath: "/api/ScanSense/scs/v1.0/$metadata" }
  );
});

test("parseExpandPropertiesFromMetadata returns empty list when entity is missing", () => {
  assert.deepEqual(parseExpandPropertiesFromMetadata(sampleMetadata, "customers"), []);
});

test("normalizeCsvList accepts arrays and comma-separated strings", () => {
  assert.deepEqual(normalizeCsvList("salesOrderLines, customer"), ["salesOrderLines", "customer"]);
  assert.deepEqual(normalizeCsvList(["currency", ""]), ["currency"]);
});

test("applySelectAndExpand adds $select and $expand", () => {
  const query = applySelectAndExpand(
    { $top: "10" },
    { selectedFields: ["number", "displayName"], selectedExpands: ["salesOrderLines", "customer"] }
  );
  assert.equal(query.$top, "10");
  assert.equal(query.$select, "number,displayName");
  assert.equal(query.$expand, "salesOrderLines,customer");
});

test("applySelectAndExpand omits empty options", () => {
  const query = applySelectAndExpand({}, { selectedFields: "", selectedExpands: [] });
  assert.equal(query.$select, undefined);
  assert.equal(query.$expand, undefined);
});

test("applySelectAndExpand moves navigation properties from $select to $expand", () => {
  const query = applySelectAndExpand(
    {},
    {
      selectedFields: ["no", "description", "type", "unitPrice", "abcPriority", "itemAttributes"],
      selectedExpands: [],
      expandNames: ["itemAttributes"]
    }
  );
  assert.equal(query.$select, "no,description,type,unitPrice,abcPriority");
  assert.equal(query.$expand, "itemAttributes");
});
