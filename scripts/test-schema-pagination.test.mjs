import assert from 'node:assert/strict';
import test from 'node:test';
import { assertSequentialSchemaPages } from './schema-pagination-contract.mjs';

const page = (offset, hasMore, names = []) => ({
  request: { workspace_id: 'workspace-test', identifier: 'pipeline-test', limit: 200, offset },
  response: { offset, limit: 200, objects: names.map((name) => ({ fully_qualified_name: name, selected: true })), has_more: hasMore },
});

test('sparse selected objects require sequential pages, including empty middle and terminal pages', () => {
  const pages = [
    page(0, true, ['Account', 'Case']), page(200, true, ['Contact']),
    page(400, true), page(600, true, ['Opportunity']), page(800, true),
    page(1000, true), page(1200, false),
  ];
  assertSequentialSchemaPages(pages);
  assert.deepEqual(pages.flatMap(({ response }) => response.objects.map((row) => row.fully_qualified_name)),
    ['Account', 'Case', 'Contact', 'Opportunity']);
});

test('distant terminal probes and binary-search offsets cannot hide unread pages', () => {
  for (const offsets of [[0, 200, 9800], [0, 200, 100], [0, 200, 5000, 2800, 1800, 1300]]) {
    const pages = offsets.map((offset, index) => page(offset, index < offsets.length - 1));
    assert.throws(() => assertSequentialSchemaPages(pages), /sequentially/);
  }
});

test('finding expected names does not justify stopping before has_more is false', () => {
  assert.throws(() => assertSequentialSchemaPages([page(0, true, ['Account', 'Case', 'Contact', 'Opportunity'])]), /incomplete/);
});

test('traversal stops on the first terminal page', () => {
  assertSequentialSchemaPages([page(0, false)]);
  assert.throws(() => assertSequentialSchemaPages([page(0, false), page(200, false)]), /after completion/);
});

test('traversal cannot silently change workspace, pipeline, filters, or page size', () => {
  for (const patch of [{ workspace_id: 'other' }, { identifier: 'other' }, { all: true }, { with_fields: true }, { limit: 100 }]) {
    const next = page(200, false);
    Object.assign(next.request, patch);
    assert.throws(() => assertSequentialSchemaPages([page(0, true), next]));
  }
});
