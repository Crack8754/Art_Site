const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../public/artworks.js'), 'utf8');
function api(extra = {}) {
  const context = { window: {}, ...extra };
  vm.runInNewContext(source, context);
  return context.window.ArtasArt;
}
function fixture(overrides = {}) {
  let row = null; let uploads = 0; let inserts = 0;
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: 'owner' } } }) },
    from() {
      return {
        select() { return this; }, eq() { return this; },
        maybeSingle: async () => ({ data: row }),
        insert(record) {
          inserts++;
          return { select() { return this; }, async single() {
            if (overrides.rejectInsert && inserts === 1) return { error: { code: '42501' } };
            row = { id: record.id };
            if (overrides.loseResponse) return { error: { code: 'network' } };
            return { data: row };
          } };
        },
      };
    },
    storage: { from: () => ({ upload: async () => {
      uploads++;
      if ((overrides.failUpload && uploads === 1) || uploads === overrides.failAt) return { error: { statusCode: '503' } };
      if (overrides.duplicate) return { error: { statusCode: '409' } };
      return { data: {} };
    } }) },
  };
  const pending = { uploaded: false, image: { blob: {} }, record: { id: 'art', author_id: 'owner', image_path: 'owner/art.webp' } };
  return { client, pending, calls: () => ({ uploads, inserts }) };
}

test('metadata is trimmed; unknown categories and blank titles are rejected', () => {
  const art = api();
  assert.equal(art.validateMetadata({ title: '  Етюд  ', description: '  Текст ', category: 'Живопис' }).title, 'Етюд');
  assert.throws(() => art.validateMetadata({ title: '  ', description: '', category: 'Живопис' }));
  assert.throws(() => art.validateMetadata({ title: 'Етюд', description: '', category: 'invented' }));
});

test('SQL allow-list matches every selectable category', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../supabase/artworks.sql'), 'utf8');
  for (const category of api().CATEGORIES) assert.equal(sql.split(`'${category}'`).length - 1, 2);
});

test('publishing twice with the same ID does not upload or insert twice', async () => {
  const f = fixture(); const art = api();
  await art.publish(f.client, f.pending);
  await art.publish(f.client, f.pending);
  assert.deepEqual(f.calls(), { uploads: 1, inserts: 1 });
});

test('retry after rejected metadata reuses the uploaded image', async () => {
  const f = fixture({ rejectInsert: true }); const art = api();
  await assert.rejects(() => art.publish(f.client, f.pending));
  await art.publish(f.client, f.pending);
  assert.deepEqual(f.calls(), { uploads: 1, inserts: 2 });
});

test('lost insert response is reconciled with the stored record', async () => {
  const f = fixture({ loseResponse: true });
  assert.equal((await api().publish(f.client, f.pending)).id, 'art');
  assert.deepEqual(f.calls(), { uploads: 1, inserts: 1 });
});

test('upload failure does not create a metadata row and remains retryable', async () => {
  const f = fixture({ failUpload: true }); const art = api();
  await assert.rejects(() => art.publish(f.client, f.pending));
  assert.deepEqual(f.calls(), { uploads: 1, inserts: 0 });
  await art.publish(f.client, f.pending);
  assert.deepEqual(f.calls(), { uploads: 2, inserts: 1 });
});

test('duplicate object after lost upload response can complete metadata insertion', async () => {
  const f = fixture({ duplicate: true });
  assert.equal((await api().publish(f.client, f.pending)).id, 'art');
});

test('expired or changed account cannot publish pending work', async () => {
  for (const user of [null, { id: 'other-user' }]) {
    const f = fixture(); f.client.auth.getUser = async () => ({ data: { user } });
    await assert.rejects(() => api().publish(f.client, f.pending));
    assert.deepEqual(f.calls(), { uploads: 0, inserts: 0 });
  }
});

test('file validation rejects SVG, zero-byte and oversized files before decoding', async () => {
  const art = api();
  for (const file of [{ type: 'image/svg+xml', size: 50 }, { type: 'image/png', size: 0 }, { type: 'image/jpeg', size: art.MAX_BYTES + 1 }]) {
    await assert.rejects(() => art.prepareImage(file));
  }
});

test('image preparation scales proportionally and releases decoded resources', async () => {
  let closed = false; const canvas = { getContext: () => ({ drawImage() {} }), toBlob: cb => cb({ type: 'image/webp', size: 200 }) };
  const art = api({ document: { createElement: () => canvas }, createImageBitmap: async () => ({ width: 8000, height: 4000, close() { closed = true; } }) });
  const result = await art.prepareImage({ type: 'image/png', size: 500 });
  assert.equal(result.width, 4096); assert.equal(result.height, 2048); assert.equal(closed, true);
});

test('corrupt and excessively large decoded images are rejected', async () => {
  await assert.rejects(() => api({ createImageBitmap: async () => { throw new Error('decode'); } }).prepareImage({ type: 'image/png', size: 10 }));
  let closed = false;
  await assert.rejects(() => api({ createImageBitmap: async () => ({ width: 10000, height: 10000, close() { closed = true; } }) }).prepareImage({ type: 'image/png', size: 10 }));
  assert.equal(closed, true);
});

function multiFixture(count, overrides = {}) {
  const f = fixture(overrides);
  f.pending.files = Array.from({ length: count }, (_, index) => ({ image: { blob: {} }, path: `owner/art-${index}.webp`, uploaded: false }));
  return f;
}

test('five photos create one artwork only after all uploads complete', async () => {
  const f = multiFixture(5);
  await api().publish(f.client, f.pending);
  assert.deepEqual(f.calls(), { uploads: 5, inserts: 1 });
  await api().publish(f.client, f.pending);
  assert.deepEqual(f.calls(), { uploads: 5, inserts: 1 });
});

test('partial batch failure resumes from the failed image without republishing previous files', async () => {
  const f = multiFixture(5, { failAt: 3 });
  const art = api();
  await assert.rejects(() => art.publish(f.client, f.pending));
  assert.deepEqual(f.calls(), { uploads: 3, inserts: 0 });
  assert.deepEqual(f.pending.files.map(file => file.uploaded), [true, true, false, false, false]);
  await art.publish(f.client, f.pending);
  assert.deepEqual(f.calls(), { uploads: 6, inserts: 1 });
});

test('empty and over-limit batches are rejected before storage writes', async () => {
  for (const count of [0, 6]) {
    const f = multiFixture(count);
    await assert.rejects(() => api().publish(f.client, f.pending));
    assert.deepEqual(f.calls(), { uploads: 0, inserts: 0 });
  }
});

test('legacy artwork uses its original cover; albums preserve their image order', () => {
  const art = api();
  assert.equal(art.imagesFor({ image_path: 'old.webp', width: 20, height: 30 })[0].path, 'old.webp');
  const images = [{ path: 'a' }, { path: 'b' }];
  assert.equal(art.imagesFor({ images }), images);
});

function fakeDocument() {
  return { createElement(tag) {
    return { tag, children: [], attrs: {}, events: {},
      append(...children) { this.children.push(...children); },
      setAttribute(name, value) { this.attrs[name] = value; },
      addEventListener(name, fn) { this.events[name] = fn; },
    };
  } };
}

test('carousel supports dots, arrows, keyboard, swipe and recovers from image errors', () => {
  const art = api({ document: fakeDocument() });
  const client = { storage: { from: () => ({ getPublicUrl: path => ({ data: { publicUrl: path } }) }) } };
  const root = art.carousel(client, { title: 'Test', images: [{ path: 'a', width: 10, height: 20 }, { path: 'b', width: 20, height: 10 }] });
  const [open, controls] = root.children;
  const [picture, failure] = open.children;
  const [prev, firstDot, secondDot, next] = controls.children;
  assert.equal(picture.src, 'a');
  next.events.click(); assert.equal(picture.src, 'b');
  assert.equal(secondDot.attrs['aria-pressed'], 'true');
  next.events.click(); assert.equal(picture.src, 'a');
  prev.events.click(); assert.equal(picture.src, 'b');
  firstDot.events.click(); assert.equal(picture.src, 'a');
  root.events.keydown({ key: 'ArrowRight', preventDefault() {} }); assert.equal(picture.src, 'b');
  open.events.pointerdown({ clientX: 200, clientY: 10 });
  open.events.pointerup({ clientX: 50, clientY: 15 }); assert.equal(picture.src, 'a');
  picture.events.error(); assert.equal(failure.hidden, false);
  next.events.click(); assert.equal(failure.hidden, true); assert.equal(picture.hidden, false);
});

test('single-photo carousel hides navigation', () => {
  const art = api({ document: fakeDocument() });
  const client = { storage: { from: () => ({ getPublicUrl: path => ({ data: { publicUrl: path } }) }) } };
  const root = art.carousel(client, { title: 'Old', image_path: 'old.webp', width: 10, height: 20 });
  assert.equal(root.children[1].hidden, true);
});
