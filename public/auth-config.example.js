// Copy this file to auth-config.js and fill in values from Supabase project settings.
// The publishable/anon key is intended for browser use. Never put a service_role key here.
window.artasAuthConfig = {
  supabaseUrl: 'https://YOUR_PROJECT_REF.supabase.co',
  supabaseAnonKey: 'YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY',
  // Optional. Configure the matching provider and secret in Supabase Auth first.
  // captcha: { provider: 'turnstile', siteKey: 'YOUR_TURNSTILE_SITE_KEY' },
};
