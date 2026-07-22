"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { clearAllLocalData, deleteRecord, loadRecords, updateRecord, type LocalRecord } from "@/lib/local-store";

export default function TrackPage() {
  const [records, setRecords] = useState<LocalRecord[]>([]);

  function refresh() {
    setRecords(loadRecords());
  }

  useEffect(() => {
    queueMicrotask(refresh);
  }, []);

  function remove(id: string) {
    deleteRecord(id);
    refresh();
  }

  function clearAll() {
    clearAllLocalData();
    refresh();
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
              <button className="text-button" onClick={() => remove(record.id)}>删除这条记录</button>
            </article>
          ))}
          {records.length === 0 && <p className="muted">还没有记录。今天先完成一个小行动就可以开始。</p>}
        </div>

        <Link className="primary-button" href="/">回到今天的行动</Link>
        {records.length > 0 && (
          <button className="danger-button" onClick={clearAll}>清空我的记录</button>
        )}
      </section>
    </main>
  );
}
