import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../../../examples/browser-preview/app.mjs", import.meta.url), "utf8");
const css = await readFile(new URL("../../../examples/browser-preview/style.css", import.meta.url), "utf8");

test("preview anchors the scaled building to the center of the viewport", () => {
  assert.match(app, /translate\(-50%, -50%\) scale\(/);
  assert.match(app, /building\.style\.left = "50%"/);
  assert.match(app, /building\.style\.top = "calc\(50% \+ "/);
  assert.match(css, /\.scene-viewport\{position:relative/);
  assert.match(css, /\.building\{position:absolute;left:50%;top:50%/);
});

test("preview clips the scaled scene instead of creating horizontal scroll overflow", () => {
  assert.match(css, /\.scene-viewport\{[^}]*overflow:hidden/);
  assert.match(css, /\.building\{[^}]*width:1200px/);
  assert.match(css, /\.building\{[^}]*min-width:0/);
});

test("preview keeps portrait, landscape and narrow viewport rules", () => {
  assert.match(css, /@media\(max-width:760px\)/);
  assert.match(css, /@media\(orientation:landscape\) and \(max-height:540px\)/);
  assert.match(app, /ResizeObserver/);
  assert.match(app, /window\.addEventListener\("resize"/);
});

test("agent chat supports Escape dismissal and restores keyboard focus", () => {
  assert.match(app, /chatReturnFocus = document\.activeElement/);
  assert.match(app, /event\.key === "Escape"/);
  assert.match(app, /target\.focus\(\)/);
  assert.match(app, /document\.querySelector\("#chat-close"\)\.addEventListener\("click", closeAgentChat\)/);
});

test("reduced-motion preference disables scene transitions and diorama effects", () => {
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)\{\.building,\.agent\[role="button"\]\{transition:none!important\}/);
  assert.match(css, /\.diorama-shell\{filter:none!important\}/);
});
