const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../src/customer-country.js");
const F = require("../src/customer-fields.js");
test("country tree groups only supplied values without inventing recent selections", () => {
  const values = [
    "🇺🇸 美国 United States",
    "🇵🇱 波兰 Poland",
    "🇨🇳 中国 China",
    "Unspecified",
    "🇺🇸 美国 United States",
  ];
  const tree = C.group(values);
  assert.deepEqual(tree.map((x) => x.label).slice(0, 6), [
    "亚洲(Asia)",
    "北美洲(North America)",
    "南美洲(South America)",
    "欧洲(Europe)",
    "非洲(Africa)",
    "大洋洲(Oceania)",
  ]);
  assert.equal(tree.flatMap((x) => x.values).length, 4);
  assert.deepEqual(tree[1].values, [values[0]]);
  assert.deepEqual(tree[3].values, [values[1]]);
  assert.deepEqual(tree.at(-1).values, ["Unspecified"]);
});
test("multiple quick countries form a union and continue to intersect ordinary filters", () => {
  const rows = [
    { name: "A", country: "US", owner: "X" },
    { name: "B", country: "PL", owner: "Y" },
    { name: "C", country: "US", owner: "Y" },
  ];
  assert.deepEqual(
    F.filter(rows, {
      field: "country",
      query: "United States、Poland",
      quickCountries: ["US", "PL"],
      owner: "Y",
    }),
    [rows[1], rows[2]],
  );
  assert.deepEqual(
    F.filter(rows, { field: "name", query: "A", quickCountries: ["PL"] }),
    [rows[0]],
  );
});
