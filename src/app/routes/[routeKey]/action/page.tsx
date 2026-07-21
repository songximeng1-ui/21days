"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import type { RouteKey, RouteOutput } from "@/domain/types";
import { loadCurrentAction } from "@/lib/local-store";

export default function ActionPage() {
  const params = useParams<{ routeKey: RouteKey }>();
  const [output, setOutput] = useState<RouteOutput | null>(null);

  useEffect(() => {
    queueMicrotask(() => setOutput(loadCurrentAction()));
  }, []);

  if (!output) {
    return (
      <main className="shell">
        <section className="panel">
          <h1>还没有当前行动</h1>
          <Link className="primary-button" href="/">回到今日入口</Link>
        </section>
      </main>
    );
  }

  if (output.routeKey !== params.routeKey) {
    return (
      <main className="shell">
        <section className="panel">
          <h1>这不是当前问题的行动</h1>
          <p className="muted">请回到当前问题，重新生成今天先做的一步。</p>
          <Link className="primary-button" href={`/routes/${params.routeKey}/input`}>回到输入页</Link>
        </section>
      </main>
    );
  }

  return (
    <main className="shell">
      <Link className="back-link" href={`/routes/${params.routeKey}/input`}>返回输入</Link>
      <section className="panel">
        <p className="eyebrow">今天先推进这一步</p>
        <h1>{output.shortAssessment}</h1>
        <EvidenceBlock output={output} />

        {output.outputType === "friendly_failure" && (
          <div className="notice">
            <strong>这次先不进入记录</strong>
            <p>当前内容已经尽量保留。你可以回到输入页，稍后继续整理。</p>
          </div>
        )}

        {output.outputType !== "friendly_failure" && (
          <article className="action-card">
            <p className="eyebrow">{output.outputType === "missing_info" ? "补信息行动" : "今日行动"}</p>
            <h2>{output.todayAction.actionTitle}</h2>
            <p>{output.todayAction.actionReason}</p>
            <ul>
              {output.todayAction.actionSteps.map((step) => <li key={step}>{step}</li>)}
            </ul>
            <div className="action-meta">
              <span>{output.todayAction.estimatedTime}</span>
              <span>{output.todayAction.recordAfterDone}</span>
            </div>
          </article>
        )}

        {output.outputType === "missing_info" && (
          <div className="notice">
            <strong>还缺一个关键信息</strong>
            <p>现在还不能可靠判断：{output.missingInfo?.cannotJudge}</p>
            <p>目前已经知道：{output.missingInfo?.alreadyKnown.join("、") || "已有部分输入"}</p>
            <p>还缺：{output.missingInfo?.missingFields.join("、")}</p>
            <p>为什么只补这一项：补完后，下一步会更具体。</p>
          </div>
        )}

        {output.outputType === "route_result" ? (
          <Link className="primary-button" href={`/routes/${params.routeKey}/record`}>我做完了，记录结果</Link>
        ) : output.outputType === "missing_info" ? (
          <Link className="primary-button" href={`/routes/${params.routeKey}/record`}>我补完了，去记录</Link>
        ) : (
          <Link className="primary-button" href={`/routes/${params.routeKey}/input`}>
            回到输入页
          </Link>
        )}
        <Link className="secondary-button" href="/">先保存，稍后回来</Link>
      </section>
    </main>
  );
}

function EvidenceBlock({ output }: { output: RouteOutput }) {
  const evidence = collectEvidence(output);
  if (evidence.length === 0 || output.outputType === "friendly_failure") return null;

  return (
    <div className="evidence-block">
      <strong>这一步基于：</strong>
      <ul className="compact-list">
        {evidence.map((item) => <li key={item}>{item}</li>)}
      </ul>
    </div>
  );
}

function collectEvidence(output: RouteOutput): string[] {
  if (output.outputType === "missing_info") {
    return [
      ...(output.missingInfo?.alreadyKnown.map((item) => `已看到：${item}`) ?? []),
      ...(output.missingInfo?.missingFields.map((item) => `还缺：${item}`) ?? []),
    ].slice(0, 3).map(limitEvidence);
  }

  const result = output.routeResult ?? {};
  const fields = [
    "supportingFacts",
    "supportedByMaterial",
    "confirmedFacts",
    "jdKeyRequirements",
    "possibleClues",
  ];

  return fields
    .flatMap((field) => {
      const value = result[field];
      return Array.isArray(value) ? value : [];
    })
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .slice(0, 3)
    .map((value) => `你提供的材料里有：${limitEvidence(value)}`);
}

function limitEvidence(value: string) {
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned.length > 36 ? `${cleaned.slice(0, 36)}...` : cleaned;
}
