import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Language, Translations, translations } from "./index";

interface I18nContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextType | undefined>(undefined);

const STORAGE_KEY = "deepseek-harness-desktop-language";

const getTranslation = (
  obj: Translations,
  keyPath: string,
  params?: Record<string, string | number>,
): string => {
  const keys = keyPath.split(".");
  let value: unknown = obj;

  for (const key of keys) {
    if (value && typeof value === "object" && key in value) {
      value = (value as Record<string, unknown>)[key];
    } else {
      return keyPath;
    }
  }

  if (typeof value !== "string") {
    return keyPath;
  }

  if (params) {
    return value.replace(/\{\{(\w+)\}\}/g, (match, paramName: string) => {
      return params[paramName]?.toString() ?? match;
    });
  }
  return value;
};

export const I18nProvider: React.FC<{ children: ReactNode; defaultLanguage?: Language }> = ({
  children,
  defaultLanguage = "en",
}) => {
  const getInitialLanguage = (): Language => {
    const saved = localStorage.getItem(STORAGE_KEY) as Language | null;
    if (saved === "en" || saved === "zh") {
      return saved;
    }
    const browserLang = navigator.language.toLowerCase();
    return browserLang.startsWith("zh") ? "zh" : defaultLanguage;
  };

  const [language, setLanguageState] = useState<Language>(getInitialLanguage);

  const setLanguage = (lang: Language) => {
    setLanguageState(lang);
    localStorage.setItem(STORAGE_KEY, lang);
    invoke("set_language", { lang }).catch(() => {
      // Backend language is best-effort only.
    });
  };

  const t = (key: string, params?: Record<string, string | number>): string =>
    getTranslation(translations[language], key, params);

  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = "ltr";
  }, [language]);

  return (
    <I18nContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </I18nContext.Provider>
  );
};

export const useI18n = (): I18nContextType => {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used within an I18nProvider");
  }
  return context;
};
