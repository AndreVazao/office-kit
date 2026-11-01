import test from "node:test";
import assert from "node:assert/strict";
import { calculateSceneLayout } from "../src/index.mjs";
import { calculateDioramaGeometry } from "../src/diorama.mjs";

const config = { departments: [
  { id: "operations", name: "Operations", floor: 1, agents: [{ id: "a" }] },
  { id: "ceo", name: "CEO", floor: 3, agents: [{ id: "ceo-agent" }] }
] };

test("builds deterministic angular cutaway polygons for every floor", () => {
  const layout = calculateSceneLayout(config, { width: 1366, height: 768 });
  const first = calculateDioramaGeometry(layout);
  const second = calculateDioramaGeometry(layout);
  assert.deepEqual(first, second);
  assert.equal(first.projection, "angular-cutaway");
  assert.equal(first.frontCut, true);
  assert.equal(first.floorBands.length, 2);
  assert.equal(first.front.length, 4);
  assert.equal(first.rightSide.length, 4);
  assert.ok(first.logicalBounds.width > layout.logicalBounds.width);
  assert.ok(first.logicalBounds.height > layout.logicalBounds.height);
});

test("supports omitting the front cutaway while retaining top and side geometry", () => {
  const layout = calculateSceneLayout(config, { width: 390, height: 844 });
  const geometry = calculateDioramaGeometry(layout, { frontCut: false, depth: 80, lift: 40 });
  assert.equal(geometry.frontCut, false);
  assert.deepEqual(geometry.front, []);
  assert.equal(geometry.roof.length, 4);
  assert.equal(geometry.rightSide.length, 4);
});

test("rejects missing or invalid layout geometry", () => {
  assert.throws(() => calculateDioramaGeometry(null), /layout must contain/);
  assert.throws(() => calculateDioramaGeometry({ logicalBounds: { width: 0, height: 10 }, floors: [{}] }), /dimensions must be positive/);
});
