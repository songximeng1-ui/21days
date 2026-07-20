"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { loadRecords, type LocalRecord } from "@/lib/local-store";

const reviewCopy: Record<string, { clue: string; gap: string; next: string }> = {
  job_sample: {
    clue: "You moved a vague direction into a real job sample.",
    gap: "Next, add three requirements that appear in the JD.",
    next: "Next time, circle three requirements you can understand in this saved job sample.",
  },
  experience_fact: {
    clue: "You turned an experience into a record that can be reviewed.",
    gap: "Next, add the action, audience, deliverable, or result that is still unclear.",
    next: "Next time, add one still-unclear fact to this experience.",
  },
  jd_compare: {
    clue: "You put the JD and your material into one comparison record.",
    gap: "Next, add the before/after snippet and whether you submitted it.",
    next: "Next time, save one before/after snippet and check that it does not exaggerate.",
  },
  application: {
    clue: "You moved vague no-feedback worry into a real application record.",
    gap: "Next, add the material version, JD summary, or your question.",
    next: "Next time, add the material version used for this application.",
  },
  fill_info: {
    clue: "You added one real piece of information.",
    gap: "Next, bring this information back to the current route.",
    next: "Next time, use this saved information to continue the current route.",
  },
};

export default function ReviewPage() {
  const [latest, setLatest] = useState<LocalRecord | null>(null);

  useEffect(() => {
    queueMicrotask(() => setLatest(loadRecords()[0] ?? null));
  }, []);

  const copy = latest ? reviewCopy[latest.recordType] ?? reviewCopy.fill_info : reviewCopy.fill_info;

  return (
    <main className="shell">
      <section className="panel">
        <p className="eyebrow">今天的小复盘</p>
        <h1>这一步已经留下记录，可以用于下次复盘。</h1>

        <div className="review-grid">
          <section>
            <h2>复盘依据</h2>
            <p>{latest ? `你今天记录了：${latest.actualDone}` : "还没有可复盘记录。"}</p>
          </section>
          <section>
            <h2>看到的线索</h2>
            <p>{copy.clue}</p>
          </section>
          <section>
            <h2>还缺的信息</h2>
            <p>{copy.gap}</p>
          </section>
          <section className="action-card compact">
            <h2>下一步行动</h2>
            <p>{copy.next}</p>
          </section>
        </div>

        <Link className="primary-button" href="/track">查看我的求职轨迹</Link>
        <Link className="secondary-button" href="/">设为下一次行动</Link>
      </section>
    </main>
  );
}

