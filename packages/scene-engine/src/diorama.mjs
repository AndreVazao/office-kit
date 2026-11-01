const finitePositive = value => typeof value === "number" && Number.isFinite(value) && value > 0;

/**
 * Builds deterministic polygon geometry for an angular, front-cutaway diorama.
 * Coordinates are renderer-neutral logical units; this function does not draw,
 * choose assets, or claim anything about backend state.
 */
export function calculateDioramaGeometry(layout, options = {}) {
  if (!layout?.logicalBounds || !Array.isArray(layout.floors) || layout.floors.length === 0) {
    throw new TypeError("layout must contain logicalBounds and at least one floor.");
  }
  const { width, height } = layout.logicalBounds;
  if (!finitePositive(width) || !finitePositive(height)) {
    throw new TypeError("layout.logicalBounds dimensions must be positive finite numbers.");
  }
  const depth = finitePositive(options.depth) ? Math.min(options.depth, width * 0.3) : width * 0.12;
  const lift = finitePositive(options.lift) ? Math.min(options.lift, height * 0.2) : height * 0.08;
  const frontCut = options.frontCut !== false;
  const roof = [
    { x: 0, y: lift }, { x: width - depth, y: 0 },
    { x: width, y: depth * 0.35 }, { x: depth, y: lift + depth * 0.35 }
  ];
  const rightSide = [
    { x: width - depth, y: 0 }, { x: width, y: depth * 0.35 },
    { x: width, y: height + depth * 0.35 }, { x: width - depth, y: height }
  ];
  const front = [
    { x: 0, y: lift }, { x: depth, y: lift + depth * 0.35 },
    { x: depth, y: height + depth * 0.35 }, { x: 0, y: height }
  ];
  const floorBands = layout.floors.map(floor => ({
    id: floor.id,
    front: [
      { x: depth, y: lift + floor.y + depth * 0.35 },
      { x: width, y: floor.y + depth * 0.35 },
      { x: width, y: floor.y + floor.height + depth * 0.35 },
      { x: depth, y: lift + floor.y + floor.height + depth * 0.35 }
    ],
    side: [
      { x: width - depth, y: floor.y },
      { x: width, y: floor.y + depth * 0.35 },
      { x: width, y: floor.y + floor.height + depth * 0.35 },
      { x: width - depth, y: floor.y + floor.height }
    ]
  }));
  return {
    projection: "angular-cutaway",
    frontCut,
    logicalBounds: { width: width + depth, height: height + lift + depth * 0.35 },
    depth,
    lift,
    roof,
    rightSide,
    front: frontCut ? front : [],
    floorBands
  };
}
