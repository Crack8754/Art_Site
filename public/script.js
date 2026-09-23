const modal = document.querySelector('#modal');
const searchPanel = document.querySelector('#search-panel');
const searchInput = document.querySelector('#search-input');
const authModal = document.querySelector('#auth-modal');
const authMessage = document.querySelector('#auth-message');
const authTitle = document.querySelector('#auth-title');
const authViews = [...document.querySelectorAll('.auth-view')];
const authButton = document.querySelector('[data-auth-open]');

let supabaseClient = null;
let currentSession = null;
let passwordRecoveryActive = false;
let captchaToken = null;
let captchaWidgetId = null;
let captchaReady = false;

if (window.artasAuthConfig?.supabaseUrl && window.artasAuthConfig?.supabaseAnonKey && window.supabase?.createClient) {
  supabaseClient = window.supabase.createClient(
    window.artasAuthConfig.supabaseUrl,
    window.artasAuthConfig.supabaseAnonKey,
    { auth: { flowType: 'pkce', autoRefreshToken: true, persistSession: true, detectSessionInUrl: true } },
  );
  initializeCaptcha();
  initializeAuth();
}

document.querySelectorAll('[data-upload]').forEach((button) => button.addEventListener('click', () => {
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
}));

document.querySelectorAll('.modal-close, .modal-done').forEach((button) => button.addEventListener('click', () => {
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  searchPanel.classList.remove('open');
  searchPanel.setAttribute('aria-hidden', 'true');
}));

document.querySelector('[data-open-search]').addEventListener('click', () => {
  searchPanel.classList.add('open');
  searchPanel.setAttribute('aria-hidden', 'false');
  searchInput.focus();
});

document.querySelectorAll('.filter').forEach((button) => button.addEventListener('click', () => {
  document.querySelector('.filter.active').classList.remove('active');
  button.classList.add('active');
}));

document.querySelectorAll('.save-button').forEach((button) => button.addEventListener('click', () => {
  button.classList.toggle('saved');
  button.textContent = button.classList.contains('saved') ? '♥' : '♡';
}));

document.querySelector('[data-auth-open]').addEventListener('click', () => {
  if (!supabaseClient) {
    openAuth('signin');
    showAuthMessage('Авторизація ще не підключена. Додайте адресу та публічний ключ Supabase у public/auth-config.js.', 'error');
    return;
  }
  openAuth(currentSession ? 'account' : 'signin');
});

document.querySelectorAll('[data-auth-close]').forEach((button) => button.addEventListener('click', closeAuth));
document.querySelectorAll('[data-show-view]').forEach((button) => button.addEventListener('click', () => openAuth(button.dataset.showView)));
document.querySelectorAll('[data-google-signin]').forEach((button) => button.addEventListener('click', signInWithGoogle));
document.querySelector('[data-signout]').addEventListener('click', signOut);
document.querySelectorAll('[data-auth-form]').forEach((form) => form.addEventListener('submit', handleAuthForm));

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    document.querySelectorAll('.open').forEach((item) => item.classList.remove('open'));
    authModal.classList.remove('open');
    authModal.setAttribute('aria-hidden', 'true');
  }
  if (event.key === 'Enter' && document.activeElement === searchInput && searchInput.value.trim()) {
    alert(`Пошук: ${searchInput.value.trim()} — результати скоро з'являться на Artas.`);
  }
});

async function initializeAuth() {
  supabaseClient.auth.onAuthStateChange((event, session) => {
    currentSession = session;
    updateAuthButton(session?.user);
    if (event === 'PASSWORD_RECOVERY') {
      passwordRecoveryActive = true;
      openAuth('update-password');
      showAuthMessage('Посилання підтверджено. Встановіть новий пароль.', 'success');
    }
    if (event === 'SIGNED_OUT') {
      passwordRecoveryActive = false;
      closeAuth();
    }
  });

  const { data, error } = await supabaseClient.auth.getSession();
  if (error) showAuthMessage('Не вдалося перевірити сесію. Оновіть сторінку та спробуйте ще раз.', 'error');
  currentSession = data?.session || null;
  updateAuthButton(currentSession?.user);

  const url = new URL(window.location.href);
  if (url.searchParams.has('error')) {
    openAuth('signin');
    showAuthMessage('Не вдалося завершити вхід. Спробуйте ще раз.', 'error');
    url.searchParams.delete('error');
    url.searchParams.delete('error_code');
    url.searchParams.delete('error_description');
    window.history.replaceState({}, document.title, url);
  }
}

function updateAuthButton(user) {
  if (!authButton) return;
  authButton.dataset.signedIn = user ? 'true' : 'false';
  authButton.textContent = user ? (user.user_metadata?.display_name || user.user_metadata?.full_name || user.user_metadata?.name || user.email || 'Мій акаунт') : 'Увійти';
  authButton.setAttribute('aria-label', user ? 'Відкрити мій акаунт' : 'Увійти');
  const email = document.querySelector('[data-account-email]');
  if (email) email.textContent = user?.email || '';
}

function openAuth(view) {
  authModal.classList.add('open');
  authModal.setAttribute('aria-hidden', 'false');
  authViews.forEach((section) => { section.hidden = section.dataset.view !== view; });
  authTitle.innerHTML = view === 'signup' ? 'Створіть свій <em>простір.</em>'
    : view === 'forgot' ? 'Відновимо <em>доступ.</em>'
      : view === 'update-password' ? 'Новий <em>пароль.</em>'
        : view === 'account' ? 'Ваш <em>Artas.</em>' : 'Раді вас <em>бачити.</em>';
  clearAuthMessage();
  if (window.artasAuthConfig?.captcha) renderCaptcha();
  if (view !== 'update-password') passwordRecoveryActive = false;
  const firstInput = authModal.querySelector(`[data-view="${view}"] input`);
  if (firstInput) setTimeout(() => firstInput.focus(), 0);
}

function closeAuth() {
  authModal.classList.remove('open');
  authModal.setAttribute('aria-hidden', 'true');
  clearAuthMessage();
}

function showAuthMessage(message, kind = 'error') {
  authMessage.textContent = message;
  authMessage.dataset.kind = kind;
  authMessage.hidden = false;
}

function clearAuthMessage() {
  authMessage.textContent = '';
  authMessage.hidden = true;
  delete authMessage.dataset.kind;
}

function setBusy(form, busy) {
  form.querySelectorAll('button').forEach((button) => { button.disabled = busy; });
}

async function handleAuthForm(event) {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  if (!supabaseClient) {
    showAuthMessage('Авторизація ще не підключена. Налаштуйте public/auth-config.js.', 'error');
    return;
  }

  const values = Object.fromEntries(new FormData(form).entries());
  const action = form.dataset.authForm;
  const email = values.email?.trim().toLowerCase();
  if (window.artasAuthConfig?.captcha && !captchaToken) {
    showAuthMessage('Підтвердіть, що ви не робот, і повторіть спробу.', 'error');
    return;
  }
  if ((action === 'signup' || action === 'update-password') && values.password !== values.passwordConfirm) {
    showAuthMessage('Паролі не збігаються. Перевірте обидва поля.', 'error');
    form.elements.passwordConfirm.focus();
    return;
  }

  setBusy(form, true);
  clearAuthMessage();
  try {
    if (action === 'signin') {
      const credentials = { email, password: values.password };
      if (captchaToken) credentials.options = { captchaToken };
      const { error } = await supabaseClient.auth.signInWithPassword(credentials);
      if (error) showAuthMessage('Невірний email або пароль. Перевірте дані та спробуйте ще раз.', 'error');
      else closeAuth();
    } else if (action === 'signup') {
      const { error } = await supabaseClient.auth.signUp({
        email,
        password: values.password,
        options: {
          emailRedirectTo: window.location.origin + window.location.pathname,
          data: { display_name: values.displayName.trim() },
          captchaToken: captchaToken || undefined,
        },
      });
      if (error) showAuthMessage('Не вдалося надіслати лист. Перевірте адресу та спробуйте пізніше.', 'error');
      else showAuthMessage('Якщо ця адреса підходить для реєстрації, на неї надіслано лист із посиланням для підтвердження.', 'success');
    } else if (action === 'forgot') {
      const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + window.location.pathname,
        captchaToken: captchaToken || undefined,
      });
      if (error) showAuthMessage('Не вдалося надіслати лист. Спробуйте пізніше.', 'error');
      else showAuthMessage('Якщо для цієї адреси є акаунт, ми надіслали інструкції з відновлення пароля.', 'success');
    } else if (action === 'update-password') {
      if (!passwordRecoveryActive && !currentSession) {
        showAuthMessage('Посилання для зміни пароля недійсне або застаріло. Запросіть нове.', 'error');
        return;
      }
      const { error } = await supabaseClient.auth.updateUser({ password: values.password });
      if (error) showAuthMessage('Не вдалося оновити пароль. Перевірте його вимоги та спробуйте ще раз.', 'error');
      else {
        passwordRecoveryActive = false;
        showAuthMessage('Пароль оновлено. Тепер ви можете увійти з новим паролем.', 'success');
        openAuth('signin');
        showAuthMessage('Пароль оновлено. Тепер ви можете увійти з новим паролем.', 'success');
      }
    }
  } catch {
    showAuthMessage(action === 'signin' ? 'Невірний email або пароль. Перевірте дані та спробуйте ще раз.' : 'Не вдалося виконати запит. Перевірте з’єднання та спробуйте пізніше.', 'error');
  } finally {
    setBusy(form, false);
    resetCaptcha();
  }
}

function initializeCaptcha() {
  const config = window.artasAuthConfig?.captcha;
  if (!config?.provider || !config?.siteKey) return;
  const slot = document.querySelector('#captcha-slot');
  slot.hidden = false;
  const script = document.createElement('script');
  script.async = true;
  script.defer = true;
  script.src = config.provider === 'turnstile'
    ? 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    : 'https://js.hcaptcha.com/1/api.js?render=explicit';
  script.onload = () => { captchaReady = true; renderCaptcha(); };
  script.onerror = () => showAuthMessage('Не вдалося завантажити перевірку безпеки. Оновіть сторінку та спробуйте ще раз.', 'error');
  document.head.append(script);
}

function renderCaptcha() {
  const config = window.artasAuthConfig?.captcha;
  const slot = document.querySelector('#captcha-slot');
  if (!config?.siteKey || !captchaReady || captchaWidgetId !== null || !slot || !authModal.classList.contains('open')) return;
  const onVerify = (token) => { captchaToken = token; clearAuthMessage(); };
  const callbacks = {
    sitekey: config.siteKey,
    callback: onVerify,
    'expired-callback': () => { captchaToken = null; },
    'error-callback': () => { captchaToken = null; showAuthMessage('Перевірка безпеки не пройшла. Спробуйте ще раз.', 'error'); },
  };
  captchaWidgetId = config.provider === 'turnstile'
    ? window.turnstile?.render(slot, callbacks) ?? null
    : window.hcaptcha?.render(slot, callbacks) ?? null;
}

function resetCaptcha() {
  if (!window.artasAuthConfig?.captcha) return;
  captchaToken = null;
  const config = window.artasAuthConfig.captcha;
  if (captchaWidgetId === null) return;
  if (config.provider === 'turnstile') window.turnstile?.reset(captchaWidgetId);
  else window.hcaptcha?.reset(captchaWidgetId);
}

async function signInWithGoogle(event) {
  if (!supabaseClient) {
    showAuthMessage('Авторизація ще не підключена. Налаштуйте public/auth-config.js.', 'error');
    return;
  }
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const { error } = await supabaseClient.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin + window.location.pathname },
    });
    if (error) throw error;
  } catch {
    showAuthMessage('Не вдалося розпочати вхід через Google. Перевірте налаштування OAuth і спробуйте ще раз.', 'error');
    button.disabled = false;
  }
}

async function signOut() {
  const button = document.querySelector('[data-signout]');
  button.disabled = true;
  try {
    const { error } = await supabaseClient.auth.signOut();
    if (error) showAuthMessage('Не вдалося завершити сеанс. Спробуйте ще раз.', 'error');
  } catch {
    showAuthMessage('Не вдалося завершити сеанс. Перевірте з’єднання та спробуйте ще раз.', 'error');
  } finally {
    button.disabled = false;
  }
}
