(() => {
  const client = ArtasArt.createClient();
  const form = document.querySelector('#upload-form');
  const fields = document.querySelector('#upload-fields');
  const submit = document.querySelector('#publish-submit');
  const discard = document.querySelector('#discard-upload');
  const message = document.querySelector('#upload-message');
  const gate = document.querySelector('#upload-gate');
  const fileInput = document.querySelector('#art-file');
  let user = null;
  let images = [];
  let pending = null;
  let busy = false;
  let imageVersion = 0;
  let preparing = false;

  ArtasArt.CATEGORIES.forEach(value => {
    const option = document.createElement('option'); option.value = value; option.textContent = value;
    document.querySelector('#art-category').append(option);
  });
  function status(text, kind = 'error') { message.textContent = text; message.dataset.kind = kind; message.hidden = false; }

  async function checkAccess() {
    const retry = document.querySelector('#upload-retry-gate');
    retry.hidden = true;
    try {
      if (!client) throw new Error('Публікація тимчасово недоступна.');
      const { data, error } = await client.auth.getUser();
      if (!data?.user) {
        gate.textContent = 'Щоб опублікувати роботу, увійдіть у свій акаунт.';
        document.querySelector('#upload-signin').hidden = false;
        retry.hidden = false;
        return;
      }
      if (error) throw error;
      const result = await client.from('profiles').select('id').eq('id', data.user.id).maybeSingle();
      if (result.error) throw result.error;
      if (!result.data) {
        gate.textContent = 'Для публікації потрібен профіль. Спочатку перевірте свій профіль.';
        document.querySelector('#upload-profile').hidden = false;
        retry.hidden = false;
        return;
      }
      user = data.user; gate.hidden = true; form.hidden = false;
      document.querySelector('#upload-signin').hidden = true;
      document.querySelector('#upload-profile').hidden = true;
    } catch {
      gate.textContent = 'Не вдалося перевірити акаунт. Перевірте з’єднання й спробуйте ще раз.';
      retry.hidden = false;
    }
  }
  document.querySelector('#upload-retry-gate').addEventListener('click', checkAccess);
  checkAccess();

  function clearPreview() {
    images.forEach(image => URL.revokeObjectURL(image.url));
    images = [];
    renderPreviews();
  }
  function renderPreviews() {
    const thumbnails = document.querySelector('#image-thumbnails'); thumbnails.replaceChildren();
    const preview = document.querySelector('#art-preview'); preview.removeAttribute('src'); preview.hidden = true;
    document.querySelector('#preview-placeholder').hidden = images.length > 0;
    if (images.length) { preview.src = images[0].url; preview.hidden = false; }
    images.forEach((image, index) => {
      const item = document.createElement('div'); item.className = 'image-thumbnail';
      const select = document.createElement('button'); select.type = 'button'; select.setAttribute('aria-label', `Переглянути фото ${index + 1}`);
      const thumb = document.createElement('img'); thumb.src = image.url; thumb.alt = `Фото ${index + 1}`; select.append(thumb);
      select.addEventListener('click', () => { preview.src = image.url; });
      const label = document.createElement('small'); label.textContent = index ? `Фото ${index + 1}` : 'Обкладинка';
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Видалити'; remove.disabled = preparing;
      remove.addEventListener('click', () => { URL.revokeObjectURL(image.url); images.splice(index, 1); renderPreviews(); });
      item.append(select, label, remove); thumbnails.append(item);
    });
  }
  fileInput.addEventListener('change', async () => {
    const files = Array.from(fileInput.files); fileInput.value = '';
    if (!files.length || busy || preparing) return;
    if (files.length + images.length > ArtasArt.MAX_IMAGES) { status('В одній роботі може бути максимум 5 зображень. Зайві файли не додано.'); return; }
    const version = ++imageVersion;
    message.hidden = true;
    preparing = true; submit.disabled = true; fileInput.disabled = true; renderPreviews();
    try {
      const prepared = [];
      for (const file of files) prepared.push(await ArtasArt.prepareImage(file));
      if (version !== imageVersion) return;
      images.push(...prepared.map(image => ({ ...image, url: URL.createObjectURL(image.blob) })));
      status(`Готово: ${images.length} з 5 зображень.`, 'success');
    } catch (error) {
      if (version !== imageVersion) return;
      status(`${error.message} Цю добірку файлів не додано.`);
    } finally {
      if (version === imageVersion) { preparing = false; submit.disabled = false; fileInput.disabled = false; renderPreviews(); }
    }
  });

  function completed() {
    pending = null;
    form.reset(); clearPreview();
    fields.disabled = false; discard.hidden = true;
    document.querySelector('#upload-success-link').hidden = false;
    status('Роботу опубліковано! Вона вже у стрічці та вашому профілі.', 'success');
    submit.textContent = 'Опублікувати ще одну роботу →';
  }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || preparing || !user) return;
    if (!pending) {
      if (!form.reportValidity()) return;
      if (!images.length) { status('Оберіть зображення та дочекайтеся попереднього перегляду.'); return; }
      try {
        const values = ArtasArt.validateMetadata(Object.fromEntries(new FormData(form)));
        const id = crypto.randomUUID();
        const files = images.map((image, index) => ({ image, uploaded: false, path: `${user.id}/${id}${index ? `-${index + 1}` : ''}.webp` }));
        const metadata = files.map(file => ({ path: file.path, width: file.image.width, height: file.image.height }));
        pending = { files, record: { id, author_id: user.id, ...values, image_path: metadata[0].path, width: metadata[0].width, height: metadata[0].height, images: metadata } };
      } catch (error) { status(error.message); return; }
    }
    busy = true; submit.disabled = true; discard.disabled = true; fields.disabled = true;
    document.querySelector('#upload-success-link').hidden = true;
    try { await ArtasArt.publish(client, pending, text => status(text, 'success')); completed(); }
    catch (error) {
      status(error.message || 'Помилка мережі. Спробуйте ще раз.');
      submit.textContent = 'Повторити публікацію'; discard.hidden = false;
    } finally { busy = false; submit.disabled = false; discard.disabled = false; }
  });

  discard.addEventListener('click', async () => {
    if (!pending || busy) return;
    busy = true; discard.disabled = true; submit.disabled = true;
    try {
      if (pending.uploadAttempted) {
        const check = await client.from('artworks').select('id').eq('id', pending.record.id).maybeSingle();
        if (check.error) throw check.error;
        if (check.data) { completed(); return; }
        const result = await client.storage.from('artworks').remove(pending.files.map(file => file.path));
        if (result.error) throw result.error;
      }
      pending = null; fields.disabled = false; discard.hidden = true;
      submit.textContent = 'Опублікувати роботу →';
      status('Завантаження скасовано. Можна змінити дані та спробувати знову.', 'success');
    } catch { status('Не вдалося перевірити стан або скасувати завантаження. Перевірте з’єднання та повторіть спробу.'); }
    finally { busy = false; discard.disabled = false; submit.disabled = false; }
  });
  window.addEventListener('beforeunload', event => { if (pending || busy) { event.preventDefault(); event.returnValue = ''; } });
})();
