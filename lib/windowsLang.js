"use client";

/**
 * M & P Windows: English / Polish.
 *
 * The choice is kept in this browser (so the page opens in the right
 * language straight away) and saved to the login's account, so it
 * follows the user to another phone or computer.
 */

import { useSyncExternalStore } from "react";
import { EN, PL } from "./windowsText";
import { getDisplayLang, setDisplayLang } from "./windows";

export const LANGS = [
  { id: "en", label: "English", short: "EN" },
  { id: "pl", label: "Polski", short: "PL" },
];

const STORAGE_KEY = "mp_lang";
const DICTS = { en: EN, pl: PL };

let current = "en";
let loadedFromStorage = false;
const listeners = new Set();

function readStorage() {
  if (loadedFromStorage || typeof window === "undefined") return;
  loadedFromStorage = true;
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved && DICTS[saved]) current = saved;
  } catch {
    // Private browsing etc: just use the default.
  }
}

export function getLang() {
  readStorage();
  return current;
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Change the language. Pass the Supabase client to also save it to the
 * account.
 */
export function setLang(lang, supabase) {
  if (!DICTS[lang]) return;
  current = lang;
  loadedFromStorage = true;

  try {
    window.localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // ignore
  }

  listeners.forEach((listener) => listener());

  if (supabase) {
    supabase.auth.updateUser({ data: { mp_lang: lang } }).catch(() => {});
  }
}

/** Use the language saved on the account, if there is one. */
export function syncLangFromUser(user) {
  const saved = user?.user_metadata?.mp_lang;
  if (saved && DICTS[saved] && saved !== getLang()) {
    setLang(saved);
  }
}

/**
 * Looks up a piece of text. Entries are either a string with {name}
 * placeholders, or a function of the values (used for plurals).
 */
export function translate(key, values = {}, lang = getDisplayLang()) {
  const entry = DICTS[lang]?.[key] ?? EN[key];
  if (entry === undefined) return key;
  if (typeof entry === "function") return entry(values);
  return entry.replace(/\{(\w+)\}/g, (_, name) =>
    values[name] === undefined ? `{${name}}` : String(values[name])
  );
}

export function locale(lang = getDisplayLang()) {
  return lang === "pl" ? "pl-PL" : "en-GB";
}

export function useLang() {
  const lang = useSyncExternalStore(subscribe, getLang, () => "en");

  // Dates and job summaries from lib/windows.js follow this render.
  setDisplayLang(lang);

  return {
    lang,
    t: (key, values) => translate(key, values, lang),
    locale: locale(lang),
  };
}