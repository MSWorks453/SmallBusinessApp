/**
 * src/i18n/index.js
 * Internationalization context provider.
 *
 * Usage in any component:
 *   import { useI18n } from '../i18n';
 *   const { t, lang, setLang } = useI18n();
 *   <Text>{t('dashboard.greeting')}</Text>
 *
 * Supports nested keys: t('login.title')
 * Supports template vars: t('employees.removeConfirm', { name: 'Alice' })
 */

import React, { createContext, useContext, useState, useCallback } from 'react';
import en from './en';
import te from './te';

const translations = { en, te };
const LANGUAGES = [
  { code: 'en', label: 'English', nativeLabel: 'English' },
  { code: 'te', label: 'Telugu', nativeLabel: 'తెలుగు' },
];

const I18nContext = createContext(null);

/**
 * Resolve a dot-notated key from a nested object.
 * e.g. getNestedValue(obj, 'login.title') → obj.login.title
 */
function getNestedValue(obj, key) {
  return key.split('.').reduce((acc, part) => {
    if (acc === undefined || acc === null) return undefined;
    return acc[part];
  }, obj);
}

/**
 * Replace {varName} placeholders in a string with values from `vars` object.
 */
function interpolate(str, vars) {
  if (!vars || typeof str !== 'string') return str;
  return str.replace(/\{(\w+)\}/g, (match, key) => {
    return vars[key] !== undefined ? vars[key] : match;
  });
}

export function I18nProvider({ children }) {
  const [lang, setLang] = useState('en');

  /**
   * Translation function.
   * @param {string} key — dot-notated path, e.g. 'login.title'
   * @param {object} [vars] — optional interpolation variables
   * @returns {string}
   */
  const t = useCallback(
    (key, vars) => {
      const dict = translations[lang] || translations.en;
      let value = getNestedValue(dict, key);
      // Fallback to English if key missing in current language
      if (value === undefined) {
        value = getNestedValue(translations.en, key);
      }
      // If still not found, return the key itself as fallback
      if (value === undefined) return key;
      // Interpolate variables if provided
      if (vars && typeof value === 'string') {
        return interpolate(value, vars);
      }
      return value;
    },
    [lang]
  );

  const value = { t, lang, setLang, LANGUAGES };

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>');
  return ctx;
}

export { LANGUAGES };
export default { I18nProvider, useI18n, LANGUAGES };
