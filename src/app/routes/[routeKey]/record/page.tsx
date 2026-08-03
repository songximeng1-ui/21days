"use client";

import { FormEvent, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import type { RouteKey, RouteOutput } from "@/domain/types";
import { isResumeSnippetGrounded, splitApplicationRecordPayload } from "@/domain/record-rules";
import {
  loadCurrentAction,
  loadDraft,
  mergeDraft,
  runLocalStoreTransaction,
  saveRecord,
  type CurrentAction,
} from "@/lib/local-store";

export default function RecordPage() {
  const router = useRouter();
  const params = useParams<{ routeKey: RouteKey }>();
  const [output, setOutput] = useState<CurrentAction | null>(null);
  const [actualDone, setActualDone] = useState("");
  const [payload, setPayload] = useState<Record<string, string>>({});
  const [confirmed, setConfirmed] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    queueMicrotask(() => {
      const current = loadCurrentAction();
      setOutput(current);
      if (current?.routeKey === "applications_to_review" && current.outputType === "route_result") {
        const draft = loadDraft(params.routeKey);
        setPayload(pickFields(draft, applicationRecordFields));
      } else if (
        current?.routeKey === "jd_to_revision" &&
        current.outputType === "route_result"
      ) {
        const draft = loadDraft(params.routeKey);
        setPayload({
          targetJobTitle: draft.targetJobTitle ?? "",
          beforeSnippet: draft.userMaterial ?? "",
          jdRequirement: draft.jdTextOrRequirements ?? "",
        });
      } else if (current?.routeKey === "experience_to_resume" && current.outputType === "route_result") {
        setPayload(experiencePayloadFromOutput(current));
      }
      setIsLoaded(true);
    });
  }, [params.routeKey]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!output) return;
    const missing = getMissingRequirements(output, payload, actualDone, confirmed);
    if (missing.length > 0) {
      event.currentTarget
        .querySelector<HTMLElement>('[aria-invalid="true"]')
        ?.focus();
      return;
    }
    if (!canSaveRecord()) return;
    setSaveError("");

    try {
    if (output.outputType === "missing_info") {
      runLocalStoreTransaction(() => {
        saveRecord({
          actionId: output.actionId,
          routeKey: output.routeKey,
          recordType: output.recordGuide.recordType,
          actionTitle: output.todayAction.actionTitle,
          actualDone: actualDone.trim() || summarizeFillInfo(payload),
          payload,
          userConfirmed: confirmed,
        });
        mergeDraft(params.routeKey, payload);
      });
      router.push(`/routes/${params.routeKey}/input`);
      return;
    }

    if (output.routeKey === "experience_to_resume" && output.outputType === "route_result") {
      runLocalStoreTransaction(() => {
        const experience = saveRecord({
          actionId: output.actionId,
          routeKey: output.routeKey,
          recordType: "experience_fact",
          actionTitle: output.todayAction.actionTitle,
          actualDone,
          payload: {
            confirmedFacts: payload.confirmedFacts ?? "",
            supportingFacts: payload.supportingFacts ?? "",
            missingFacts: payload.missingFacts ?? "",
          },
          userConfirmed: confirmed,
        });
        saveRecord({
          actionId: output.actionId,
          routeKey: output.routeKey,
          recordType: "resume_snippet",
          actionTitle: "简历片段版本",
          actualDone,
          payload: {
            sourceExperienceId: experience.id,
            resumeSnippet: payload.resumeSnippet ?? "",
            supportingFacts: payload.supportingFacts ?? "",
            stillMissing: payload.missingFacts ?? "",
          },
          userConfirmed: confirmed,
        });
      });
      router.push("/review");
      return;
    }

    if (output.routeKey === "applications_to_review" && output.outputType === "route_result") {
      runLocalStoreTransaction(() => {
        for (const application of splitApplicationRecordPayload(payload)) {
          saveRecord({
            actionId: output.actionId,
            routeKey: output.routeKey,
            recordType: "application",
            actionTitle: output.todayAction.actionTitle,
            actualDone,
            payload: application,
            userConfirmed: confirmed,
          });
        }
        if (output.reducedContinuation) mergeDraft(params.routeKey, payload);
      });
      router.push(
        output.reducedContinuation
          ? "/routes/applications_to_review/input"
          : "/review",
      );
      return;
    }

    saveRecord({
      actionId: output.actionId,
      routeKey: output.routeKey,
      recordType: output.recordGuide.recordType,
      actionTitle: output.todayAction.actionTitle,
      actualDone,
      payload,
      userConfirmed: confirmed,
    });
    router.push("/review");
    } catch {
      setSaveError("这次没有保存成功。你填写的内容还在本页，请稍后重试。");
    }
  }

  function updatePayload(field: string, value: string) {
    setPayload((current) => ({ ...current, [field]: value }));
  }

  function canSaveRecord() {
    if (!output || !isRecordableOutput(output) || output.routeKey !== params.routeKey || !confirmed) {
      return false;
    }

    const requiredFields = requiredRecordFields(output);
    const hasAllRequiredFields =
      requiredFields.length > 0 &&
      requiredFields.every((field) => payload[field]?.trim());
    if (!hasAllRequiredFields) return false;
    if (
      output.routeKey === "experience_to_resume" &&
      output.outputType === "route_result" &&
      !isResumeSnippetGrounded(payload)
    ) {
      return false;
    }

    if (output.routeKey === "applications_to_review" && output.outputType === "route_result") {
      const expectedRecordCount = output.reducedContinuation ? 1 : 2;
      return splitApplicationRecordPayload(payload).length === expectedRecordCount;
    }

    return true;
  }

  const hasRouteMismatch = output && output.routeKey !== params.routeKey;
  const missingRequirements =
    output && isRecordableOutput(output)
      ? getMissingRequirements(output, payload, actualDone, confirmed)
      : [];

  if (!isLoaded) {
    return (
      <main className="shell">
        <section className="panel">
          <p className="status" role="status" aria-live="polite">正在读取要记录的行动。</p>
        </section>
      </main>
    );
  }

  if (!output) {
    return (
      <main className="shell">
        <section className="panel">
          <h1>还没有可以记录的行动</h1>
          <p className="muted">先回到今日入口，选择现在最想推进的一件事。</p>
          <Link className="primary-button" href="/">回到今日入口</Link>
        </section>
      </main>
    );
  }

  return (
    <main className="shell">
      <section className="panel">
        <p className="eyebrow">记录今天做完了什么</p>
        <h1>{output?.todayAction.actionTitle ?? "记录结果"}</h1>
        <p className="muted">这条内容只在这台设备上保存，方便你下次从这里继续。</p>

        {hasRouteMismatch && (
          <div className="notice">
            <strong>这不是当前路线的行动</strong>
            <p>请回到输入页重新生成当前路线的今日行动。</p>
            <Link className="primary-button" href={`/routes/${params.routeKey}/input`}>回到输入页</Link>
          </div>
        )}

        {output && !hasRouteMismatch && !isRecordableOutput(output) && (
          <div className="notice">
            <strong>这一步先不保存成完成记录</strong>
            <p>当前内容可以先回到输入页继续补充。等有了真实行动或补充信息，再保存成记录。</p>
            <Link className="primary-button" href={`/routes/${params.routeKey}/input`}>回到输入页</Link>
          </div>
        )}

        {!hasRouteMismatch && isRecordableOutput(output) && (
        <form className="form-stack" onSubmit={submit} noValidate>
          <div className="field-group">
            <label className="field">
              <span>实际完成了什么？</span>
               <textarea
                 id="actual-done"
                 aria-describedby="actual-done-help record-missing-requirements"
                 required={output.outputType !== "missing_info"}
                 aria-invalid={
                   output.outputType !== "missing_info" && !actualDone.trim()
                     ? true
                     : undefined
                 }
                 value={actualDone}
                onChange={(event) => setActualDone(event.target.value)}
              />
            </label>
            <p className="field-help" id="actual-done-help">
              写今天完成的可核对结果，下次会用它决定下一步。
            </p>
          </div>

          {recordFieldsForOutput(output).map((field, index) => {
            const help = recordFieldHelp(field);
            const fieldId = `record-field-${index}`;
            const helpId = `${fieldId}-help`;
            return (
              <div className="field-group" key={field}>
                <label className="field" htmlFor={fieldId}>
                  <span>
                    {recordFieldLabels[field] ?? "补充信息"}
                    {!requiredRecordFields(output).includes(field) && "（想补充时再填）"}
                  </span>
                   <textarea
                     id={fieldId}
                     aria-describedby={
                       [help ? helpId : "", "record-missing-requirements"]
                         .filter(Boolean)
                         .join(" ")
                     }
                     required={requiredRecordFields(output).includes(field)}
                     aria-invalid={
                       requiredRecordFields(output).includes(field) &&
                       !payload[field]?.trim()
                         ? true
                         : undefined
                     }
                    value={payload[field] ?? ""}
                    onChange={(event) => updatePayload(field, event.target.value)}
                    placeholder={recordFieldPlaceholder(field)}
                  />
                </label>
                {help && <p className="field-help" id={helpId}>{help}</p>}
              </div>
            );
          })}

          {output.routeKey === "experience_to_resume" &&
            output.outputType === "route_result" &&
            payload.resumeSnippet?.trim() &&
            !isResumeSnippetGrounded(payload) && (
              <p className="notice" role="alert">
                片段里仍有无法从来源经历或支撑事实核对的内容，请删除或补充真实支撑后再保存。
              </p>
            )}

          {output.routeKey === "applications_to_review" &&
            output.outputType === "route_result" &&
            !output.reducedContinuation &&
            splitApplicationRecordPayload(payload).length < 2 && (
              <p className="notice">还需要补齐第 2 条真实投递记录，才能进入回看。</p>
            )}

          <label className="checkbox">
           <input
             type="checkbox"
             aria-describedby="record-missing-requirements"
             aria-invalid={!confirmed ? true : undefined}
             checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            <span>我确认这条记录反映了我实际做过的事；如果没有做过，不要保留。</span>
           </label>

          {saveError && <p className="notice" role="alert">{saveError}</p>}
          <p
            className="muted"
            id="record-missing-requirements"
            role="status"
            aria-label="保存前还需完成"
            aria-live="polite"
          >
            {missingRequirements.length > 0
              ? `保存前还需完成：${missingRequirements.join("、")}。`
              : "保存所需信息已经齐全。"}
          </p>

          <button
            className="primary-button"
            type="submit"
            disabled={missingRequirements.length === 0 && !canSaveRecord()}
          >
            {output?.outputType === "missing_info"
              ? "保存补充信息，继续判断"
              : output?.routeKey === "applications_to_review" && output.reducedContinuation
                ? "保存第 1 条，继续补第 2 条"
                : "保存并看看下一步"}
          </button>
          <p className="muted">
            {output?.outputType === "missing_info"
              ? "确认勾选并补齐上面的记录字段后，会回到当前路线继续判断。"
              : recordHelpText(output)}
          </p>
          <Link className="secondary-button" href="/track">只查看我的求职轨迹</Link>
        </form>
        )}
      </section>
    </main>
  );
}

function isRecordableOutput(output: RouteOutput) {
  return (
    output.outputType === "route_result" ||
    output.outputType === "missing_info" ||
    output.outputType === "light_review"
  );
}

function requiredRecordFields(output: RouteOutput): string[] {
  if (output.routeKey === "experience_to_resume" && output.outputType === "route_result") {
    return ["confirmedFacts", "supportingFacts", "resumeSnippet"];
  }
  if (output.recordGuide.recordType === "application") {
    if (output.outputType === "missing_info") {
      return output.recordGuide.fieldsToRecord;
    }
    return applicationReviewRequiredFields;
  }
  if (output.routeKey === "jd_to_revision" && output.outputType === "route_result") {
    return jdComparisonRecordFields;
  }

  return output.recordGuide.fieldsToRecord;
}

function summarizeFillInfo(payload: Record<string, string>): string {
  const count = Object.values(payload).filter((value) => value.trim()).length;
  return `补充了 ${count} 项信息`;
}

function recordHelpText(output: RouteOutput | null) {
  if (output?.recordGuide.recordType === "application") {
    return "岗位、公司或平台、投递时间、反馈状态、这份岗位主要要求、这次投递用的简历/材料填完后，系统才好帮你回头看这一轮投递；怀疑点可先不填。";
  }

  return "确认勾选并补齐上面的记录信息后，才能保存并看看下一步。";
}

const recordFieldLabels: Record<string, string> = {
  confirmedFacts: "来源经历与已确认事实",
  supportingFacts: "支撑这段表达的事实",
  resumeSnippet: "克制简历片段",
  jobTitle: "岗位名称",
  companyOrPlatform: "公司或平台",
  jdSummary: "这份岗位主要要求",
  interestPoint: "你愿意继续看的点",
  concernPoint: "你担心或不确定的点",
  actualActions: "实际做过的动作",
  deliverable: "交付物或结果",
  missingFacts: "还不确定的事实",
  beforeSnippet: "修改前片段",
  afterSnippet: "修改后片段",
  jdRequirement: "对应的岗位要求",
  submitted: "是否已经投递",
  submittedAt: "投递时间",
  materialVersion: "这次投递用的简历/材料",
  feedbackStatus: "反馈状态",
  note: "补充的信息",
  draft: "当前草稿",
  missingFact: "要补充的事实",
  targetJobTitle: "目标岗位名称",
  jdTextOrRequirements: "岗位要求或 3-5 条你看到的要求",
  userSuspicion: "自己怀疑的问题",
  jobTitle2: "第 2 条投递：岗位名称",
  companyOrPlatform2: "第 2 条投递：公司或平台",
  submittedAt2: "第 2 条投递：投递时间",
  feedbackStatus2: "第 2 条投递：反馈状态",
  jdSummary2: "第 2 条投递：这份岗位主要要求",
  materialVersion2: "第 2 条投递：这次投递用的简历/材料",
  userSuspicion2: "第 2 条投递：自己怀疑的问题",
};

const applicationRecordFields = [
  "jobTitle",
  "companyOrPlatform",
  "submittedAt",
  "feedbackStatus",
  "jdSummary",
  "materialVersion",
  "userSuspicion",
  "jobTitle2",
  "companyOrPlatform2",
  "submittedAt2",
  "feedbackStatus2",
  "jdSummary2",
  "materialVersion2",
  "userSuspicion2",
];

const applicationReviewRequiredFields = [
  "jobTitle",
  "companyOrPlatform",
  "submittedAt",
  "feedbackStatus",
  "jdSummary",
  "materialVersion",
];

const jdComparisonRecordFields = [
  "targetJobTitle",
  "beforeSnippet",
  "afterSnippet",
  "jdRequirement",
  "submitted",
];

function recordFieldsForOutput(output: RouteOutput): string[] {
  if (output.routeKey === "experience_to_resume" && output.outputType === "route_result") {
    return ["confirmedFacts", "supportingFacts", "missingFacts", "resumeSnippet"];
  }
  if (output.routeKey === "applications_to_review" && output.outputType === "route_result") {
    return "reducedContinuation" in output && output.reducedContinuation
      ? output.recordGuide.fieldsToRecord
      : applicationRecordFields;
  }
  if (output.routeKey === "jd_to_revision" && output.outputType === "route_result") {
    return jdComparisonRecordFields;
  }
  return output.recordGuide.fieldsToRecord;
}

function recordFieldHelp(field: string): string {
  if (field.startsWith("jdSummary")) return "这份岗位主要要求会用来对照这次投递的岗位到底在要什么。";
  if (field.startsWith("materialVersion")) return "这次投递用的简历/材料会用来判断同一份材料投出去后的反馈变化。";
  if (field.startsWith("feedbackStatus")) return "反馈状态会帮你下次回头看时不靠记忆猜结果。";
  return "";
}

function recordFieldPlaceholder(field: string): string {
  if (field.startsWith("jdSummary")) return "例如：负责内容整理、活动执行和数据记录。";
  if (field.startsWith("materialVersion")) return "例如：社团经历版 V1。";
  if (field.startsWith("userSuspicion")) return "例如：经历写得太泛，没有体现实际动作。";
  return "只写你已经确认真实存在的信息。";
}

function pickFields(values: Record<string, string>, fields: string[]): Record<string, string> {
  return Object.fromEntries(fields.flatMap((field) => values[field] === undefined ? [] : [[field, values[field]]]));
}

function getMissingRequirements(
  output: RouteOutput,
  payload: Record<string, string>,
  actualDone: string,
  confirmed: boolean,
): string[] {
  const missing = requiredRecordFields(output)
    .filter((field) => !payload[field]?.trim())
    .map((field) => recordFieldLabels[field] ?? "补充信息");
  if (output.outputType !== "missing_info" && !actualDone.trim()) {
    missing.unshift("实际完成了什么");
  }
  if (!confirmed) missing.push("真实性确认");
  return missing;
}

function experiencePayloadFromOutput(output: RouteOutput): Record<string, string> {
  const result = output.routeResult ?? {};
  return {
    confirmedFacts: joinStringArray(result.confirmedFacts),
    supportingFacts: joinStringArray(result.supportingFacts),
    missingFacts: joinStringArray(result.missingFacts),
    resumeSnippet:
      typeof result.resumeSnippetDraft === "string" ? result.resumeSnippetDraft : "",
  };
}

function joinStringArray(value: unknown): string {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).join("；")
    : "";
}
