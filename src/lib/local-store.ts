"use client";

import type { ActionType, RecordType, RouteKey, RouteOutput } from "@/domain/types";
import { ROUTE_KEYS } from "@/domain/routes";
import {
  isApplicationRecordComplete,
  isResumeSnippetGrounded,
} from "@/domain/record-rules";
import type { OutputProvenance } from "@/domain/provenance";
import { routeOutputWithProvenanceSchema } from "@/schemas/route-output";
import type { RequestMetadata } from "@/schemas/route-request";

export type LocalRecord = {
  id: string;
  actionId?: string;
  routeKey: RouteKey;
  recordType: string;
  actionTitle: string;
  actualDone: string;
  payload: Record<string, string>;
  userConfirmed: boolean;
  status: "draft" | "confirmed";
  version: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string;
  confirmedAt?: string;
  supersedesRecordId?: string;
  sourceState?: "current" | "stale" | "deleted_source";
};

export type ResumeSnippetVersion = LocalRecord & {
  recordType: "resume_snippet";
  confirmedAt?: string;
  sourceState: "current" | "stale" | "deleted_source";
};

export type LocalReview = {
  id: string;
  basedOnRecordIds: string[];
  basedOnRecordVersions: Record<string, number>;
  routeKey: RouteKey;
  reviewKind: "instant" | "weekly";
  status: "draft" | "saved" | "stale" | "deleted_source";
  reviewBasis: string[];
  actionTitles?: string[];
  recordTypeCounts?: Record<string, number>;
  clues: string[];
  missingInfo: string[];
  nextAction: string;
  nextActionType?: ActionType;
  nextRecordType?: RecordType;
  nextFieldsToRecord?: string[];
  provenance?: OutputProvenance;
  aiGenerated: boolean;
  userSaved: boolean;
  retainedAfterSourceDeletion?: boolean;
  windowStartedAt?: string;
  windowEndedAt?: string;
  createdAt: string;
};

export type JourneyState = {
  journeyStartedAt: string;
  dayIndex: number;
  phase: 1 | 2 | 3;
  progressCount: number;
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
  clientRequestId?: string;
  draftRevision?: number;
  idempotencyKey?: string;
  reducedContinuation?: true;
};

const ACTION_KEY = "mvp-current-action";
const DRAFT_PREFIX = "mvp-draft:";
const RECORDS_KEY = "mvp-records";
const REVIEWS_KEY = "mvp-reviews";
const JOURNEY_KEY = "mvp-journey";

export function runLocalStoreTransaction<T>(operation: () => T): T {
  const keys = [
    ACTION_KEY,
    RECORDS_KEY,
    REVIEWS_KEY,
    JOURNEY_KEY,
    ...ROUTE_KEYS.map((routeKey) => `${DRAFT_PREFIX}${routeKey}`),
  ];
  const snapshot = new Map(
    keys.map((key) => [key, window.localStorage.getItem(key)] as const),
  );
  try {
    return operation();
  } catch (error) {
    for (const [key, previousValue] of snapshot) {
      try {
        if (previousValue === null) {
          window.localStorage.removeItem(key);
        } else {
          window.localStorage.setItem(key, previousValue);
        }
      } catch {
        // Best-effort rollback: preserve and rethrow the original write error.
      }
    }
    throw error;
  }
}

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

export function saveCurrentAction(
  output: RouteOutput,
  requestMetadata?: RequestMetadata,
): CurrentAction {
  return runLocalStoreTransaction(() => {
    if (requestMetadata) {
      const existing = loadCurrentAction();
      if (existing?.idempotencyKey === requestMetadata.idempotencyKey) return existing;
    }
    ensureJourneyStarted();
    const validated = parseRouteOutput(output);
    if (!validated) {
      throw new Error("Invalid route output");
    }
    const previous = output as Partial<CurrentAction>;
    const saved: CurrentAction = {
      ...validated,
      actionId:
        typeof previous.actionId === "string" && previous.actionId.trim()
          ? previous.actionId
          : crypto.randomUUID(),
      actionCreatedAt:
        typeof previous.actionCreatedAt === "string" && previous.actionCreatedAt.trim()
          ? previous.actionCreatedAt
          : new Date().toISOString(),
      ...(requestMetadata ?? {}),
    };
    window.localStorage.setItem(ACTION_KEY, JSON.stringify(saved));
    return saved;
  });
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
  const formalRecords = records.filter(isFormalProgressRecord);
  const currentAction = loadCurrentAction();
  const latestRecord = formalRecords[0] ?? null;
  const latestReview = loadLatestReviewForRecord(latestRecord);
  const journey = loadJourneyState();
  const hasUnfinishedAction =
    !!currentAction &&
    currentAction.outputType !== "friendly_failure" &&
    !formalRecords.some((record) => record.actionId === currentAction.actionId);

  return {
    progressLabel: `第 ${journey.dayIndex} 天`,
    currentAction,
    latestRecord,
    latestReview,
    hasUnfinishedAction,
  };
}

function isFormalProgressRecord(record: LocalRecord): boolean {
  return (
    record.userConfirmed &&
    record.status === "confirmed" &&
    (record.sourceState === undefined || record.sourceState === "current")
  );
}

function migrateCurrentAction(value: unknown): CurrentAction | null {
  const validated = parseRouteOutput(value);
  if (!validated || !value || typeof value !== "object") return null;
  const candidate = value as Partial<CurrentAction>;
  return {
    ...validated,
    actionId:
      typeof candidate.actionId === "string" && candidate.actionId.trim()
        ? candidate.actionId
        : crypto.randomUUID(),
    actionCreatedAt:
      typeof candidate.actionCreatedAt === "string" && candidate.actionCreatedAt.trim()
        ? candidate.actionCreatedAt
        : new Date().toISOString(),
    ...(typeof candidate.clientRequestId === "string"
      ? { clientRequestId: candidate.clientRequestId }
      : {}),
    ...(typeof candidate.draftRevision === "number"
      ? { draftRevision: candidate.draftRevision }
      : {}),
    ...(typeof candidate.idempotencyKey === "string"
      ? { idempotencyKey: candidate.idempotencyKey }
      : {}),
  };
}

function parseRouteOutput(value: unknown): RouteOutput | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<CurrentAction> & {
    todayAction?: Record<string, unknown>;
  };
  const {
    actionId: _actionId,
    actionCreatedAt: _actionCreatedAt,
    clientRequestId: _clientRequestId,
    draftRevision: _draftRevision,
    idempotencyKey: _idempotencyKey,
    reducedContinuation,
    ...output
  } = candidate;
  void _actionId;
  void _actionCreatedAt;
  void _clientRequestId;
  void _draftRevision;
  void _idempotencyKey;
  const parsed = routeOutputWithProvenanceSchema.safeParse({
    ...output,
  });
  if (!parsed.success) return null;
  return {
    ...parsed.data,
    ...(reducedContinuation === true ? { reducedContinuation: true } : {}),
  } as RouteOutput;
}

function loadLatestReviewForRecord(record: LocalRecord | null): LocalReview | null {
  if (!record) return null;
  return loadReviews().find(
    (review) =>
      review.userSaved &&
      review.status === "saved" &&
      review.basedOnRecordIds.includes(record.id) &&
      review.basedOnRecordVersions[record.id] === record.version,
  ) ?? null;
}

export function saveRecord(
  record: Omit<
    LocalRecord,
    "id" | "createdAt" | "updatedAt" | "completedAt" | "status" | "version"
  >,
): LocalRecord {
  ensureJourneyStarted();
  const records = loadRecords();
  const now = new Date().toISOString();
  const providedActualDone = record.actualDone.trim();
  const fillInfoCount =
    record.recordType === "fill_info"
      ? Object.values(record.payload).filter((value) => value.trim()).length
      : 0;
  const actualDone =
    providedActualDone ||
    (record.recordType === "fill_info" && fillInfoCount > 0
      ? `补充了 ${fillInfoCount} 项信息。`
      : "");
  if (record.userConfirmed && !actualDone) {
    throw new Error("Confirmed progress record requires actualDone");
  }
  const saved: LocalRecord = {
    ...record,
    actualDone,
    id: crypto.randomUUID(),
    status: record.userConfirmed ? "confirmed" : "draft",
    version: 1,
    createdAt: now,
    updatedAt: now,
    completedAt: now,
    ...(record.recordType === "resume_snippet"
      ? {
          confirmedAt: record.userConfirmed ? now : undefined,
          sourceState: "current" as const,
        }
      : {}),
  };

  window.localStorage.setItem(RECORDS_KEY, JSON.stringify([saved, ...records]));
  return saved;
}

export function loadRecords(): LocalRecord[] {
  const raw = window.localStorage.getItem(RECORDS_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as Array<Partial<LocalRecord>>;
    return parsed.map((record) => {
      const createdAt =
        typeof record.createdAt === "string" && record.createdAt
          ? record.createdAt
          : new Date().toISOString();
      return {
        ...record,
        payload: record.payload ?? {},
        status: record.status ?? (record.userConfirmed ? "confirmed" : "draft"),
        version: typeof record.version === "number" && record.version > 0 ? record.version : 1,
        createdAt,
        updatedAt: record.updatedAt ?? createdAt,
        completedAt: record.completedAt ?? createdAt,
        ...(record.recordType === "resume_snippet"
          ? {
              confirmedAt:
                record.confirmedAt ??
                (record.userConfirmed ? record.updatedAt ?? createdAt : undefined),
              sourceState: record.sourceState ?? "current",
            }
          : {}),
      };
    }) as LocalRecord[];
  } catch {
    return [];
  }
}

export function deleteRecord(
  id: string,
  options: { reviewPolicy?: "cascade" | "retain" } = {},
) {
  const reviewPolicy = options.reviewPolicy ?? "cascade";
  const currentRecords = loadRecords();
  const dependentSnippetIds = new Set(
    currentRecords
      .filter(
        (record) =>
          record.recordType === "resume_snippet" &&
          record.payload.sourceExperienceId === id,
      )
      .map((record) => record.id),
  );
  const records = currentRecords
    .filter(
      (record) =>
        record.id !== id &&
        (reviewPolicy === "retain" || !dependentSnippetIds.has(record.id)),
    )
    .map((record) =>
      reviewPolicy === "retain" && dependentSnippetIds.has(record.id)
        ? { ...record, sourceState: "deleted_source" as const }
        : record,
    );
  window.localStorage.setItem(RECORDS_KEY, JSON.stringify(records));
  const reviews = loadReviews();
  const affectedRecordIds = new Set([id, ...dependentSnippetIds]);
  const nextReviews =
    reviewPolicy === "cascade"
      ? reviews.filter(
          (review) =>
            !review.basedOnRecordIds.some((recordId) => affectedRecordIds.has(recordId)),
        )
      : reviews.map((review) =>
          review.basedOnRecordIds.some((recordId) => affectedRecordIds.has(recordId))
            ? {
                ...review,
                status: "deleted_source" as const,
                retainedAfterSourceDeletion: true,
              }
            : review,
        );
  window.localStorage.setItem(REVIEWS_KEY, JSON.stringify(nextReviews));
}

export function updateRecord(
  id: string,
  patch: Partial<Pick<LocalRecord, "actualDone" | "payload" | "userConfirmed">>
) {
  const now = new Date().toISOString();
  const currentRecords = loadRecords();
  const target = currentRecords.find((record) => record.id === id);
  if (!target) return null;
  const remainsConfirmed = patch.userConfirmed ?? target.userConfirmed;
  if (
    target.recordType === "application" &&
    remainsConfirmed &&
    !isApplicationRecordComplete(patch.payload ?? target.payload)
  ) {
    return null;
  }

  if (target.recordType === "resume_snippet" && target.userConfirmed) {
    const sourceExperienceId = target.payload.sourceExperienceId;
    const sourceExperience = currentRecords.find(
      (record) =>
        record.id === sourceExperienceId &&
        record.recordType === "experience_fact",
    );
    const revisedPayload: Record<string, string> = {
      ...(patch.payload ?? target.payload),
      sourceExperienceId,
    };
    if (
      remainsConfirmed &&
      (!sourceExperience ||
        target.sourceState !== "current" ||
        !isResumeSnippetGrounded({
          resumeSnippet: revisedPayload.resumeSnippet ?? "",
          confirmedFacts: [
            sourceExperience.payload.confirmedFacts,
            sourceExperience.payload.actualActions,
            sourceExperience.payload.deliverable,
          ].filter(Boolean).join("；"),
          supportingFacts: [
            sourceExperience.payload.supportingFacts,
          ].filter(Boolean).join("；"),
        }))
    ) {
      return null;
    }
    const nextVersion = Math.max(
      target.version,
      ...currentRecords
        .filter(
          (record) =>
            record.recordType === "resume_snippet" &&
            record.payload.sourceExperienceId === sourceExperienceId,
        )
        .map((record) => record.version),
    ) + 1;
    const revised: LocalRecord = {
      ...target,
      ...patch,
      payload: revisedPayload,
      id: crypto.randomUUID(),
      status: remainsConfirmed ? "confirmed" : "draft",
      version: nextVersion,
      createdAt: now,
      updatedAt: now,
      completedAt: now,
      confirmedAt: remainsConfirmed ? now : undefined,
      supersedesRecordId: target.id,
      sourceState: target.sourceState ?? "current",
    };
    window.localStorage.setItem(RECORDS_KEY, JSON.stringify([revised, ...currentRecords]));
    invalidateReviewsForRecordIds(new Set([id]));
    return revised;
  }

  const dependentSnippetIds = new Set<string>();
  const records = currentRecords.map((record) => {
    if (record.id === id) {
      return {
        ...record,
        ...patch,
        status: (patch.userConfirmed ?? record.userConfirmed) ? "confirmed" as const : "draft" as const,
        version: record.version + 1,
        updatedAt: now,
      };
    }
    if (
      target.recordType === "experience_fact" &&
      record.recordType === "resume_snippet" &&
      record.payload.sourceExperienceId === id
    ) {
      dependentSnippetIds.add(record.id);
      return { ...record, sourceState: "stale" as const };
    }
    return record;
  });
  window.localStorage.setItem(RECORDS_KEY, JSON.stringify(records));
  invalidateReviewsForRecordIds(new Set([id, ...dependentSnippetIds]));
  return records.find((record) => record.id === id) ?? null;
}

export function loadConfirmedResumeSnippets(): ResumeSnippetVersion[] {
  return loadRecords().filter(
    (record): record is ResumeSnippetVersion =>
      record.recordType === "resume_snippet" &&
      record.userConfirmed &&
      record.status === "confirmed" &&
      record.sourceState === "current",
  );
}

export function getConfirmedResumeSnippetTextForCopy(id: string): string | null {
  const version = loadConfirmedResumeSnippets().find((record) => record.id === id);
  if (!version) return null;
  const source = loadRecords().find(
    (record) =>
      record.id === version.payload.sourceExperienceId &&
      record.recordType === "experience_fact" &&
      record.userConfirmed &&
      record.status === "confirmed",
  );
  if (
    !source ||
    !isResumeSnippetGrounded({
      resumeSnippet: version.payload.resumeSnippet ?? "",
      confirmedFacts: [
        source.payload.confirmedFacts,
        source.payload.actualActions,
        source.payload.deliverable,
      ].filter(Boolean).join("；"),
      supportingFacts: source.payload.supportingFacts,
    })
  ) {
    return null;
  }
  const text = version?.payload.resumeSnippet?.trim();
  return text || null;
}

export function clearRecords() {
  window.localStorage.removeItem(RECORDS_KEY);
  window.localStorage.removeItem(REVIEWS_KEY);
}

export function clearAllLocalData() {
  window.localStorage.removeItem(ACTION_KEY);
  window.localStorage.removeItem(RECORDS_KEY);
  window.localStorage.removeItem(REVIEWS_KEY);
  window.localStorage.removeItem(JOURNEY_KEY);
  for (const routeKey of ROUTE_KEYS) {
    window.localStorage.removeItem(`${DRAFT_PREFIX}${routeKey}`);
  }
}

export function saveReview(
  review: Omit<
    LocalReview,
    | "id"
    | "createdAt"
    | "aiGenerated"
    | "userSaved"
    | "basedOnRecordVersions"
    | "reviewKind"
    | "status"
  > &
    Partial<
      Pick<
        LocalReview,
        "aiGenerated" | "userSaved" | "basedOnRecordVersions" | "reviewKind" | "status"
      >
    >
): LocalReview {
  const reviews = loadReviews();
  const recordsById = new Map(loadRecords().map((record) => [record.id, record]));
  const userSaved = review.userSaved ?? false;
  const saved: LocalReview = {
    ...review,
    basedOnRecordVersions:
      review.basedOnRecordVersions ??
      Object.fromEntries(
        review.basedOnRecordIds.flatMap((id) => {
          const record = recordsById.get(id);
          return record ? [[id, record.version]] : [];
        }),
      ),
    reviewKind: review.reviewKind ?? "instant",
    aiGenerated: review.aiGenerated ?? true,
    userSaved,
    status: review.status ?? (userSaved ? "saved" : "draft"),
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
    const parsed = JSON.parse(raw) as Array<Partial<LocalReview>>;
    return parsed.map((review) => ({
      ...review,
      basedOnRecordIds: review.basedOnRecordIds ?? [],
      basedOnRecordVersions: review.basedOnRecordVersions ?? {},
      reviewKind: review.reviewKind ?? "instant",
      status: review.status ?? (review.userSaved ? "saved" : "draft"),
    })) as LocalReview[];
  } catch {
    return [];
  }
}

export function loadLatestReview(): LocalReview | null {
  return loadReviews().find(
    (review) => review.status !== "stale" && review.status !== "deleted_source",
  ) ?? null;
}

export function markReviewSaved(id: string): LocalReview | null {
  let savedReview: LocalReview | null = null;
  const reviews = loadReviews().map((review) => {
    if (
      review.id !== id ||
      review.status === "stale" ||
      review.status === "deleted_source"
    ) return review;
    savedReview = { ...review, userSaved: true, status: "saved" };
    return savedReview;
  });
  window.localStorage.setItem(REVIEWS_KEY, JSON.stringify(reviews));
  return savedReview;
}

export function loadJourneyState(now = new Date()): JourneyState {
  const journeyStartedAt = ensureJourneyStarted(now);
  const dayIndex = Math.min(21, Math.max(1, calendarDayDifference(journeyStartedAt, now) + 1));
  const phase = Math.min(3, Math.ceil(dayIndex / 7)) as 1 | 2 | 3;
  const progressKeys = new Set(
    loadRecords()
      .filter(
        (record) =>
          record.userConfirmed &&
          record.status === "confirmed" &&
          record.recordType !== "fill_info" &&
          record.recordType !== "resume_snippet",
      )
      .map((record) => record.actionId || record.id),
  );

  return {
    journeyStartedAt: journeyStartedAt.toISOString(),
    dayIndex,
    phase,
    progressCount: progressKeys.size,
  };
}

export function getPastSevenDayRecords(now = new Date()): LocalRecord[] {
  const windowStartedAt = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - 6,
  ).getTime();
  return loadRecords().filter((record) => {
    const completedAt = new Date(record.completedAt).getTime();
    return (
      record.userConfirmed &&
      record.status === "confirmed" &&
      record.recordType !== "fill_info" &&
      (record.recordType !== "resume_snippet" || record.sourceState === "current") &&
      completedAt >= windowStartedAt &&
      completedAt <= now.getTime()
    );
  });
}

export function savePastSevenDayReview(
  nextAction?: string,
  now = new Date(),
): LocalReview | null {
  const records = getPastSevenDayRecords(now);
  if (records.length === 0) return null;
  const windowStartedAt = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - 6,
  ).toISOString();
  const recordTypeCounts = records.reduce<Record<string, number>>((counts, record) => {
    counts[record.recordType] = (counts[record.recordType] ?? 0) + 1;
    return counts;
  }, {});
  const progressCount = new Set(
    records.map((record) => record.actionId || record.id),
  ).size;
  const routeCount = new Set(records.map((record) => record.routeKey)).size;
  const actionRecords = deduplicateRecordsByAction(records);
  const reviewRoute = actionRecords[0]?.routeKey ?? records[0].routeKey;
  const routePlan = deriveWeeklyRoutePlan(reviewRoute, records);
  const clues = [
    `过去 7 天完成了 ${progressCount} 次真实推进`,
    `留下了 ${records.length} 条确认记录`,
    ...(routeCount > 1 ? [`这些记录来自 ${routeCount} 条求职路径`] : []),
  ].slice(0, 3);
  return saveReview({
    basedOnRecordIds: records.map((record) => record.id),
    routeKey: reviewRoute,
    reviewKind: "weekly",
    reviewBasis: actionRecords.map((record) => record.actualDone),
    actionTitles: actionRecords.map((record) => record.actionTitle),
    recordTypeCounts,
    clues,
    missingInfo: routePlan.missingInfo,
    nextAction: nextAction?.trim() || routePlan.nextAction,
    aiGenerated: false,
    userSaved: true,
    status: "saved",
    windowStartedAt,
    windowEndedAt: now.toISOString(),
  });
}

function deduplicateRecordsByAction(records: LocalRecord[]): LocalRecord[] {
  const seen = new Set<string>();
  return records.filter((record) => {
    const key = record.actionId || record.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function deriveWeeklyRoutePlan(
  routeKey: RouteKey,
  records: LocalRecord[],
): { missingInfo: string[]; nextAction: string } {
  if (routeKey === "direction_to_jobs") {
    return {
      missingInfo: ["还缺更多真实岗位样本来验证方向。"],
      nextAction: "再保存 1 个真实岗位样本，核对重复出现的岗位要求。",
    };
  }
  if (routeKey === "experience_to_resume") {
    return {
      missingInfo: ["还可补充这段经历的对象、动作或交付物。"],
      nextAction: "再核对 1 段真实经历，补清动作或交付物。",
    };
  }
  if (routeKey === "jd_to_revision") {
    return {
      missingInfo: ["还需记录这次修改后的真实投递或反馈。"],
      nextAction: "再核对 1 条岗位要求与材料表述。",
    };
  }
  const completeApplicationCount = records.filter(
    (record) =>
      record.routeKey === "applications_to_review" &&
      record.recordType === "application" &&
      isApplicationRecordComplete(record.payload),
  ).length;
  return completeApplicationCount >= 2
    ? {
        missingInfo: ["还缺后续真实反馈来验证目前的线索。"],
        nextAction: "选 1 条投递记录，写下 1 个需要后续反馈验证的问题。",
      }
    : {
        missingInfo: ["还需要第 2 条完整投递记录。"],
        nextAction: "补齐第 2 条真实投递记录后再回看。",
      };
}

export function shrinkUnfinishedAction<T extends RouteOutput>(
  output: T,
): T & {
  todayAction: T["todayAction"] & { completionStandard: string };
  reducedContinuation: true;
} {
  const shrinkQuantity = (value: string) =>
    value
      .replace(/\d+\s*[-–—~至到]\s*\d+/g, "1")
      .replace(/\d+(?=\s*[个条份项段篇组轮处])/g, "1");
  const firstStep = output.todayAction.actionSteps[0] ?? output.todayAction.actionTitle;
  const shrunk = {
    ...output,
    reducedContinuation: true as const,
    recordGuide: {
      ...output.recordGuide,
      fieldsToRecord:
        output.routeKey === "applications_to_review"
          ? output.recordGuide.fieldsToRecord.filter((field) => !field.endsWith("2"))
          : output.recordGuide.fieldsToRecord,
    },
    todayAction: {
      ...output.todayAction,
      actionTitle: shrinkQuantity(output.todayAction.actionTitle),
      actionReason: "今天先完成一个更小版本。",
      actionSteps: [shrinkQuantity(firstStep)],
      estimatedTime: "5-10 分钟",
      recordAfterDone: shrinkQuantity(output.todayAction.recordAfterDone),
      completionStandard: "完成并保存 1 个可核对结果。",
    },
  };
  const originalProvenance = output.provenance ?? {};
  const changedPrefixes = [
    "todayAction.actionTitle",
    "todayAction.actionReason",
    "todayAction.actionSteps.",
    "todayAction.estimatedTime",
    "todayAction.recordAfterDone",
    "todayAction.completionStandard",
    "recordGuide.fieldsToRecord.",
  ];
  const isChangedPath = (path: string) =>
    changedPrefixes.some((prefix) =>
      prefix.endsWith(".") ? path.startsWith(prefix) : path === prefix,
    );
  const factAnchors = Object.entries(originalProvenance)
    .filter(([path, claim]) =>
      !isChangedPath(path) && claim.kind === "fact" && claim.sources.length > 0,
    )
    .map(([path]) => path);
  const provenance: OutputProvenance = { ...originalProvenance };
  for (const path of Object.keys(provenance)) {
    if (isChangedPath(path)) delete provenance[path];
  }
  if (factAnchors.length > 0) {
    const inference = (path: string) => {
      provenance[path] = {
        kind: "inference",
        sources: [],
        derivedFromClaims: factAnchors,
      };
    };
    inference("todayAction.actionTitle");
    inference("todayAction.actionReason");
    inference("todayAction.actionSteps.0");
    inference("todayAction.estimatedTime");
    inference("todayAction.recordAfterDone");
    inference("todayAction.completionStandard");
    shrunk.recordGuide.fieldsToRecord.forEach((_, index) =>
      inference(`recordGuide.fieldsToRecord.${index}`),
    );
  }
  return { ...shrunk, provenance };
}

function ensureJourneyStarted(now = new Date()): Date {
  const raw = window.localStorage.getItem(JOURNEY_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { journeyStartedAt?: string };
      if (parsed.journeyStartedAt) {
        const startedAt = new Date(parsed.journeyStartedAt);
        if (!Number.isNaN(startedAt.getTime())) return startedAt;
      }
    } catch {
      // Replace malformed local journey data below.
    }
  }

  const journeyStartedAt = now.toISOString();
  window.localStorage.setItem(JOURNEY_KEY, JSON.stringify({ journeyStartedAt }));
  return now;
}

function calendarDayDifference(startedAt: Date, now: Date): number {
  const startDate = new Date(
    startedAt.getFullYear(),
    startedAt.getMonth(),
    startedAt.getDate(),
  );
  const currentDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.floor((currentDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000));
}

function invalidateReviewsForRecordIds(ids: Set<string>) {
  const reviews = loadReviews().map((review) =>
    review.basedOnRecordIds.some((id) => ids.has(id))
      ? { ...review, status: "stale" as const, userSaved: false }
      : review,
  );
  window.localStorage.setItem(REVIEWS_KEY, JSON.stringify(reviews));
}
