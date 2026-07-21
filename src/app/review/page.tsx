"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { RouteOutput } from "@/domain/types";
import { loadLatestReview, loadRecords, saveReview, type LocalRecord, type LocalReview } from "@/lib/local-store";

export default function ReviewPage() {
  const [latest, setLatest] = useState<LocalRecord | null>(null);
  const [review, setReview] = useState<LocalReview | null>(null);
  const [status, setStatus] = useState("正在整理这条记录。");

  useEffect(() => {
    queueMicrotask(async () => {
      const latestRecord = loadRecords().find((record) => record.userConfirmed) ?? null;
      setLatest(latestRecord);

      if (!latestRecord) {
        setStatus("还没有可复盘记录。");
        return;
      }

      const latestReview = loadLatestReview();
      if (latestReview?.basedOnRecordIds.includes(latestRecord.id)) {
        setReview(latestReview);
        setStatus("已根据这条记录生成轻复盘。");
        return;
      }

      try {
        const response = await fetch("/api/ai", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: "light_review",
            routeKey: latestRecord.routeKey,
            input: { record: latestRecord },
          }),
        });
        const output = (await response.json()) as RouteOutput;

        if (output.outputType !== "light_review" || !output.routeResult) {
          setStatus("这次暂时没整理出来。你的记录已经保存，可以稍后继续复盘。");
          return;
        }

        const nextReview = saveReview({
          basedOnRecordIds: [latestRecord.id],
          routeKey: latestRecord.routeKey,
          reviewBasis: asStringArray(output.routeResult.reviewBasis, [latestRecord.actualDone]),
          clues: asStringArray(output.routeResult.clues, ["这条记录已经保存，可以用于下次继续。"]),
          missingInfo: asStringArray(output.routeResult.missingInfo, ["还可以补一项更具体的事实。"]),
          nextAction: String(output.routeResult.nextAction ?? output.todayAction.actionTitle),
          aiGenerated: true,
          userSaved: false,
        });
        setReview(nextReview);
        setStatus("已根据这条记录生成轻复盘。");
      } catch {
        setStatus("这次暂时没整理出来。你的记录已经保存，可以稍后继续复盘。");
      }
    });
  }, []);

  return (
    <main className="shell">
      <section className="panel">
        <p className="eyebrow">今天的小复盘</p>
        <h1>这一步已经留下记录，可以用于下次复盘。</h1>
        <p className="status" aria-live="polite">{status}</p>

        <div className="review-grid">
          <section>
            <h2>复盘依据</h2>
            <p>{review?.reviewBasis.join("；") ?? (latest ? `你今天记录了：${latest.actualDone}` : "还没有可复盘记录。")}</p>
          </section>
          <section>
            <h2>看到的线索</h2>
            <p>{review?.clues.join("；") ?? "记录保存后，这里会显示可复盘线索。"}</p>
          </section>
          <section>
            <h2>还缺的信息</h2>
            <p>{review?.missingInfo.join("；") ?? "如果信息还不够，会先提示补哪一项。"}</p>
          </section>
          <section className="action-card compact">
            <h2>下一步行动</h2>
            <p>{review?.nextAction ?? "先完成并保存一条真实记录。"}</p>
          </section>
        </div>

        <Link className="primary-button" href="/">回到今日入口</Link>
        <Link className="secondary-button" href="/track">查看我的求职轨迹</Link>
      </section>
    </main>
  );
}

function asStringArray(value: unknown, fallback: string[]): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : fallback;
}
