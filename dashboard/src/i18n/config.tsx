import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import en from './locales/en.json';
import es from './locales/es.json';
import pt from './locales/pt.json';
import fr from './locales/fr.json';
import ar from './locales/ar.json';
import he from './locales/he.json';

export type Language = 'en' | 'es' | 'pt' | 'fr' | 'ar' | 'he';
export type Direction = 'ltr' | 'rtl';
export type TranslateParams = Record<string, string | number>;

export const RTL_LANGUAGES: Language[] = ['ar', 'he'];

export const isRtlLanguage = (lang: Language): boolean => RTL_LANGUAGES.includes(lang);

export type TranslationContextValue = {
  t: (key: string, params?: TranslateParams) => string;
  language: Language;
  changeLanguage: (language: Language) => void;
  direction: Direction;
  isRtl: boolean;
};

const resources: Record<Language, Record<string, unknown>> = {
  en,
  es,
  pt,
  fr,
  ar,
  he,
};

const getValue = (dictionary: Record<string, unknown>, key: string): string | undefined => {
  const parts = key.split('.');
  let current: unknown = dictionary;

  for (const part of parts) {
    if (current && typeof current === 'object' && part in (current as Record<string, unknown>)) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }

  return typeof current === 'string' ? current : undefined;
};

const interpolate = (template: string, params?: TranslateParams): string => {
  if (!params) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
};

const detectBrowserLanguage = (fallback: Language): Language => {
  try {
    const tag = typeof navigator !== 'undefined' ? navigator.language ?? '' : '';
    const base = tag.split('-')[0].toLowerCase();
    if (base === 'en' || base === 'es' || base === 'pt' || base === 'fr' || base === 'ar' || base === 'he') {
      return base;
    }
  } catch {
    // Navigator unavailable (SSR) — fall through to the default.
  }
  return fallback;
};

const TranslationContext = createContext<TranslationContextValue>({
  t: (key: string) => key,
  language: 'en',
  changeLanguage: () => undefined,
  direction: 'ltr',
  isRtl: false,
});

export const I18nProvider = ({
  children,
  initialLanguage = 'en',
}: {
  children: ReactNode;
  initialLanguage?: Language;
}) => {
  // An explicitly provided initialLanguage always wins; otherwise the
  // browser locale picks the first-visit default (en/es/pt/fr/ar/he).
  const [language, setLanguage] = useState<Language>(() =>
    initialLanguage !== 'en' ? initialLanguage : detectBrowserLanguage(initialLanguage),
  );

  const isRtl = isRtlLanguage(language);
  const direction: Direction = isRtl ? 'rtl' : 'ltr';

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.dir = direction;
      document.documentElement.lang = language;
      document.documentElement.setAttribute('data-direction', direction);
    }
  }, [direction, language]);

  const value = useMemo<TranslationContextValue>(() => ({
    t: (key: string, params?: TranslateParams) => {
      const activeDict = resources[language] as Record<string, unknown>;
      const fallbackDict = resources.en as Record<string, unknown>;
      const rawText = getValue(activeDict, key) ?? getValue(fallbackDict, key) ?? key;
      return interpolate(rawText, params);
    },
    language,
    changeLanguage: (nextLanguage: Language) => setLanguage(nextLanguage),
    direction,
    isRtl,
  }), [language, direction, isRtl]);

  return <TranslationContext.Provider value={value}>{children}</TranslationContext.Provider>;
};

export const useTranslation = () => useContext(TranslationContext);

export default TranslationContext;
