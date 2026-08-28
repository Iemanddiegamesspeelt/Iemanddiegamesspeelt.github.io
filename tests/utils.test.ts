import assert from 'node:assert/strict';
import test from 'node:test';
import { formatGeometryDashVersion } from '../lib/utils';

test('formats Geometry Dash versions without floating-point noise', () => {
  assert.equal(formatGeometryDashVersion('2.2081000804901123'), '2.2081');
  assert.equal(formatGeometryDashVersion('2.2'), '2.2');
  assert.equal(formatGeometryDashVersion('22074'), '2.2074');
  assert.equal(formatGeometryDashVersion('unknown'), 'Unknown');
});
