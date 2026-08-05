"use client";

import { useEffect, useId, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import type { RouteKey, RouteOutput } from "@/domain/types";
import { loadCurrentAction } from "@/lib/local-store";

export default function ActionPage() {
  const params = useParams<{ routeKey: RouteKey }>();
  const [output, setOutput] = useState<RouteOutput | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    queueMicrotask(() => {
      setOutput(loadCurrentAction());
      setIsLoaded(true);
    });
  }, []);

  if (!isLoaded) {
    return (
      <main className="shell">
        <section className="panel">
          <p className="status" role="status" aria-live="polite">正在读取今天的行动。</p>
        </section>
      </main>
    );
  }

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
        <h1>今天只做这一件事</h1>
        <p className="muted">{output.shortAssessment}</p>

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
              <span>预计用时：{output.todayAction.estimatedTime}</span>
              <span>完成后记录：{output.todayAction.recordAfterDone}</span>
              {"completionStandard" in output.todayAction &&
                typeof output.todayAction.completionStandard === "string" &&
                output.todayAction.completionStandard.trim() && (
                  <span>完成标准：{output.todayAction.completionStandard}</span>
                )}
            </div>
          </article>
        )}

        {output.routeKey !== "jd_to_revision" && <EvidenceBlock output={output} />}
        {output.outputType === "route_result" && <RouteResultBlock output={output} />}

        {output.outputType === "missing_info" && (
          <div className="notice">
            <strong>还缺一个关键信息</strong>
            <p>现在还不能可靠判断：{output.missingInfo?.cannotJudge}</p>
            <p>目前已经知道：{output.missingInfo?.alreadyKnown.join("、") || "已有部分输入"}</p>
            <p>还缺：{output.missingInfo?.missingFields.join("、")}</p>
            <p>为什么只补这一项：补完后，下一步会更具体。</p>
          </div>
        )}

        {output.outputType === "route_result" || output.outputType === "light_review" ? (
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

function RouteResultBlock({ output }: { output: RouteOutput }) {
  const result = output.routeResult ?? {};

  if (output.routeKey === "direction_to_jobs") {
    const directions = Array.isArray(result.explorableDirections)
      ? result.explorableDirections.filter(isRecord)
      : [];
    return (
      <section className="route-result" aria-label="方向路线结果">
        <h2>可以先探索的方向</h2>
        {directions.map((direction, index) => (
          <article className="result-card" key={`${String(direction.directionName)}-${index}`}>
            <h3>{String(direction.directionName)}</h3>
            <ResultList title="搜索关键词" values={asStringArray(direction.searchKeywords)} />
            <ResultList title="来自你材料的依据" values={asStringArray(direction.basisFromUserMaterial)} />
            <ResultText title="风险或缺口" value={direction.riskOrGap} />
          </article>
        ))}
      </section>
    );
  }

  if (output.routeKey === "experience_to_resume") {
    return (
      <section className="route-result" aria-label="经历路线结果">
        <ResultList title="已经能确认的事实" values={asStringArray(result.confirmedFacts)} />
        <ResultList title="还缺哪些事实" values={asStringArray(result.missingFacts)} />
        <ResultList title="不要夸大的部分" values={asStringArray(result.doNotExaggerate)} />
        <ResultText title="克制简历片段" value={result.resumeSnippetDraft} />
      </section>
    );
  }

  if (output.routeKey === "jd_to_revision") {
    const decision = parseJdDecision(result);
    if (decision) return <JdDecisionBlock decision={decision} />;
    const revisionTarget = typeof result.revisionTarget === "string"
      ? result.revisionTarget.trim()
      : "";
    const allSupported = asStringArray(result.supportedByMaterial);
    const hasCandidate = typeof result.candidateRevision === "string" && result.candidateRevision.trim().length > 0;
    const canOfferCandidate = allSupported.length > 0 && hasCandidate;
    const supported = allSupported
      .filter((value) => value.trim() !== revisionTarget)
      .map(limitEvidence);
    return (
      <section className="route-result" aria-label="岗位要求对照结果">
        <ResultList title="这次对照的岗位要求" values={asStringArray(result.jdKeyRequirements)} />
        {canOfferCandidate && supported.length > 0 ? (
          <ResultList title="当前材料证据" values={supported} />
        ) : null}
        <ResultText title="要核对的原句" value={result.revisionTarget} />
        {canOfferCandidate ? (
          <>
            <ResultText title="有证据后可使用的候选文本" value={result.candidateRevision} />
            <ResultList title="当前仍缺的证据" values={asStringArray(result.unclearFromMaterial)} />
          </>
        ) : (
          <ResultText
            title="证据与候选文本"
            value="当前证据不足，暂不修改这句。先按上面的行动核对原始材料。"
          />
        )}
      </section>
    );
  }

  return (
    <section className="route-result" aria-label="这轮投递的查看结果">
      <ResultList title="这次根据什么判断" values={asStringArray(result.reviewBasis)} />
      <ResultList title="能看到的线索" values={asStringArray(result.possibleClues)} />
      <ResultList title="信息缺口" values={asStringArray(result.informationGaps)} />
      <ResultText title="下一步行动" value={result.nextValidationAction} />
    </section>
  );
}

type JdModification = {
  requirementQuote: string;
  materialQuotes: string[];
  revisionTarget: string;
  candidateRevision: string;
  reason: string;
};

type JdDecisionView = {
  decision: "modify" | "collect_evidence" | "all_keep";
  requirementsChecked: string[];
  modifications: JdModification[];
  evidenceRequest: string | null;
  afterSubmissionRecording: string;
};

function parseJdDecision(result: Record<string, unknown>): JdDecisionView | null {
  if (
    result.decision !== "modify"
    && result.decision !== "collect_evidence"
    && result.decision !== "all_keep"
  ) return null;
  const modifications = Array.isArray(result.modifications)
    ? result.modifications.filter(isJdModification).slice(0, 2)
    : [];
  return {
    decision: result.decision,
    requirementsChecked: asStringArray(result.requirementsChecked).map(limitEvidence),
    modifications,
    evidenceRequest: typeof result.evidenceRequest === "string" ? result.evidenceRequest : null,
    afterSubmissionRecording:
      typeof result.afterSubmissionRecording === "string"
        ? result.afterSubmissionRecording
        : "记录当前版本、投递状态和后续观察。",
  };
}

function isJdModification(value: unknown): value is JdModification {
  if (!isRecord(value)) return false;
  return typeof value.requirementQuote === "string"
    && Array.isArray(value.materialQuotes)
    && value.materialQuotes.every((quote) => typeof quote === "string")
    && typeof value.revisionTarget === "string"
    && typeof value.candidateRevision === "string"
    && typeof value.reason === "string";
}

function JdDecisionBlock({ decision }: { decision: JdDecisionView }) {
  return (
    <section className="route-result jd-decision" aria-label="岗位要求对照结果">
      <ResultList title="本次核对的岗位要求" values={decision.requirementsChecked} />
      {decision.decision === "modify" && (
        <section className="jd-modifications">
          <h2>建议修改的 {decision.modifications.length} 处</h2>
          {decision.modifications.map((modification, index) => (
            <JdModificationCard
              key={`${modification.revisionTarget}-${index}`}
              modification={modification}
              index={index}
            />
          ))}
        </section>
      )}
      {decision.decision === "collect_evidence" && (
        <section className="result-block notice">
          <h2>先补一项真实证据</h2>
          <p>{decision.evidenceRequest || "请回到原始材料，补充一项能逐字核对的事实。"}</p>
        </section>
      )}
      {decision.decision === "all_keep" && (
        <section className="result-block notice">
          <h2>本轮无需改写</h2>
          <p>前几条关键要求已有材料支撑。确认并保存当前版本，再记录投递状态和观察点。</p>
        </section>
      )}
      <ResultText title="完成后怎么记录" value={decision.afterSubmissionRecording} />
    </section>
  );
}

function JdModificationCard({
  modification,
  index,
}: {
  modification: JdModification;
  index: number;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const whyId = useId();
  return (
    <article className="result-card jd-modification-card">
      <p className="eyebrow">修改 {index + 1}</p>
      <h3>把这处表达改得更具体</h3>
      <p className="revision-target">原句：{modification.revisionTarget}</p>
      <p className="candidate-revision">建议：{modification.candidateRevision}</p>
      <button
        className="text-button jd-why-toggle"
        type="button"
        aria-expanded={isExpanded}
        aria-controls={whyId}
        onClick={() => setIsExpanded((current) => !current)}
      >
        为什么改这一处
      </button>
      {isExpanded && (
        <div id={whyId} className="jd-why-detail">
          <p>岗位原文：{limitEvidence(modification.requirementQuote)}</p>
          {modification.materialQuotes.slice(0, 2).map((quote, quoteIndex) => (
            <p key={`${quote}-${quoteIndex}`}>材料原文：{limitEvidence(quote)}</p>
          ))}
          <p>{modification.reason}</p>
        </div>
      )}
    </article>
  );
}

function ResultList({ title, values }: { title: string; values: string[] }) {
  if (values.length === 0) return null;
  return (
    <section className="result-block">
      <h2>{title}</h2>
      <ul className="compact-list">
        {values.map((value, index) => <li key={`${value}-${index}`}>{value}</li>)}
      </ul>
    </section>
  );
}

function ResultText({ title, value }: { title: string; value: unknown }) {
  if (typeof value !== "string" || !value.trim()) return null;
  return (
    <section className="result-block">
      <h2>{title}</h2>
      <p>{value}</p>
    </section>
  );
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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
  const reviewClues = asStringArray(result.possibleClues).map(
    (value) => `基于记录看到的可能线索：${limitEvidence(value)}`,
  );
  const fields = [
    "supportingFacts",
    "supportedByMaterial",
    "confirmedFacts",
    "jdKeyRequirements",
  ];

  const userProvidedEvidence = fields
    .flatMap((field) => {
      const value = result[field];
      return Array.isArray(value) ? value : [];
    })
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .filter((value, index, values) => values.indexOf(value) === index)
    .map((value) => `你提供的材料里有：${limitEvidence(value)}`);

  return [...reviewClues, ...userProvidedEvidence].slice(0, 3);
}

function limitEvidence(value: string) {
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned.length > 36 ? `${cleaned.slice(0, 36)}...` : cleaned;
}
