"use client";

import { FormEvent, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import type { RouteKey, RouteOutput } from "@/domain/types";
import { loadCurrentAction, saveRecord } from "@/lib/local-store";

export default function RecordPage() {
  const router = useRouter();
  const params = useParams<{ routeKey: RouteKey }>();
  const [output, setOutput] = useState<RouteOutput | null>(null);
  const [actualDone, setActualDone] = useState("");
  const [payload, setPayload] = useState<Record<string, string>>({});
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    queueMicrotask(() => setOutput(loadCurrentAction()));
  }, []);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!output || !canSaveRecord()) return;

    saveRecord({
      routeKey: output.routeKey,
      recordType: output.recordGuide.recordType,
      actionTitle: output.todayAction.actionTitle,
      actualDone,
      payload,
      userConfirmed: confirmed,
    });
    router.push("/review");
  }

  function updatePayload(field: string, value: string) {
    setPayload((current) => ({ ...current, [field]: value }));
  }

  function canSaveRecord() {
    if (!output || output.outputType !== "route_result" || output.routeKey !== params.routeKey || !confirmed) {
      return false;
    }

    return output.recordGuide.fieldsToRecord.every((field) => payload[field]?.trim());
  }

  const hasRouteMismatch = output && output.routeKey !== params.routeKey;

  return (
    <main className="shell">
      <section className="panel">
        <p className="eyebrow">记录今天做完了什么</p>
        <h1>{output?.todayAction.actionTitle ?? "记录结果"}</h1>
        <p className="muted">这条记录只保存在你的浏览器里。这里仅展示你自己保存的求职记录。</p>

        {hasRouteMismatch && (
          <div className="notice">
            <strong>这不是当前路线的行动</strong>
            <p>请回到输入页重新生成当前路线的今日行动。</p>
            <Link className="primary-button" href={`/routes/${params.routeKey}/input`}>回到输入页</Link>
          </div>
        )}

        {output && !hasRouteMismatch && output.outputType !== "route_result" && (
          <div className="notice">
            <strong>这一步先不进入求职轨迹</strong>
            <p>当前状态更适合回到输入页补信息或稍后继续，不需要保存成已完成记录。</p>
            <Link className="primary-button" href={`/routes/${params.routeKey}/input`}>回到输入页</Link>
          </div>
        )}

        {(!output || (!hasRouteMismatch && output.outputType === "route_result")) && (
        <form className="form-stack" onSubmit={submit}>
          <label className="field">
            <span>实际完成了什么？</span>
            <textarea value={actualDone} onChange={(event) => setActualDone(event.target.value)} />
          </label>

          {output?.recordGuide.fieldsToRecord.map((field) => (
            <label className="field" key={field}>
              <span>{recordFieldLabels[field] ?? field}</span>
              <textarea
                value={payload[field] ?? ""}
                onChange={(event) => updatePayload(field, event.target.value)}
                placeholder="只写你已经确认真实存在的信息。"
              />
            </label>
          ))}

          <label className="checkbox">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            <span>我确认这条记录反映了我实际做过的事；如果没有做过，不要保留。</span>
          </label>

          <button className="primary-button" type="submit" disabled={!actualDone.trim() || !canSaveRecord()}>
            保存并轻复盘
          </button>
          <p className="muted">确认勾选并补齐上面的记录字段后，才能保存并复盘。</p>
          <Link className="secondary-button" href="/track">只查看我的求职轨迹</Link>
        </form>
        )}
      </section>
    </main>
  );
}

const recordFieldLabels: Record<string, string> = {
  jobTitle: "岗位名称",
  companyOrPlatform: "公司或平台",
  jdSummary: "JD 摘要",
  interestPoint: "你愿意继续看的点",
  concernPoint: "你担心或不确定的点",
  actualActions: "实际做过的动作",
  deliverable: "交付物或结果",
  missingFacts: "还不确定的事实",
  beforeSnippet: "修改前片段",
  afterSnippet: "修改后片段",
  jdRequirement: "对应的 JD 要求",
  submitted: "是否已经投递",
  submittedAt: "投递时间",
  materialVersion: "使用的材料版本",
  feedbackStatus: "反馈状态",
  note: "补充的信息",
  draft: "当前草稿",
  missingFact: "要补充的事实",
};
