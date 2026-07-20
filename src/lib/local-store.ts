"use client";

import type { RouteOutput } from "@/domain/types";

export type LocalRecord = {
  id: string;
  routeKey: string;
  recordType: string;
  actionTitle: string;
  actualDone: string;
  userConfirmed: boolean;
  createdAt: string;
};

const ACTION_KEY = "mvp-current-action";
const DRAFT_PREFIX = "mvp-draft:";
const RECORDS_KEY = "mvp-records";

export function saveDraft(routeKey: string, value: Record<string, FormDataEntryValue>) {
  window.localStorage.setItem(`${DRAFT_PREFIX}${routeKey}`, JSON.stringify(value));
}

export function loadDraft(routeKey: string): Record<string, string> {
  const raw = window.localStorage.getItem(`${DRAFT_PREFIX}${routeKey}`);
  if (!raw) return {};

  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function saveCurrentAction(output: RouteOutput) {
  window.localStorage.setItem(ACTION_KEY, JSON.stringify(output));
}

export function loadCurrentAction(): RouteOutput | null {
  const raw = window.localStorage.getItem(ACTION_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function saveRecord(record: Omit<LocalRecord, "id" | "createdAt">): LocalRecord {
  const records = loadRecords();
  const saved: LocalRecord = {
    ...record,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  };

  window.localStorage.setItem(RECORDS_KEY, JSON.stringify([saved, ...records]));
  return saved;
}

export function loadRecords(): LocalRecord[] {
  const raw = window.localStorage.getItem(RECORDS_KEY);
  if (!raw) return [];

  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function deleteRecord(id: string) {
  const records = loadRecords().filter((record) => record.id !== id);
  window.localStorage.setItem(RECORDS_KEY, JSON.stringify(records));
}

export function updateRecord(id: string, patch: Partial<Pick<LocalRecord, "actualDone" | "userConfirmed">>) {
  const records = loadRecords().map((record) =>
    record.id === id ? { ...record, ...patch } : record
  );
  window.localStorage.setItem(RECORDS_KEY, JSON.stringify(records));
}

export function clearRecords() {
  window.localStorage.removeItem(RECORDS_KEY);
}
