/* Shared categories, publishing and gallery UI. No credentials or service-role keys here. */
(() => {
  const CATEGORIES = Object.freeze(['Живопис', 'Цифрове мистецтво', 'Фотографія', 'Ілюстрація', 'Скульптура', 'Колаж', '3D-арт', 'Графіка']);
  const MAX_BYTES = 10 * 1024 * 1024;
  const MAX_IMAGES = 5;
  const PAGE_SIZE = 20;

  function createClient() {
    const config = window.artasAuthConfig;
    if (!config?.supabaseUrl || !config?.supabaseAnonKey || !window.supabase?.createClient) return null;
    return window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: { flowType: 'pkce', autoRefreshToken: true, persistSession: true, detectSessionInUrl: true },
    });
  }

  function categoryChoices(container, selected = []) {
    container.replaceChildren();
    CATEGORIES.forEach(category => {
      const label = document.createElement('label');
      label.className = 'category-choice';
      const input = document.createElement('input');
      input.type = 'checkbox'; input.name = 'artStyles'; input.value = category;
      input.checked = selected.includes(category);
      const text = document.createElement('span'); text.textContent = category;
      label.append(input, text); container.append(label);
    });
  }

  function validateMetadata(values) {
    const title = values.title.trim();
    const description = values.description.trim();
    if ([...title].length < 2 || [...title].length > 120) throw new Error('Назва має містити від 2 до 120 символів.');
    if ([...description].length > 2000) throw new Error('Опис має містити не більше 2000 символів.');
    if (!CATEGORIES.includes(values.category)) throw new Error('Оберіть категорію зі списку.');
    return { title, description, category: values.category };
  }

  async function prepareImage(file) {
    if (!file || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Оберіть зображення JPEG, PNG або WebP.');
    if (!file.size || file.size > MAX_BYTES) throw new Error('Розмір зображення має бути від 1 байта до 10 МіБ.');
    let bitmap;
    try { bitmap = await createImageBitmap(file); }
    catch { throw new Error('Не вдалося прочитати зображення. Файл пошкоджений або має невірний формат.'); }
    try {
      if (bitmap.width * bitmap.height > 40000000) throw new Error('Зображення завелике. Оберіть файл до 40 мегапікселів.');
      const scale = Math.min(1, 4096 / Math.max(bitmap.width, bitmap.height));
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Браузер не зміг обробити зображення.');
      context.drawImage(bitmap, 0, 0, width, height);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', 0.92));
      if (!blob || blob.type !== 'image/webp') throw new Error('Браузер не підтримує обробку WebP. Оновіть браузер.');
      if (blob.size > MAX_BYTES) throw new Error('Оброблений файл завеликий. Зменште зображення та спробуйте ще раз.');
      return { blob, width, height };
    } finally { bitmap.close(); }
  }

  // Reuse one ID and path on retries, including when the server committed an insert but its response was lost.
  async function publish(client, pending, onStage = () => {}) {
    const { data: auth, error: authError } = await client.auth.getUser();
    if (authError || !auth?.user || auth.user.id !== pending.record.author_id) throw new Error('Сесія завершилася або змінився акаунт. Увійдіть повторно.');
    onStage('Перевіряємо публікацію…');
    const existing = await client.from('artworks').select('id').eq('id', pending.record.id).maybeSingle();
    if (existing.error) throw new Error('Не вдалося перевірити публікацію. Спробуйте ще раз.');
    if (existing.data) return existing.data;
    const files = pending.files || [{ image: pending.image, path: pending.record.image_path, uploaded: pending.uploaded }];
    if (files.length < 1 || files.length > MAX_IMAGES) throw new Error('Оберіть від 1 до 5 зображень.');
    for (const [index, file] of files.entries()) {
      if (file.uploaded) continue;
      onStage(`Завантажуємо зображення ${index + 1} з ${files.length}…`);
      pending.uploadAttempted = true;
      const upload = await client.storage.from('artworks').upload(file.path, file.image.blob, { contentType: 'image/webp', upsert: false, cacheControl: '31536000' });
      if (upload.error) {
        // A lost response may mean the file already exists. Never overwrite it.
        if (String(upload.error.statusCode) !== '409' && upload.error.error !== 'Duplicate') throw new Error('Не вдалося завантажити зображення. Перевірте з’єднання та повторіть спробу.');
      }
      file.uploaded = true;
    }
    pending.uploaded = true;
    onStage('Публікуємо роботу…');
    const result = await client.from('artworks').insert(pending.record).select('id').single();
    if (!result.error) return result.data;
    // Do not delete an image on an ambiguous error: the publication could already be visible.
    const check = await client.from('artworks').select('id').eq('id', pending.record.id).maybeSingle();
    if (!check.error && check.data) return check.data;
    throw new Error('Не вдалося підтвердити публікацію. Натисніть «Повторити публікацію» — дублікат не буде створено.');
  }

  function imageUrl(client, path) { return client.storage.from('artworks').getPublicUrl(path).data.publicUrl; }
  function imagesFor(art) {
    return Array.isArray(art.images) && art.images.length ? art.images : [{ path: art.image_path, width: art.width, height: art.height }];
  }
  function carousel(client, art, expanded = false, initial = 0) {
    const images = imagesFor(art);
    let index = initial;
    const root = document.createElement('div'); root.className = `art-carousel${expanded ? ' expanded' : ''}`;
    root.setAttribute('role', 'group'); root.setAttribute('aria-label', `Зображення: ${art.title}`);
    const picture = document.createElement('img'); picture.loading = expanded ? 'eager' : 'lazy'; picture.draggable = false;
    const open = document.createElement(expanded ? 'div' : 'button'); open.className = 'art-open';
    if (!expanded) { open.type = 'button'; open.setAttribute('aria-label', `Переглянути: ${art.title}`); open.addEventListener('click', event => { if (!swiped || event.detail === 0) showDetail(client, art, index); swiped = false; }); }
    const failure = document.createElement('span'); failure.textContent = 'Зображення недоступне'; failure.hidden = true;
    picture.addEventListener('error', () => { picture.hidden = true; failure.hidden = false; });
    open.append(picture, failure); root.append(open);
    const controls = document.createElement('div'); controls.className = 'carousel-controls'; controls.hidden = images.length === 1;
    const prev = document.createElement('button'); prev.type = 'button'; prev.textContent = '‹'; prev.setAttribute('aria-label', 'Попереднє зображення');
    const next = document.createElement('button'); next.type = 'button'; next.textContent = '›'; next.setAttribute('aria-label', 'Наступне зображення');
    const dots = images.map((_, i) => {
      const dot = document.createElement('button'); dot.type = 'button'; dot.className = 'carousel-dot'; dot.setAttribute('aria-label', `Зображення ${i + 1} з ${images.length}`);
      dot.addEventListener('click', () => render(i)); return dot;
    });
    const counter = document.createElement('span'); counter.className = 'visually-hidden'; counter.setAttribute('aria-live', 'polite');
    controls.append(prev, ...dots, next); root.append(controls, counter);
    function render(value) {
      index = (value + images.length) % images.length;
      const image = images[index]; picture.hidden = false; failure.hidden = true;
      picture.src = imageUrl(client, image.path); picture.alt = `${art.title} — ${index + 1} / ${images.length}`;
      picture.width = image.width; picture.height = image.height;
      dots.forEach((dot, i) => dot.setAttribute('aria-pressed', String(i === index)));
      counter.textContent = `${index + 1} / ${images.length}`;
    }
    prev.addEventListener('click', () => render(index - 1)); next.addEventListener('click', () => render(index + 1));
    root.addEventListener('keydown', event => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); render(index + (event.key === 'ArrowRight' ? 1 : -1)); }
    });
    let start = null; let swiped = false;
    open.addEventListener('pointerdown', event => { start = { x: event.clientX, y: event.clientY }; swiped = false; });
    open.addEventListener('pointerup', event => {
      if (start && images.length > 1) {
        const dx = event.clientX - start.x; const dy = event.clientY - start.y;
        if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) { swiped = true; render(index + (dx < 0 ? 1 : -1)); }
      }
      start = null;
    });
    open.addEventListener('pointercancel', () => { start = null; });
    render(index); return root;
  }
  function authorLink(profile, id) { return profile?.username ? `profile.html?u=${encodeURIComponent(profile.username)}` : `profile.html?id=${encodeURIComponent(id)}`; }

  function showDetail(client, art, initial = 0) {
    const dialog = document.createElement('dialog'); dialog.className = 'art-detail';
    const close = document.createElement('button'); close.type = 'button'; close.className = 'outline-button'; close.textContent = 'Закрити ×';
    const picture = carousel(client, art, true, initial);
    const title = document.createElement('h2'); title.textContent = art.title; title.id = 'art-detail-title'; dialog.setAttribute('aria-labelledby', title.id);
    const description = document.createElement('p'); description.textContent = art.description; description.className = 'art-description';
    const author = document.createElement('a'); author.href = authorLink(art.profiles, art.author_id); author.textContent = art.profiles?.display_name || 'Профіль автора'; author.className = 'text-link';
    const category = document.createElement('p'); category.textContent = art.category;
    dialog.append(close, picture, title, author, category, description); document.body.append(dialog);
    close.addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => dialog.remove());
    dialog.showModal();
  }

  function card(client, art) {
    const article = document.createElement('article'); article.className = 'published-card';
    const button = carousel(client, art);
    const title = document.createElement('h3'); title.textContent = art.title;
    const author = document.createElement('a'); author.href = authorLink(art.profiles, art.author_id); author.textContent = art.profiles?.display_name || 'Митець Artas';
    const category = document.createElement('p'); category.textContent = art.category;
    article.append(button, title, author, category); return article;
  }

  function gallery({ client, container, status, retry, more, authorId, onCount = () => {} }) {
    let category = ''; let offset = 0; let generation = 0; let loading = false;
    const seen = new Set();
    async function load(reset = false) {
      if (loading && !reset) return;
      const request = reset ? ++generation : generation;
      if (reset) { offset = 0; seen.clear(); container.replaceChildren(); }
      loading = true; more.hidden = true; retry.hidden = true;
      status.textContent = 'Завантажуємо роботи…'; status.hidden = false;
      try {
        if (!client) throw new Error('Unavailable');
        let query = client.from('artworks').select('id,author_id,title,description,category,image_path,width,height,images,created_at,profiles(display_name,username)', { count: 'exact' });
        if (authorId) query = query.eq('author_id', authorId);
        if (category) query = query.eq('category', category);
        const { data, error, count } = await query.order('created_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + PAGE_SIZE - 1);
        if (request !== generation) return;
        if (error || !data) throw error || new Error('No data');
        data.forEach(art => { if (!seen.has(art.id)) { container.append(card(client, art)); seen.add(art.id); } });
        offset += data.length;
        onCount(count ?? offset);
        status.textContent = category ? 'У цій категорії ще немає робіт.' : 'Поки немає опублікованих робіт. Перша може бути вашою.';
        status.hidden = seen.size > 0;
        more.hidden = count !== null ? offset >= count : data.length < PAGE_SIZE;
      } catch {
        if (request !== generation) return;
        onCount(null); status.textContent = 'Не вдалося завантажити роботи. Спробуйте ще раз.'; status.hidden = false; retry.hidden = false;
      } finally { if (request === generation) loading = false; }
    }
    retry.addEventListener('click', () => load(false)); more.addEventListener('click', () => load(false));
    return { load: () => load(true), filter(value) { category = value; return load(true); } };
  }
  window.ArtasArt = Object.freeze({ CATEGORIES, MAX_BYTES, MAX_IMAGES, createClient, categoryChoices, validateMetadata, prepareImage, publish, gallery, imagesFor, carousel });
})();
