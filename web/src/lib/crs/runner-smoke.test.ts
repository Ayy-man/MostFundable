// web/src/lib/crs/runner-smoke.test.ts — Wave 0.
//
// Proves the zero-dependency test runner works before any real Phase 4 suite is written
// against it. Every assertion here stands in for a runner constraint that the rest of the
// phase depends on (04-RESEARCH.md §5, each verified empirically on Node v26.5.0 on
// 2026-08-16):
//
//   1. the quoted glob "src/**/*.test.ts" reaches a nested path — a directory argument does not
//   2. type annotations, generics, `interface`, `as` and `satisfies` all survive type stripping
//   3. a relative specifier carrying an explicit `.ts` extension resolves at runtime
//      (`./dep` and `./dep.js` both fail with ERR_MODULE_NOT_FOUND)
//   4. a type name produces no runtime binding, which is exactly why every type-only import
//      inside `web/src/lib/crs/` must be written `import type`
//
// Nothing is installed: `node:test` and `node:assert/strict` ship with Node.
// This file is deliberately self-contained so it runs green before any other Phase 4
// module exists.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

/** Erased at runtime. Constraint 4 asserts that this name is absent from the namespace. */
export interface SmokeShape {
  readonly label: string;
  readonly count: number;
}

/** A real runtime export, so constraint 4 compares a value against a type rather than
 *  against an empty namespace. */
export const SMOKE_LABEL = 'wave-0';

function identity<T>(value: T): T {
  return value;
}

const smoke = {
  label: SMOKE_LABEL,
  count: 1,
} satisfies SmokeShape;

describe('wave 0 — node:test with native TypeScript type stripping', () => {
  it('was discovered by the quoted glob at a nested path', () => {
    assert.ok(
      import.meta.url.endsWith('/src/lib/crs/runner-smoke.test.ts'),
      `expected a nested crs path, got ${import.meta.url}`,
    );
  });

  it('strips type annotations and generics', () => {
    const label: string = identity<string>(smoke.label);
    assert.equal(label, 'wave-0');
  });

  it('strips interface declarations and satisfies expressions', () => {
    const shape: SmokeShape = smoke;
    assert.equal(shape.count, 1);
  });

  it('strips as-casts', () => {
    const widened = smoke as { label: string };
    assert.equal(widened.label, 'wave-0');
  });

  it('resolves a relative specifier that carries an explicit .ts extension', async () => {
    const self = await import('./runner-smoke.test.ts');
    assert.equal(self.SMOKE_LABEL, 'wave-0');
  });

  it('exposes no runtime binding for a type-only name, so `import type` is mandatory', async () => {
    const self: Record<string, unknown> = await import('./runner-smoke.test.ts');
    assert.ok(
      Object.prototype.hasOwnProperty.call(self, 'SMOKE_LABEL'),
      'a value export must be present on the namespace',
    );
    assert.ok(
      !Object.prototype.hasOwnProperty.call(self, 'SmokeShape'),
      'an interface must leave no runtime binding behind',
    );
  });
});
