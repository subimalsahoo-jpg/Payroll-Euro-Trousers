'use strict';

/**
 * Frontend i18n (Module 15).
 * Loads the locale dictionary from /api/i18n/:locale, applies labels,
 * toggles document direction (LTR/RTL) and persists the choice.
 */
window.I18N = (function () {
  const LOCALE_KEY = 'dm.locale';
  let dict = {};
  let locale = localStorage.getItem(LOCALE_KEY) || 'en';

  async function load(next) {
    locale = next || locale;
    localStorage.setItem(LOCALE_KEY, locale);
    try {
      const res = await API.get(`/i18n/${locale}`);
      dict = res.data || {};
    } catch (_e) {
      dict = {};
    }
    applyDirection();
    return dict;
  }

  function applyDirection() {
    const dir = dict.direction || (locale === 'ar' ? 'rtl' : 'ltr');
    document.documentElement.setAttribute('dir', dir);
    document.documentElement.setAttribute('lang', locale);
  }

  const t = (key) => dict[key] || key;
  const current = () => locale;

  return { load, t, current, applyDirection };
})();
