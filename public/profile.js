const config = window.artasAuthConfig;
const notice = document.querySelector('#profile-notice');
const editModal = document.querySelector('#edit-modal');
const settingsModal = document.querySelector('#settings-modal');
const form = document.querySelector('#profile-form');
let client = null;
let session = null;
let profile = null;
let isOwner = false;
let worksGallery = null;

if (config?.supabaseUrl && config?.supabaseAnonKey && window.supabase?.createClient) {
  client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, { auth: { flowType: 'pkce', autoRefreshToken: true, persistSession: true, detectSessionInUrl: true } });
  initialise();
} else {
  showNotice('Профіль потребує налаштованого Supabase. Додайте ключі у public/auth-config.js.', 'error');
  renderUnavailable();
}

async function initialise() {
  const { data } = await client.auth.getSession();
  session = data.session;
  const params = new URLSearchParams(window.location.search);
  const requestedUsername = params.get('u');
  const requestedId = params.get('id');
  if (!requestedUsername && !requestedId && !session) { showNotice('Увійдіть у свій акаунт, щоб створити та переглянути профіль.', 'error'); renderUnavailable(); return; }
  isOwner = Boolean(session && !requestedUsername);
  const query = client.from('profiles').select('*');
  const { data: profileData, error } = requestedUsername ? await query.eq('username', requestedUsername).maybeSingle() : await query.eq('id', requestedId || session.user.id).maybeSingle();
  if (error) { showNotice('Не вдалося завантажити профіль. Оновіть сторінку та спробуйте ще раз.', 'error'); renderUnavailable(); return; }
  if (!profileData) { showNotice(requestedUsername ? 'Профіль із таким username не знайдено.' : 'Запис вашого профілю ще не створений. Зверніться до адміністратора для відновлення профілю.', 'error'); renderUnavailable(); return; }
  profile = profileData;
  isOwner = Boolean(session && profile.id === session.user.id);
  renderProfile();
  loadFollowData();
  worksGallery = ArtasArt.gallery({
    client, authorId: profile.id, container: document.querySelector('#profile-artworks'),
    status: document.querySelector('#works-copy'), retry: document.querySelector('#works-retry'), more: document.querySelector('#works-more'),
    onCount(count) { document.querySelector('#artwork-count').textContent = count ?? '—'; },
  });
  worksGallery.load();
}

function createDraft() { return { id: session?.user?.id, display_name: session?.user?.user_metadata?.display_name || session?.user?.email?.split('@')[0] || 'Митець Artas', username: '', bio: '', location: '', avatar_url: '', website_url: '', instagram_url: '', behance_url: '', art_styles: [], is_artist: false }; }
function renderUnavailable() { document.querySelector('#profile-name').textContent = 'Профіль недоступний'; document.querySelector('#profile-handle').textContent = ''; document.querySelector('#works-copy').textContent = 'Роботи недоступні, поки профіль не завантажено.'; }
function renderProfile() {
  const initials = (profile.display_name || 'A').trim().slice(0, 1).toUpperCase();
  const avatarUrl = normaliseUrl(profile.avatar_url); const avatar = document.querySelector('#profile-avatar'); avatar.textContent = initials; avatar.style.backgroundImage = avatarUrl ? `url("${safeCssUrl(avatarUrl)}")` : ''; avatar.classList.toggle('has-image', Boolean(avatarUrl));
  document.querySelector('#profile-name').textContent = profile.display_name || 'Митець Artas'; document.querySelector('#profile-handle').textContent = profile.username ? `@${profile.username}` : '@налаштуйте_username'; document.title = `${profile.display_name || 'Профіль'} — Artas`;
  document.querySelector('#profile-bio').textContent = profile.bio || (isOwner ? 'Додайте короткий опис, щоб розповісти про свою творчість.' : 'Цей митець ще не додав опис.');
  setTextDetail('#profile-location', profile.location, '⌖ '); setLink('#profile-website', profile.website_url, '↗ Сайт'); setLink('#profile-instagram', profile.instagram_url, '◎ Instagram'); setLink('#profile-behance', profile.behance_url, '◒ Behance');
  const tags = document.querySelector('#style-tags'); tags.innerHTML = ''; (profile.art_styles || []).forEach((style) => { const tag = document.createElement('span'); tag.textContent = style; tags.append(tag); });
  document.querySelector('#profile-actions').hidden = !isOwner; document.querySelector('#follow-button').hidden = isOwner || !session; document.querySelector('#saved-tab').hidden = !isOwner; document.querySelectorAll('[data-profile-publish]').forEach((button) => { button.hidden = !isOwner; });
  document.querySelector('#account-email').textContent = session?.user?.email || '';
}
function setTextDetail(selector, value, prefix) { const element = document.querySelector(selector); element.hidden = !value; if (value) element.querySelector('b').textContent = `${prefix}${value}`; }
function setLink(selector, url, label) { const element = document.querySelector(selector); const valid = normaliseUrl(url); element.hidden = !valid; if (valid) { element.href = valid; element.textContent = label; } }
function normaliseUrl(value) { if (!value) return ''; try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : ''; } catch { return ''; } }
function safeCssUrl(value) { return String(value).replace(/["\\]/g, ''); }
function openModal(modal) { modal.classList.add('open'); modal.setAttribute('aria-hidden', 'false'); }
function closeModal(modal) { modal.classList.remove('open'); modal.setAttribute('aria-hidden', 'true'); }
function showNotice(message, kind) { notice.textContent = message; notice.dataset.kind = kind; notice.hidden = false; }
function formMessage(message, kind) { const target = document.querySelector('#profile-form-message'); target.textContent = message; target.dataset.kind = kind; target.hidden = false; }

document.querySelector('#edit-profile').addEventListener('click', () => { fillForm(); openModal(editModal); });
document.querySelector('#settings-button').addEventListener('click', () => { resetPasswordForm(); openModal(settingsModal); });
document.querySelectorAll('[data-close-modal]').forEach((button) => button.addEventListener('click', () => { closeModal(editModal); closeModal(settingsModal); }));
document.querySelector('#bio-count').closest('label').querySelector('textarea').addEventListener('input', (event) => { document.querySelector('#bio-count').textContent = event.target.value.length; });
document.querySelectorAll('.profile-tab').forEach((tab) => tab.addEventListener('click', () => {
  document.querySelectorAll('.profile-tab').forEach((item) => { item.classList.toggle('active', item === tab); item.setAttribute('aria-selected', String(item === tab)); });
  document.querySelector('#profile-works').hidden = tab.dataset.tab !== 'works';
  document.querySelector('#saved-state').hidden = tab.dataset.tab !== 'saved';
}));
document.querySelectorAll('[data-profile-publish]').forEach((button) => button.addEventListener('click', () => { window.location.href = 'upload.html'; }));
document.querySelector('#signout-button').addEventListener('click', async () => { if (!client) return; const { error } = await client.auth.signOut(); if (error) { showNotice('Не вдалося завершити сеанс. Спробуйте ще раз.', 'error'); return; } window.location.href = 'index.html'; });
document.querySelector('#follow-button').addEventListener('click', toggleFollow);
document.querySelector('#retry-follows').addEventListener('click', loadFollowData);

const passwordForm = document.querySelector('#password-form');
const passwordMessage = document.querySelector('#password-message');
const changePasswordButton = document.querySelector('#change-password-button');
let passwordBusy = false;

function resetPasswordForm() {
  if (passwordBusy) return;
  passwordForm.reset();
  passwordForm.hidden = true;
  passwordMessage.hidden = true;
  changePasswordButton.setAttribute('aria-expanded', 'false');
}

changePasswordButton.addEventListener('click', () => {
  passwordForm.hidden = false;
  changePasswordButton.setAttribute('aria-expanded', 'true');
  passwordForm.elements.newPassword.focus();
});

document.querySelectorAll('[data-close-modal]').forEach((button) => button.addEventListener('click', resetPasswordForm));

function passwordStatus(message, kind = 'error') {
  passwordMessage.textContent = message;
  passwordMessage.dataset.kind = kind;
  passwordMessage.hidden = false;
}

passwordForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (passwordBusy || !passwordForm.reportValidity()) return;
  passwordMessage.hidden = true;
  const password = passwordForm.elements.newPassword.value;
  if (password.length < 12) { passwordStatus('Пароль має містити щонайменше 12 символів.'); return; }
  if (password !== passwordForm.elements.confirmPassword.value) {
    passwordStatus('Паролі не збігаються. Перевірте обидва поля.');
    passwordForm.elements.confirmPassword.focus();
    return;
  }
  if (!client) { passwordStatus('Зміна пароля тимчасово недоступна. Спробуйте пізніше.'); return; }
  const submit = passwordForm.querySelector('[type="submit"]');
  passwordBusy = true;
  submit.disabled = true;
  submit.textContent = 'Збереження…';
  try {
    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    if (sessionError || !sessionData.session) { passwordStatus('Сесія завершилася. Увійдіть повторно та спробуйте ще раз.'); return; }
    const attributes = { password };
    if (passwordForm.elements.currentPassword.value) attributes.currentPassword = passwordForm.elements.currentPassword.value;
    const { error } = await client.auth.updateUser(attributes);
    if (error) {
      const messages = {
        same_password: 'Новий пароль має відрізнятися від поточного.',
        weak_password: 'Цей пароль недостатньо надійний. Оберіть довший та унікальний пароль.',
        current_password_mismatch: 'Поточний пароль неправильний. Спробуйте ще раз.',
        current_password_required: 'Введіть поточний пароль для підтвердження зміни.',
        reauthentication_needed: 'Для зміни пароля потрібно вийти й увійти повторно, а потім повторити спробу.',
        session_not_found: 'Сесія завершилася. Увійдіть повторно.',
        over_request_rate_limit: 'Забагато спроб. Зачекайте трохи та повторіть.',
      };
      passwordStatus(messages[error.code] || 'Не вдалося змінити пароль. Спробуйте ще раз пізніше.');
      return;
    }
    passwordForm.reset();
    passwordStatus('Пароль успішно змінено. Використовуйте новий пароль під час наступного входу.', 'success');
  } catch {
    passwordStatus('Не вдалося з’єднатися із сервером. Перевірте інтернет та повторіть спробу.');
  } finally {
    passwordBusy = false;
    submit.disabled = false;
    submit.textContent = 'Зберегти пароль';
    if (settingsModal.getAttribute('aria-hidden') === 'true') resetPasswordForm();
  }
});

function fillForm() {
  const values = { avatarUrl: profile.avatar_url, displayName: profile.display_name, username: profile.username, bio: profile.bio, location: profile.location, websiteUrl: profile.website_url, instagramUrl: profile.instagram_url, behanceUrl: profile.behance_url, isArtist: profile.is_artist };
  Object.entries(values).forEach(([name, value]) => { const field = form.elements[name]; if (field?.type === 'checkbox') field.checked = Boolean(value); else if (field) field.value = value || ''; });
  ArtasArt.categoryChoices(document.querySelector('#profile-categories'), profile.art_styles || []);
  document.querySelector('#legacy-styles-notice').hidden = !(profile.art_styles || []).some(style => !ArtasArt.CATEGORIES.includes(style));
  document.querySelector('#bio-count').textContent = (profile.bio || '').length;
  document.querySelector('#profile-form-message').hidden = true;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault(); if (!form.reportValidity() || !client || !session) return;
  const values = Object.fromEntries(new FormData(form).entries()); const username = values.username.trim().toLowerCase(); const links = ['avatarUrl', 'websiteUrl', 'instagramUrl', 'behanceUrl'];
  if (!/^[a-z0-9_]{3,30}$/.test(username)) { formMessage('Username має містити 3–30 латинських символів, цифр або _.', 'error'); return; }
  for (const key of links) if (values[key] && !normaliseUrl(values[key])) { formMessage('Посилання мають починатися з http:// або https://.', 'error'); return; }
  const styles = new FormData(form).getAll('artStyles').filter(value => ArtasArt.CATEGORIES.includes(value));
  const update = { display_name: values.displayName.trim(), username, bio: values.bio.trim(), location: values.location.trim(), art_styles: styles, avatar_url: values.avatarUrl.trim() || null, website_url: values.websiteUrl.trim() || null, instagram_url: values.instagramUrl.trim() || null, behance_url: values.behanceUrl.trim() || null, is_artist: form.elements.isArtist.checked };
  if (update.display_name.length < 2) { formMessage('Ім’я має містити щонайменше 2 символи без пробілів на початку та в кінці.', 'error'); return; }
  const submit = form.querySelector('[type="submit"]'); submit.disabled = true;
  try {
    // Profiles are created by the database trigger. Editing must not require INSERT permission.
    const { data, error } = await client.from('profiles').update(update).eq('id', session.user.id).select().maybeSingle();
    if (error) {
      const messages = {
        '23505': 'Цей username уже зайнятий. Оберіть інший.',
        '23514': 'Перевірте довжину імені, опису та формат username.',
        '42501': 'Недостатньо прав для оновлення профілю. Увійдіть повторно; якщо помилка залишиться, зверніться до адміністратора.',
        'PGRST204': 'Редагування профілю тимчасово недоступне: потрібно оновити налаштування сайту.',
      };
      formMessage(messages[error.code] || 'Не вдалося зберегти профіль. Спробуйте ще раз пізніше.', 'error');
      return;
    }
    if (!data) { formMessage('Профіль не знайдено або сесія завершилася. Оновіть сторінку та увійдіть повторно.', 'error'); return; }
    profile = data; renderProfile(); closeModal(editModal); showNotice('Профіль успішно оновлено.', 'success'); window.history.replaceState({}, '', `profile.html?u=${encodeURIComponent(profile.username)}`);
  } catch {
    formMessage('Не вдалося з’єднатися із сервером. Перевірте інтернет і спробуйте ще раз.', 'error');
  } finally {
    submit.disabled = false;
  }
});

async function loadFollowData() {
  if (!client || !profile?.id) return;
  const button = document.querySelector('#follow-button');
  const retry = document.querySelector('#retry-follows');
  button.disabled = true;
  retry.disabled = true;
  document.querySelector('#follow-error').hidden = true;
  try {
    const [followers, following] = await Promise.all([
      client.from('follows').select('*', { count: 'exact', head: true }).eq('following_id', profile.id),
      client.from('follows').select('*', { count: 'exact', head: true }).eq('follower_id', profile.id),
    ]);
    if (followers.error || following.error || followers.count === null || following.count === null) throw new Error('Counts unavailable');
    if (session && !isOwner) {
      const { data, error } = await client.from('follows').select('follower_id').eq('follower_id', session.user.id).eq('following_id', profile.id).maybeSingle();
      if (error) throw error;
      updateFollowButton(Boolean(data));
      button.disabled = false;
    }
    document.querySelector('#follower-count').textContent = followers.count;
    document.querySelector('#following-count').textContent = following.count;
  } catch {
    document.querySelector('#follower-count').textContent = '—';
    document.querySelector('#following-count').textContent = '—';
    document.querySelector('#follow-error').hidden = false;
  } finally { retry.disabled = false; }
}

function updateFollowButton(following) { const button = document.querySelector('#follow-button'); button.dataset.following = String(following); button.innerHTML = following ? 'Ви підписані <span>✓</span>' : 'Підписатися <span>+</span>'; }

async function toggleFollow() {
  const button = document.querySelector('#follow-button');
  if (!client || !session || !profile?.id || isOwner || button.disabled) return;
  button.disabled = true;
  const following = button.dataset.following === 'true';
  try {
    const result = following
      ? await client.from('follows').delete().eq('follower_id', session.user.id).eq('following_id', profile.id)
      : await client.from('follows').insert({ follower_id: session.user.id, following_id: profile.id });
    if (result.error) throw result.error;
  } catch { showNotice('Не вдалося оновити підписку. Спробуйте ще раз.', 'error'); }
  await loadFollowData();
}
