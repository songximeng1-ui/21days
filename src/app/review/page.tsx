"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import Link from "next/link";
import { ExternalAiNotice } from "@/components/external-ai-notice";
import {
  loadLatestReview,
  loadRecords,
  markReviewSaved,
  saveReview,
  type LocalRecord,
  type LocalReview,
} from "@/lib/local-store";
import { routeOutputWithProvenanceSchema } from "@/schemas/route-output";
import { isApplicationRecordComplete } from "@/domain/record-rules";
import {
  formatUserFacingList,
  getVisibleRecordFields,
} from "@/domain/record-presentation";

export default function ReviewPage() {
  const [latest, setLatest] = useState<LocalRecord | null>(null);
  const [reviewRecords, setReviewRecords] = useState<LocalRecord[]>([]);
  const [review, setReview] = useState<LocalReview | null>(null);
  const [status, setStatus] = useState("正在读取最近的记录。");
  const [isLoaded, setIsLoaded] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const requestController = useRef<AbortController | null>(null);
  const isMounted = useRef(true);

  useEffect(() => {
    let disposed = false;
    queueMicrotask(() => {
      const confirmedRecords = loadRecords().filter(
        (record) =>
          record.userConfirmed &&
          record.status === "confirmed" &&
          (record.recordType !== "resume_snippet" || record.sourceState === "current"),
      );
      const latestRecord = confirmedRecords[0] ?? null;
      if (disposed) return;
      setLatest(latestRecord);

      if (!latestRecord) {
        setStatus("还没有可以回头看的记录。");
        setIsLoaded(true);
        return;
      }

      if (latestRecord.recordType === "fill_info") {
        setStatus("这条补充信息已经保存。");
        setIsLoaded(true);
        return;
      }
      const sourceRecords =
        latestRecord.routeKey === "applications_to_review"
          ? confirmedRecords
              .filter(
                (record) =>
                  record.routeKey === "applications_to_review" &&
                  record.recordType === "application" &&
                  isApplicationRecordComplete(record.payload),
              )
              .slice(0, 2)
          : [latestRecord];
      setReviewRecords(sourceRecords);
      if (latestRecord.routeKey === "applications_to_review" && sourceRecords.length < 2) {
        setStatus("还需要第 2 条完整投递记录，才能生成这次回看。");
        setIsLoaded(true);
        return;
      }

      const latestReview = loadLatestReview();
      if (
        latestReview &&
        sourceRecords.every((record) => latestReview.basedOnRecordIds.includes(record.id))
      ) {
        setReview(latestReview);
        setStatus("已根据这条记录整理出下一步。");
        setIsLoaded(true);
        return;
      }
      setStatus("记录已经保存。确认数据说明后，才会生成这次回看。");
      setIsLoaded(true);
    });
    return () => {
      disposed = true;
      isMounted.current = false;
      requestController.current?.abort();
    };
  }, []);

  async function generateReview() {
    if (!latest || requestController.current || reviewRecords.length === 0) return;
    const controller = new AbortController();
    requestController.current = controller;
    setIsGenerating(true);
    setStatus("正在根据已保存的记录整理这次回看。");
    const longWaitTimer = window.setTimeout(() => {
      if (isMounted.current) {
        setStatus("还在整理。你的记录已经保存，可以稍后回来继续。");
      }
    }, 8_000);
    const timeoutTimer = window.setTimeout(() => {
      if (isMounted.current) {
        setStatus("这次暂时没整理出来。你的记录已经保存，可以稍后再看。");
      }
      controller.abort();
    }, 30_000);
    try {
      const response = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "light_review",
          routeKey: latest.routeKey,
          input:
            latest.routeKey === "applications_to_review"
              ? { records: reviewRecords }
              : { record: latest },
        }),
        signal: controller.signal,
      });
      if (response.ok === false) throw new Error("Request failed");
      const parsedOutput = routeOutputWithProvenanceSchema.safeParse(await response.json());
      if (!parsedOutput.success || parsedOutput.data.routeKey !== latest.routeKey) {
        setStatus("这次暂时没整理出来。你的记录已经保存，可以稍后再看。");
        return;
      }
      const output = parsedOutput.data;

      if (output.outputType !== "light_review" || !output.routeResult) {
        setStatus("这次暂时没整理出来。你的记录已经保存，可以稍后再看。");
        return;
      }

      let nextReview: LocalReview;
      try {
        nextReview = saveReview({
          basedOnRecordIds: reviewRecords.map((record) => record.id),
          routeKey: latest.routeKey,
          reviewBasis: asStringArray(output.routeResult.reviewBasis, [latest.actualDone]),
          clues: asStringArray(output.routeResult.clues, ["这条记录已经保存，可以用于下次继续。"]),
          missingInfo: asStringArray(output.routeResult.missingInfo, ["还可以补一项更具体的事实。"]),
          nextAction: String(output.routeResult.nextAction ?? output.todayAction.actionTitle),
          nextActionType: output.todayAction.actionType,
          nextRecordType: output.recordGuide.recordType,
          nextFieldsToRecord: output.recordGuide.fieldsToRecord,
          provenance: output.provenance,
          aiGenerated: true,
          userSaved: false,
        });
      } catch {
        setStatus(
          "回看已经整理好，但这次没有保存成功。你的原记录仍然保留，请稍后重试。",
        );
        return;
      }
      setReview(nextReview);
      setStatus("已根据这条记录整理出下一步。");
    } catch {
      if (!controller.signal.aborted) {
        setStatus("这次暂时没整理出来。你的记录已经保存，可以稍后再看。");
      }
    } finally {
      window.clearTimeout(longWaitTimer);
      window.clearTimeout(timeoutTimer);
      if (requestController.current === controller) {
        requestController.current = null;
      }
      if (isMounted.current) setIsGenerating(false);
    }
  }

  function saveNextAction(event: MouseEvent<HTMLAnchorElement>) {
    if (!review) return;
    try {
      const saved = markReviewSaved(review.id);
      if (!saved) throw new Error("Review is no longer saveable");
    } catch {
      event.preventDefault();
      setStatus("下一次行动没有保存成功，请留在本页稍后重试。");
    }
  }

  if (!isLoaded) {
    return (
      <main className="shell">
        <section className="panel">
          <p className="status" role="status" aria-live="polite">{status}</p>
        </section>
      </main>
    );
  }

  if (!latest) {
    return (
      <main className="shell">
        <section className="panel">
          <h1>还没有可以回头看的记录</h1>
          <p className="muted">先完成并保存一条真实行动，之后再从记录里看下一步。</p>
          <Link className="primary-button" href="/">回到今日入口</Link>
        </section>
      </main>
    );
  }

  return (
    <main className="shell">
      <section className="panel">
        <p className="eyebrow">今天先回头看一眼</p>
        <h1>这一步已经留下记录，可以用于判断下一步。</h1>
        <p className="status" role="status" aria-live="polite">{status}</p>

        {getVisibleRecordFields(latest.payload).length > 0 && (
          <section className="notice">
            <h2>刚保存的结构化记录</h2>
            {getVisibleRecordFields(latest.payload)
              .map(({ field, label, value }) => (
                <p key={field}>{label}：{value}</p>
              ))}
          </section>
        )}

        {!review &&
          latest.recordType !== "fill_info" &&
          (latest.routeKey !== "applications_to_review" || reviewRecords.length >= 2) && (
          <>
            <ExternalAiNotice />
            <button
              className="primary-button"
              type="button"
              onClick={generateReview}
              disabled={isGenerating}
              aria-busy={isGenerating}
            >
              {isGenerating
                ? "正在生成..."
                : latest.version > 1
                  ? "同意并重新生成这次回看"
                  : "同意并生成这次回看"}
            </button>
          </>
        )}

        {!review &&
          latest.routeKey === "applications_to_review" &&
          reviewRecords.length < 2 && (
            <Link className="primary-button" href="/routes/applications_to_review/input">
              补第 2 条投递记录
            </Link>
          )}

        <div className="review-grid">
          <section>
            <h2>这次根据什么判断</h2>
            <p>{review ? formatUserFacingList(review.reviewBasis) : (latest ? `你今天记录了：${latest.actualDone}` : "还没有可以回头看的记录。")}</p>
          </section>
          <section>
            <h2>看到的线索</h2>
            <p>{review ? formatUserFacingList(review.clues) : "记录保存后，这里会显示能继续判断的线索。"}</p>
          </section>
          <section>
            <h2>还缺的信息</h2>
            <p>{review ? (formatUserFacingList(review.missingInfo) || "目前没有需要补充的信息。") : "如果信息还不够，会先提示补哪一项。"}</p>
          </section>
          <section className="action-card compact">
            <h2>下一步行动</h2>
            <p>{review?.nextAction ?? "先完成并保存一条真实记录。"}</p>
          </section>
        </div>

        {latest?.recordType === "fill_info" ? (
          <Link className="primary-button" href={`/routes/${latest.routeKey}/input`}>
            继续补信息
          </Link>
        ) : review ? (
          <Link
            className="primary-button"
            href="/"
            onClick={saveNextAction}
          >
            设为下一次行动
          </Link>
        ) : (
          <Link className="primary-button" href="/">回到今日入口</Link>
        )}
        <Link className="secondary-button" href="/track">查看我的求职轨迹</Link>
      </section>
    </main>
  );
}

function asStringArray(value: unknown, fallback: string[]): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : fallback;
}
