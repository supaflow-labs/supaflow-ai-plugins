import assert from 'node:assert/strict';

// Offline/host-transcript test oracle only; not packaged or a runtime tool.
export function assertSequentialSchemaPages(pages) {
  assert(pages.length > 0, 'No schema pages observed');
  const first = pages[0].request;
  const limit = first.limit ?? 25;
  assert(Number.isInteger(limit) && limit > 0);
  let nextOffset = 0;
  for (const [index, { request, response }] of pages.entries()) {
    assert.equal(request.offset ?? 0, nextOffset, 'Schema offsets must advance sequentially');
    assert.equal(request.limit ?? 25, limit, 'Schema page limit changed');
    for (const key of ['workspace_id', 'identifier']) assert.equal(request[key], first[key]);
    for (const key of ['all', 'with_fields']) assert.equal(request[key] ?? false, first[key] ?? false);
    assert.equal(response.offset, nextOffset);
    assert.equal(response.limit, limit);
    assert(Array.isArray(response.objects));
    assert.equal(typeof response.has_more, 'boolean');
    if (index < pages.length - 1) assert.equal(response.has_more, true, 'Traversal continued after completion');
    nextOffset += limit;
  }
  assert.equal(pages.at(-1).response.has_more, false, 'Schema traversal is incomplete');
}
