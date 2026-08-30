import test from 'node:test';
import assert from 'node:assert/strict';
import { selectReferences } from '../src/orchestration/reference-selector.mjs';

test('near-duplicate group collapses to best representative', () => {
  const selected = selectReferences([
    { id: 'a', similarityGroup: 'same', sharpness: 0.4, productVisibility: 0.5, fidelity: 0.6, uniqueness: 0.2, roleFit: 0.5, evidenceValue: 0.1 },
    { id: 'b', similarityGroup: 'same', sharpness: 1, productVisibility: 1, fidelity: 1, uniqueness: 0.2, roleFit: 1, evidenceValue: 0.1 },
    { id: 'c', similarityGroup: 'other', sharpness: 0.7, productVisibility: 0.8, fidelity: 0.8, uniqueness: 1, roleFit: 0.7, evidenceValue: 0.4 },
  ], 3);

  assert.deepEqual(selected.map((x) => x.id), ['b', 'c']);
});

test('limit prevents reference overuse', () => {
  const selected = selectReferences([
    { id: '1', sharpness: 1, productVisibility: 1, fidelity: 1, uniqueness: 1, roleFit: 1, evidenceValue: 1 },
    { id: '2', sharpness: 0.9, productVisibility: 0.9, fidelity: 0.9, uniqueness: 0.9, roleFit: 0.9, evidenceValue: 0.9 },
  ], 1);
  assert.equal(selected.length, 1);
});
