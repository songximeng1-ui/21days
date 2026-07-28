"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { clearAllLocalData, deleteRecord, loadRecords, updateRecord, type LocalRecord } from "@/lib/local-store";

export default function TrackPage() {
  const [records, setRecords] = useState<LocalRecord[]>([]);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [isClearPending, setIsClearPending] = useState(false);
  const deleteTriggerRef = useRef<HTMLButtonElement | null>(null);
  const clearTriggerRef = useRef<HTMLButtonElement | null>(null);

  function refresh() {
    setRecords(loadRecords());
  }

  useEffect(() => {
    queueMicrotask(refresh);
  }, []);

  function confirmRemove(id: string) {
    deleteRecord(id);
    setPendingDeleteId(null);
    refresh();
  }

  function confirmClearAll() {
    clearAllLocalData();
    setIsClearPending(false);
    refresh();
  }

  function cancelDelete() {
    setPendingDeleteId(null);
    queueMicrotask(() => deleteTriggerRef.current?.focus());
  }

  function cancelClearAll() {
    setIsClearPending(false);
    queueMicrotask(() => clearTriggerRef.current?.focus());
  }

  function edit(record: LocalRecord) {
    const next = window.prompt("编辑这条记录", record.actualDone);
    if (next === null) return;
    updateRecord(record.id, { actualDone: next, userConfirmed: true });
    refresh();
  }

  return (
    <main className="shell">
      <section className="panel">
        <p className="eyebrow">我的求职轨迹</p>
        <h1>这里仅展示你自己保存的求职记录。</h1>
        <div className="track-summary">
          <span>已记录行动：{records.length} 次</span>
          <span>最近一次行动：{records[0]?.actionTitle ?? "暂无"}</span>
        </div>

        <div className="timeline">
          {records.map((record) => (
            <article key={record.id} className="timeline-item">
              <p className="eyebrow">{new Date(record.createdAt).toLocaleString()}</p>
              <h2>{record.actionTitle}</h2>
              <p>{record.actualDone}</p>
              <button className="text-button" onClick={() => edit(record)}>编辑这条记录</button>
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
                  <p>删除后这条记录将无法恢复，其他记录不会受影响。</p>
                  <div className="button-row">
                    <button autoFocus className="danger-button" onClick={() => confirmRemove(record.id)}>
                      确认删除这条记录
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
