/* =====================================================================
   render-helpers.test.ts — characterization tests for src/render/render.ts
   ---------------------------------------------------------------------
   render.ts's top-level imports (config, core/state, core/frontmatter)
   pull in neither ./avoidRouter nor any module-load-time DOM access, so
   the plain static import below is safe. shapeMarkup() is pure string
   building (no `document` calls) and is covered here.

   buildFmCard() is NOT covered: it calls `document.createElement` at
   CALL time (not import time), and plain `node --import tsx` has no
   `document` global at all — calling it throws
   `ReferenceError: document is not defined` unconditionally. That's a
   harder blocker than the import-time DOM case this task anticipated
   (there's no wasm-style side collaborator to stub out; the function's
   own body is DOM). Dropped per task instructions ("drop a target if
   genuinely untestable and say so").

   expected values are observed behavior, not spec.
   ===================================================================== */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shapeMarkup } from '../../src/render/render.ts';

const SVG_HEADER = '<svg class="shape-svg" width="100" height="60" viewBox="0 0 100 60" preserveAspectRatio="none">';

function mkNode(shape: string, width = 100, height = 60, extra: any = {}): any {
  return { id: 'n1', label: 'N', shape, color: null, x: 0, y: 0, 'w': width, 'h': height, ...extra };
}

test('shapeMarkup: diamond -> a 4-point polygon SVG', () => {
  assert.equal(
    shapeMarkup(mkNode('diamond')),
    SVG_HEADER
    + '<polygon class="shp" points="50,0 100,30 50,60 0,30"/></svg>',
  );
});

test('shapeMarkup: hex -> a 6-point polygon SVG with inset corners', () => {
  assert.equal(
    shapeMarkup(mkNode('hex')),
    SVG_HEADER
    + '<polygon class="shp" points="22,0 78,0 100,30 78,60 22,60 0,30"/></svg>',
  );
});

test('shapeMarkup: cylinder -> a body path + top ellipse', () => {
  assert.equal(
    shapeMarkup(mkNode('cylinder')),
    SVG_HEADER
    + '<path class="shp" d="M 0 9.6 L 0 50.4 A 50 9.6 0 0 0 100 50.4 L 100 9.6 Z"/>'
    + '<ellipse class="shp" cx="50" cy="9.6" rx="50" ry="9.6"/></svg>',
  );
});

test('shapeMarkup: a shape with no SVG geometry (e.g. rect) -> empty string', () => {
  assert.equal(shapeMarkup(mkNode('rect')), '');
});

test('shapeMarkup: an explicit node color adds a fill style to the shape element', () => {
  assert.equal(
    shapeMarkup(mkNode('diamond', 100, 60, { color: '#ff0000' })),
    SVG_HEADER
    + '<polygon class="shp" points="50,0 100,30 50,60 0,30" style="fill:#ff0000"/></svg>',
  );
});

test('shapeMarkup: no explicit color but a kind -> falls back to the kind\'s tint', () => {
  assert.equal(
    shapeMarkup({ ...mkNode('diamond'), kind: 'component' }),
    SVG_HEADER
    + '<polygon class="shp" points="50,0 100,30 50,60 0,30" style="fill:#25305a"/></svg>',
  );
});
