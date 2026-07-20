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

  return (
    <main className="shell">
      <Link className="back-link" href={`/routes/${params.routeKey}/input`}>返回输入</Link>
      <section className="panel">
        <p className="eyebrow">今天先推进这一步</p>
        <h1>{output.shortAssessment}</h1>

        {output.outputType === "missing_info" && (
          <div className="notice">
            <strong>还缺一个关键信息</strong>
            <p>现在还不能可靠判断：{output.missingInfo?.cannotJudge}</p>
            <p>目前已经知道：{output.missingInfo?.alreadyKnown.join("、") || "已有部分输入"}</p>
            <p>还缺：{output.missingInfo?.missingFields.join("、")}</p>
            <p>为什么只补这一项：补完后，系统才能继续判断下一步行动。</p>
          </div>
        )}

        <article className="action-card">
          <p className="eyebrow">今日行动</p>
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

        <Link className="primary-button" href={`/routes/${params.routeKey}/record`}>我做完了，记录结果</Link>
        <Link className="secondary-button" href="/">先保存，稍后回来</Link>
      </section>
    </main>
  );
}
