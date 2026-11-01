# Scene engine contract

The scene engine converts a validated office configuration and a viewport into deterministic logical geometry. It does not draw pixels, load assets, animate agents, or communicate with a backend.

## Responsibilities
- Provide stable logical bounds for roof, floors, and foundation.
- Place departments in deterministic order, with stable IDs and agent positions.
- Report portrait/landscape from viewport dimensions; never assume a device orientation lock.
- Calculate a fit scale and center offset, with optional clamped user zoom.
- Reject invalid viewport dimensions rather than emitting unusable coordinates.

## Non-responsibilities
- Asset loading, camera effects, anti-aliasing, lighting, character rigs, collision avoidance, and final pixel-art rendering.
- Operational status or task progress.
- Platform packaging or device orientation permissions.

## Coordinate model
- Logical scene defaults to 1200 units wide.
- Floor, roof, foundation, and padding are configurable through engine options.
- Output positions are logical units; the renderer applies the returned transform.
- Layout ordering is stable by descending configured floor and then ID.
- The renderer must preserve legibility and may use a different layout strategy for a compact viewport, provided the scene model remains consistent.

## Tests
The check script syntax-checks the core, browser preview, and runs core plus scene-engine tests. CI also parses the generic JSON configuration.
