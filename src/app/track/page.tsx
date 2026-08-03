"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  clearAllLocalData,
  deleteRecord,
  getConfirmedResumeSnippetTextForCopy,
  loadJourneyState,
  loadRecords,
  loadReviews,
  runLocalStoreTransaction,
  savePastSevenDayReview,
  updateRecord,
  type JourneyState,
  type LocalRecord,
  type LocalReview,
} from "@/lib/local-store";
import {
  formatUserFacingList,
  getEditableRecordFields,
  getRecordTypeLabel,
  getVisibleRecordFields,
} from "@/domain/record-presentation";

export default function TrackPage() {
  const [records, setRecords] = useState<LocalRecord[]>([]);
  const [journey, setJourney] = useState<JourneyState | null>(null);
  const [weeklyReview, setWeeklyReview] = useState<LocalReview | null>(null);
  const [weeklyReviewMessage, setWeeklyReviewMessage] = useState("");
  const [retainedReviews, setRetainedReviews] = useState<LocalReview[]>([]);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [isClearPending, setIsClearPending] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editActualDone, setEditActualDone] = useState("");
  const [editPayload, setEditPayload] = useState<Record<string, string>>({});
  const [editError, setEditError] = useState("");
  const [copyMessage, setCopyMessage] = useState("");
  const [operationError, setOperationError] = useState("");
  const deleteTriggerRef = useRef<HTMLButtonElement | null>(null);
  const clearTriggerRef = useRef<HTMLButtonElement | null>(null);
  const recordedActionCount = new Set(
    records.map((record) => record.actionId || record.id),
  ).size;

  function refresh() {
    setRecords(
      loadRecords().filter(
        (record) =>
          record.status === "confirmed" &&
          record.userConfirmed &&
          (record.recordType !== "resume_snippet" || record.sourceState === "current"),
      ),
    );
    setJourney(loadJourneyState());
    setWeeklyReview(
      loadReviews().find(
        (review) => review.reviewKind === "weekly" && review.status === "saved",
      ) ?? null,
    );
    setRetainedReviews(
      loadReviews().filter((review) => review.status === "deleted_source"),
    );
  }

  useEffect(() => {
    queueMicrotask(refresh);
  }, []);

  function confirmRemove(id: string, reviewPolicy: "cascade" | "retain" = "cascade") {
    try {
      runLocalStoreTransaction(() => deleteRecord(id, { reviewPolicy }));
      setPendingDeleteId(null);
      setOperationError("");
      refresh();
    } catch {
      setOperationError("这条记录没有删除成功，请保留当前页面并稍后重试。");
    }
  }

  function confirmClearAll() {
    try {
      runLocalStoreTransaction(clearAllLocalData);
      setIsClearPending(false);
      setOperationError("");
      refresh();
    } catch {
      setOperationError("记录没有清空成功，请保留当前页面并稍后重试。");
    }
  }

  function cancelDelete() {
    setPendingDeleteId(null);
    queueMicrotask(() => deleteTriggerRef.current?.focus());
  }

  function cancelClearAll() {
    setIsClearPending(false);
    queueMicrotask(() => clearTriggerRef.current?.focus());
  }

  function beginEdit(record: LocalRecord) {
    setEditingId(record.id);
    setEditActualDone(record.actualDone);
    setEditPayload(record.payload);
    setEditError("");
  }

  function saveEdit(record: LocalRecord) {
    if (!editActualDone.trim()) return;
    let saved: LocalRecord | null = null;
    try {
      saved = runLocalStoreTransaction(() =>
        updateRecord(record.id, {
          actualDone: editActualDone.trim(),
          payload: editPayload,
          userConfirmed: true,
        }),
      );
    } catch {
      setEditError("这次修改没有保存成功，当前编辑内容仍保留，请稍后重试。");
      return;
    }
    if (!saved) {
      setEditError(
        record.recordType === "application"
          ? "投递记录必须保留岗位、公司或平台、投递时间、反馈状态、JD 摘要和材料版本，未保存。"
          : "修改后的片段含有来源经历无法支撑的事实，未保存。",
      );
      return;
    }
    setEditingId(null);
    setEditError("");
    refresh();
  }

  function createWeeklyReview() {
    try {
      const review = runLocalStoreTransaction(savePastSevenDayReview);
      setWeeklyReview(review);
      setWeeklyReviewMessage(
        review ? "" : "过去 7 天还没有可回看的确认记录。",
      );
      setOperationError("");
    } catch {
      setOperationError("过去 7 天回看没有保存成功，请稍后重试。");
    }
  }

  async function copyConfirmedSnippet(recordId: string) {
    const text = getConfirmedResumeSnippetTextForCopy(recordId);
    if (!text) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(text);
      setCopyMessage("已复制简历片段。");
    } catch {
      setCopyMessage("这次没有复制成功，请手动选择片段。");
    }
  }

  return (
    <main className="shell">
      <section className="panel">
        <p className="eyebrow">我的求职轨迹</p>
        <h1>这里仅展示你自己保存的求职记录。</h1>
        {copyMessage && (
          <p className="status" role="status" aria-live="polite">{copyMessage}</p>
        )}
        {operationError && (
          <p className="notice" role="alert">{operationError}</p>
        )}
        {journey && (
          <p className="lead">
            21 天陪跑 · 第 {journey.dayIndex} 天 · 第 {journey.phase} 阶段
          </p>
        )}
        <div className="track-summary">
          <span>已记录行动：{recordedActionCount} 次</span>
          <span>真实推进：{journey?.progressCount ?? 0} 次</span>
          <span>最近一次行动：{records[0]?.actionTitle ?? "暂无"}</span>
        </div>

        <div className="timeline">
          {records.map((record) => (
            <article key={record.id} className="timeline-item">
              <p className="eyebrow">
                完成于 {new Date(record.completedAt).toLocaleString("zh-CN")} · 版本 {record.version}
              </p>
              <h2>{record.actionTitle}</h2>
              <p>{record.actualDone}</p>
              {getVisibleRecordFields(record.payload)
                .map(({ field, label, value }) => (
                  <p key={field}>{label}：{value}</p>
                ))}
              {record.recordType === "resume_snippet" && record.sourceState === "current" && (
                <button
                  className="secondary-button"
                  onClick={() => void copyConfirmedSnippet(record.id)}
                >
                  复制已确认片段
                </button>
              )}
              {editingId === record.id ? (
                <div className="form-stack">
                  {editError && <p className="notice" role="alert">{editError}</p>}
                  <label className="field">
                    <span>编辑实际完成</span>
                    <textarea
                      value={editActualDone}
                      onChange={(event) => setEditActualDone(event.target.value)}
                    />
                  </label>
                  {getEditableRecordFields({ ...record, payload: editPayload })
                    .map(({ field, label, value }) => (
                    <label className="field" key={field}>
                      <span>编辑：{label}</span>
                      <textarea
                        value={value}
                        onChange={(event) =>
                          setEditPayload((current) => ({
                            ...current,
                            [field]: event.target.value,
                          }))
                        }
                      />
                    </label>
                    ))}
                  <button className="primary-button" onClick={() => saveEdit(record)}>
                    保存修改
                  </button>
                  <button className="secondary-button" onClick={() => setEditingId(null)}>
                    取消编辑
                  </button>
                </div>
              ) : (
                <button className="text-button" onClick={() => beginEdit(record)}>
                  编辑这条记录
                </button>
              )}
              <button
                className="text-button"
                onClick={(event) => {
                  deleteTriggerRef.current = event.currentTarget;
                  setPendingDeleteId(record.id);
                }}
              >
                删除这条记录
              </button>
              {pendingDeleteId === record.id && (
                <div className="confirmation-panel" role="group" aria-label="确认删除记录">
                  <p>你可以同时删除依赖这条记录的回看结果，或仅保留一份已失效的回看快照。</p>
                  <div className="button-row">
                    <button autoFocus className="danger-button" onClick={() => confirmRemove(record.id)}>
                      确认删除这条记录
                    </button>
                    <button
                      className="secondary-button"
                      onClick={() => confirmRemove(record.id, "retain")}
                    >
                      仅删除记录，保留回看
                    </button>
                    <button className="secondary-button" onClick={cancelDelete}>
                      取消删除
                    </button>
                  </div>
                </div>
              )}
            </article>
          ))}
          {records.length === 0 && <p className="muted">还没有记录。今天先完成一个小行动就可以开始。</p>}
        </div>

        {retainedReviews.length > 0 && (
          <section className="notice">
            <h2>历史回看快照</h2>
            {retainedReviews.map((review) => (
              <article key={review.id}>
                <p>来源记录已删除，此回看仅作为历史快照保留。</p>
                {review.reviewBasis.map((basis, index) => (
                  <p key={`${review.id}-basis-${index}`}>{basis}</p>
                ))}
                <p>当时的下一步：{review.nextAction}</p>
              </article>
            ))}
          </section>
        )}

        <section className="notice">
          <h2>过去 7 天回看</h2>
          {weeklyReview ? (
            <>
              <p>{formatUserFacingList(weeklyReview.clues)}</p>
              {weeklyReview.actionTitles?.map((title, index) => (
                <p key={`action-${index}`}>行动：{title}</p>
              ))}
              {weeklyReview.reviewBasis.map((basis, index) => (
                <p key={`basis-${index}`}>回看依据：{basis}</p>
              ))}
              {Object.entries(weeklyReview.recordTypeCounts ?? {}).map(
                ([recordType, count]) => (
                  <p key={recordType}>
                    留下的记录：{getRecordTypeLabel(recordType)} × {count}
                  </p>
                ),
              )}
              {weeklyReview.missingInfo.map((item, index) => (
                <p key={`missing-${index}`}>还缺的信息：{item}</p>
              ))}
              <p>下一轮先做：{weeklyReview.nextAction}</p>
            </>
          ) : (
            <p>
              {weeklyReviewMessage ||
                "从过去 7 天确认保存的真实记录里，整理下一轮先做的一件事。"}
            </p>
          )}
          <button className="secondary-button" onClick={createWeeklyReview}>
            生成过去 7 天回看
          </button>
        </section>

        <Link className="primary-button" href="/">回到今天的行动</Link>
        <button
          className="danger-button"
          onClick={(event) => {
            clearTriggerRef.current = event.currentTarget;
            setIsClearPending(true);
          }}
        >
          清空我的记录
        </button>
        {isClearPending && (
          <div className="confirmation-panel" role="group" aria-label="确认清空所有内容">
            <p>这会删除当前行动、所有草稿、求职记录和查看结果，且无法撤销。</p>
            <div className="button-row">
              <button autoFocus className="danger-button" onClick={confirmClearAll}>确认清空全部内容</button>
              <button className="secondary-button" onClick={cancelClearAll}>取消清空</button>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
