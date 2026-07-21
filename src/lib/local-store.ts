"use client";

import type { RouteOutput } from "@/domain/types";
import { ROUTE_KEYS } from "@/domain/routes";

export type LocalRecord = {
  id: string;
  actionId?: string;
  routeKey: string;
  recordType: string;
  actionTitle: string;
  actualDone: string;
  payload: Record<string, string>;
  userConfirmed: boolean;
  createdAt: string;
};

export type LocalReview = {
  id: string;
  basedOnRecordIds: string[];
  routeKey: string;
  reviewBasis: string[];
  clues: string[];
  missingInfo: string[];
  nextAction: string;
  aiGenerated: boolean;
  userSaved: boolean;
  createdAt: string;
};

export type HomeProgress = {
  progressLabel: string;
  currentAction: CurrentAction | null;
  latestRecord: LocalRecord | null;
  latestReview: LocalReview | null;
  hasUnfinishedAction: boolean;
};

export type CurrentAction = RouteOutput & {
  actionId: string;
  actionCreatedAt: string;
};

const ACTION_KEY = "mvp-current-action";
const DRAFT_PREFIX = "mvp-draft:";
const RECORDS_KEY = "mvp-records";
const REVIEWS_KEY = "mvp-reviews";

export function saveDraft(routeKey: string, value: Record<string, FormDataEntryValue>) {
  window.localStorage.setItem(`${DRAFT_PREFIX}${routeKey}`, JSON.stringify(value));
}

export function mergeDraft(routeKey: string, value: Record<string, string>) {
  saveDraft(routeKey, {
    ...loadDraft(routeKey),
    ...value,
  });
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

export function saveCurrentAction(output: RouteOutput): CurrentAction {
  const saved: CurrentAction = {
    ...output,
    actionId: crypto.randomUUID(),
    actionCreatedAt: new Date().toISOString(),
  };
  window.localStorage.setItem(ACTION_KEY, JSON.stringify(saved));
  return saved;
}

export function loadCurrentAction(): CurrentAction | null {
  const raw = window.localStorage.getItem(ACTION_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    const migrated = migrateCurrentAction(parsed);
    if (!migrated) return null;
    window.localStorage.setItem(ACTION_KEY, JSON.stringify(migrated));
    return migrated;
  } catch {
    return null;
  }
}

export function loadHomeProgress(): HomeProgress {
  const records = loadRecords();
  const currentAction = loadCurrentAction();
  const latestRecord = records[0] ?? null;
  const latestReview = loadLatestReviewForRecord(latestRecord);
  const hasUnfinishedAction =
    !!currentAction &&
    currentAction.outputType !== "friendly_failure" &&
    !records.some((record) => record.actionId === currentAction.actionId);

  return {
    progressLabel: records.length > 0 ? `已保存 ${records.length} 次推进` : "第 1 次推进",
    currentAction,
    latestRecord,
    latestReview,
    hasUnfinishedAction,
  };
}

function isValidRouteOutput(value: unknown): value is RouteOutput {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<CurrentAction>;
  return (
    typeof candidate.routeKey === "string" &&
    ROUTE_KEYS.includes(candidate.routeKey) &&
    (candidate.outputType === "route_result" ||
      candidate.outputType === "missing_info" ||
      candidate.outputType === "friendly_failure") &&
    !!candidate.todayAction &&
    typeof candidate.todayAction.actionTitle === "string" &&
    candidate.todayAction.actionTitle.trim().length > 0
  );
}

function migrateCurrentAction(value: unknown): CurrentAction | null {
  if (!isValidRouteOutput(value)) return null;
  const candidate = value as Partial<CurrentAction> & RouteOutput;
  return {
    ...candidate,
    actionId:
      typeof candidate.actionId === "string" && candidate.actionId.trim()
        ? candidate.actionId
        : crypto.randomUUID(),
    actionCreatedAt:
      typeof candidate.actionCreatedAt === "string" && candidate.actionCreatedAt.trim()
        ? candidate.actionCreatedAt
        : new Date().toISOString(),
  };
}

function loadLatestReviewForRecord(record: LocalRecord | null): LocalReview | null {
  if (!record) return null;
  return loadReviews().find((review) => review.basedOnRecordIds.includes(record.id)) ?? null;
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
    const parsed = JSON.parse(raw) as Array<Partial<LocalRecord>>;
    return parsed.map((record) => ({
      ...record,
      payload: record.payload ?? {},
    })) as LocalRecord[];
  } catch {
    return [];
  }
}

export function deleteRecord(id: string) {
  const records = loadRecords().filter((record) => record.id !== id);
  window.localStorage.setItem(RECORDS_KEY, JSON.stringify(records));
}

export function updateRecord(
  id: string,
  patch: Partial<Pick<LocalRecord, "actualDone" | "payload" | "userConfirmed">>
) {
  const records = loadRecords().map((record) =>
    record.id === id ? { ...record, ...patch } : record
  );
  window.localStorage.setItem(RECORDS_KEY, JSON.stringify(records));
}

export function clearRecords() {
  window.localStorage.removeItem(RECORDS_KEY);
}

export function saveReview(
  review: Omit<LocalReview, "id" | "createdAt" | "aiGenerated" | "userSaved"> &
    Partial<Pick<LocalReview, "aiGenerated" | "userSaved">>
): LocalReview {
  const reviews = loadReviews();
  const saved: LocalReview = {
    ...review,
    aiGenerated: review.aiGenerated ?? true,
    userSaved: review.userSaved ?? false,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  };

  window.localStorage.setItem(REVIEWS_KEY, JSON.stringify([saved, ...reviews]));
  return saved;
}

export function loadReviews(): LocalReview[] {
  const raw = window.localStorage.getItem(REVIEWS_KEY);
  if (!raw) return [];

  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function loadLatestReview(): LocalReview | null {
  return loadReviews()[0] ?? null;
}
