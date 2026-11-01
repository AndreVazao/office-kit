import test from "node:test";
import assert from "node:assert/strict";
import { calculateSceneLayout, validateViewport } from "../src/index.mjs";

const config = { departments: [
  { id: "lower", name: "Operations", floor: 1, agents: [{ id: "op-a" }, { id: "op-b" }] },
  { id: "upper", name: "Executive", floor: 3, agents: [{ id: "ceo" }] }
] };

test("validates viewport dimensions", () => {
  assert.equal(validateViewport({ width: 390, height: 844 }).valid, true);
  assert.equal(validateViewport({ width: 0, height: 844 }).valid, false);
});
test("creates deterministic layout ordered by floor and stable IDs", () => {
  const first = calculateSceneLayout(config, { width: 1200, height: 900 });
  const second = calculateSceneLayout(config, { width: 1200, height: 900 });
  assert.deepEqual(first, second);
  assert.deepEqual(first.floors.map(floor => floor.id), ["upper", "lower"]);
  assert.equal(first.floors[0].agents[0].id, "ceo");
});
test("adapts to portrait and landscape viewports without changing scene content", () => {
  const portrait = calculateSceneLayout(config, { width: 390, height: 844 });
  const landscape = calculateSceneLayout(config, { width: 844, height: 390 });
  assert.equal(portrait.orientation, "portrait");
  assert.equal(landscape.orientation, "landscape");
  assert.deepEqual(portrait.floors.map(floor => floor.id), landscape.floors.map(floor => floor.id));
  assert.ok(portrait.transform.scale > 0);
  assert.ok(landscape.transform.scale > 0);
});
test("rejects invalid viewport instead of returning broken coordinates", () => {
  assert.throws(() => calculateSceneLayout(config, { width: NaN, height: 500 }), /Invalid viewport/);
});
test("supports clamped zoom while preserving scene dimensions", () => {
  const normal = calculateSceneLayout(config, { width: 1200, height: 900 });
  const zoomed = calculateSceneLayout(config, { width: 1200, height: 900 }, { zoom: 1.5 });
  assert.ok(zoomed.transform.scale > normal.transform.scale);
  assert.equal(zoomed.logicalBounds.width, normal.logicalBounds.width);
});
