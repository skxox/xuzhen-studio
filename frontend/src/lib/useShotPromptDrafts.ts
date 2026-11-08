import { useEffect, useState } from 'react';

type PromptDrafts = Record<string, string>;

function readDrafts(storageKey: string): PromptDrafts {
  try {
    const value = window.sessionStorage.getItem(storageKey);
    if (!value) return {};
    const parsed: unknown = JSON.parse(value);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] => {
        return typeof entry[1] === 'string';
      }),
    );
  } catch {
    return {};
  }
}

export function useShotPromptDrafts(stageKey: string) {
  const storageKey = `xuzhen:shot-prompt-drafts:v1:${stageKey}`;
  const [drafts, setDrafts] = useState<PromptDrafts>(() => readDrafts(storageKey));

  useEffect(() => {
    try {
      if (Object.keys(drafts).length === 0) {
        window.sessionStorage.removeItem(storageKey);
      } else {
        window.sessionStorage.setItem(storageKey, JSON.stringify(drafts));
      }
    } catch {
      // Keep editing available when browser storage is unavailable or full.
    }
  }, [drafts, storageKey]);

  return [drafts, setDrafts] as const;
}
