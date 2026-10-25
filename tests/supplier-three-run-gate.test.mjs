import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
const script = readFileSync(new URL('../scripts/n8n-supplier-catalog-sync.sh', import.meta.url), 'utf8');
const workflow = JSON.parse(readFileSync(new URL('../docs/n8n-wholesalehub-mvp-sync.workflow.json', import.meta.url), 'utf8'));
test('supplier catalog gate matches three daily workflow runs', () => {
  const gate = script.split('start_step lock')[1].split('cd "$PROJECT_DIR"')[0];
  for (const hour of ['09','15','21']) assert.match(gate, new RegExp('RUN_HOUR" != "'+hour+'"'));
  for (const oldHour of ['11','18']) assert.doesNotMatch(gate, new RegExp('RUN_HOUR" != "'+oldHour+'"'));
  assert.match(gate, /SECONDARY_ONLY/);
  const nodes = Object.values(workflow).flatMap(v => Array.isArray(v?.nodes) ? v.nodes : []);
  const triggers = nodes.filter(n => n?.parameters?.triggerTimes?.item);
  assert.ok(triggers.length > 0, 'workflow must have a schedule trigger');
  const hours = triggers.flatMap(n => n.parameters.triggerTimes.item.map(t => t.hour));
  assert.deepEqual(hours, [9,15,21]);
});
