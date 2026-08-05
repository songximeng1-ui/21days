"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ExternalAiNotice } from "@/components/external-ai-notice";
import { APPLICATION_RECORD_FIELDS, getRouteContract } from "@/domain/route-contracts";
import { getRouteStrategy } from "@/domain/routes";
import type { RouteKey, RouteOutput } from "@/domain/types";
import { loadDraft, saveCurrentAction, saveDraft } from "@/lib/local-store";
import { routeOutputWithProvenanceSchema } from "@/schemas/route-output";

const fieldLabels: Record<string, string> = {
  targetDirection: "你大概想投什么方向？",
  rawExperience: "先写一段相关真实经历。",
  actualActions: "这段经历里你实际做过哪些动作？",
  deliverableOrResult: "有交付物或结果吗？没有可以写“无明确结果”。",
  targetJobTitle: "目标岗位名称是什么？",
  jdTextOrRequirements: "把岗位要求粘贴进来，或者写 3-5 条你看到的要求。",
  userMaterial: "粘贴你准备核对或修改的原句（只贴一句或一小段）。",
  currentQuestion: "你最想确认什么？也可以写可能去哪里找证据。",
  educationBackground: "你的专业或学习背景是什么？",
  realExperiences: "你做过哪些课程、项目、社团、兼职或实习？",
  interestsOrAcceptables: "你感兴趣或不排斥哪些事情？",
  constraints: "有哪些暂时不想接受的工作条件？",
  jobTitle: "第 1 条投递：岗位名称",
  companyOrPlatform: "第 1 条投递：公司或平台",
  submittedAt: "第 1 条投递：投递时间",
  feedbackStatus: "第 1 条投递：当前反馈状态",
  jdSummary: "第 1 条投递：这份岗位主要要求",
  materialVersion: "第 1 条投递：这次投递用的简历/材料",
  userSuspicion: "你自己怀疑的问题是什么？可选。",
  jobTitle2: "第 2 条投递：岗位名称",
  companyOrPlatform2: "第 2 条投递：公司或平台",
  submittedAt2: "第 2 条投递：投递时间",
  feedbackStatus2: "第 2 条投递：当前反馈状态",
  jdSummary2: "第 2 条投递：这份岗位主要要求",
  materialVersion2: "第 2 条投递：这次投递用的简历/材料",
  userSuspicion2: "第 2 条投递：你自己怀疑的问题是什么？可选。",
};

const routeFields: Record<RouteKey, string[]> = {
  experience_to_resume: [...getRouteContract("experience_to_resume").inputFields],
  jd_to_revision: [
    ...getRouteContract("jd_to_revision").inputFields,
    ...(getRouteContract("jd_to_revision").optionalInputFields ?? []),
  ],
  direction_to_jobs: [
    ...getRouteContract("direction_to_jobs").inputFields,
    ...(getRouteContract("direction_to_jobs").optionalInputFields ?? []),
  ],
  applications_to_review: [...APPLICATION_RECORD_FIELDS, "userSuspicion"],
};

const secondApplicationFields = [
  "jobTitle2",
  "companyOrPlatform2",
  "submittedAt2",
  "feedbackStatus2",
  "jdSummary2",
  "materialVersion2",
  "userSuspicion2",
];

export default function RouteInputPage() {
  const router = useRouter();
  const params = useParams<{ routeKey: RouteKey }>();
  const routeKey = params.routeKey;
  const strategy = getRouteStrategy(routeKey);
  const [draftStatus, setDraftStatus] = useState("正在读取草稿。");
  const [values, setValues] = useState<Record<string, string>>({});
  const [showSecondApplication, setShowSecondApplication] = useState(false);
  const [aiStatus, setAiStatus] = useState("");
  const [hasProcessingFailure, setHasProcessingFailure] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isDraftPersisted = useRef(false);
  const activeRequest = useRef<AbortController | null>(null);

  useEffect(() => {
    queueMicrotask(() => {
      try {
        const draft = loadDraft(routeKey);
        setValues(draft);
        setShowSecondApplication(secondApplicationFields.some((field) => Boolean(draft[field]?.trim())));
        isDraftPersisted.current = Object.values(draft).some((value) => value.trim());
        setDraftStatus(
          isDraftPersisted.current
            ? "已恢复草稿。"
            : "还没有保存的草稿。",
        );
      } catch {
        isDraftPersisted.current = false;
        setDraftStatus("这次没有读取成功，可以继续填写。");
      }
    });
  }, [routeKey]);

  useEffect(() => {
    return () => {
      activeRequest.current?.abort();
    };
  }, []);

  function updateValue(field: string, value: string) {
    const next = { ...values, [field]: value };
    setValues(next);
    setDraftStatus("正在保存。");
    try {
      saveDraft(routeKey, next);
      isDraftPersisted.current = true;
      setDraftStatus("已保存草稿。");
    } catch {
      isDraftPersisted.current = false;
      setDraftStatus("这次没有保存成功，请先不要关闭页面，稍后再试。");
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    setIsSubmitting(true);
    setHasProcessingFailure(false);
    setAiStatus("正在阅读你提供的信息。");
    const controller = new AbortController();
    activeRequest.current = controller;
    const longWaitTimer = window.setTimeout(() => {
      setAiStatus(
        isDraftPersisted.current
          ? "还在整理，内容已经保存，可以稍后回来继续。"
          : "还在整理。当前填写仍保留在页面上，请先不要关闭页面。",
      );
    }, 8000);
    const timeoutTimer = window.setTimeout(() => {
      controller.abort();
    }, 30000);

    try {
      const response = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ routeKey, input: buildRouteInput(routeKey, values) }),
        signal: controller.signal,
      });

      if (response.status === 422) {
        setAiStatus(
          "请先删除手机号、证件号、邮箱或婚育健康等敏感信息，再重新生成。",
        );
        setHasProcessingFailure(true);
        setIsSubmitting(false);
        return;
      }
      if (!response.ok) {
        throw new Error("Request failed");
      }

      setAiStatus("正在生成今天先做的一步。");
      const parsedOutput = routeOutputWithProvenanceSchema.safeParse(await response.json());
      if (
        !parsedOutput.success
        || parsedOutput.data.routeKey !== routeKey
        || !isActionableOutputType(parsedOutput.data.outputType)
      ) {
        throw new Error("Invalid response");
      }
      const output = parsedOutput.data as RouteOutput;
      try {
        saveCurrentAction(output);
      } catch {
        setAiStatus("行动已经整理好，但这次没有保存成功。请保留本页并重试。");
        setIsSubmitting(false);
        return;
      }
      router.push(`/routes/${routeKey}/action`);
    } catch {
      setHasProcessingFailure(true);
      setAiStatus(
        isDraftPersisted.current
          ? "这次暂时没整理出来。草稿已经保存在本页，可以稍后再试。"
          : "这次暂时没整理出来。当前填写还保留在页面上，但没有保存成功，请稍后再试。",
      );
      setIsSubmitting(false);
    } finally {
      window.clearTimeout(longWaitTimer);
      window.clearTimeout(timeoutTimer);
      if (activeRequest.current === controller) {
        activeRequest.current = null;
      }
    }
  }

  return (
    <main className="shell">
      <Link className="back-link" href="/">返回今日入口</Link>
      <section className="panel">
        <p className="eyebrow">先填一点真实情况</p>
        <h1>{strategy.label}</h1>
        <p className="muted">不用填完美。信息不够时，会先生成一个补信息行动。</p>
        <p className="status" role="status" aria-live="polite">{aiStatus || draftStatus}</p>

        {routeKey === "applications_to_review" && (
          <div className="notice">
            <strong>至少需要两条可对照的投递记录。先完成第 1 条，再按 2/2 补第 2 条，不会一次铺开全部字段。</strong>
            <p>不确定或暂时没有的内容可以直接这样写，不要为了填满而编。</p>
            <p>这份岗位主要要求示例：负责内容整理、活动执行和数据记录。</p>
            <p>这次投递用的简历/材料示例：社团经历版 V1。</p>
            <p>怀疑点示例：经历写得太泛，没有体现实际动作。</p>
          </div>
        )}

        {routeKey === "jd_to_revision" && (
          <div className="notice">
            <strong>只贴一条原句或一小段，系统才知道具体要核对哪里。</strong>
            <p>能力总结也请按原样粘贴；它不会自动被当成做过的事实。</p>
            <p>如果有项目文档、截图、版本记录或交付物，可在可选问题里写明去哪里找；没有证据也可以直接写“目前没有”。</p>
          </div>
        )}

        <form onSubmit={submit} className="form-stack" aria-busy={isSubmitting}>
          {routeKey === "applications_to_review" && <p className="eyebrow">第 1 条（1/2）</p>}
          {routeFields[routeKey].map((field) => (
            <label key={field} className="field">
              <span>
                {fieldLabels[field]}
                {getRouteContract(routeKey).optionalInputFields?.includes(field) && "（可选）"}
              </span>
              {isApplicationFeedbackField(routeKey, field) ? (
                <select
                  name={field}
                  value={values[field] ?? ""}
                  onChange={(event) => updateValue(field, event.target.value)}
                >
                  {applicationFeedbackOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              ) : isCompactApplicationField(routeKey, field) ? (
                <input
                  type={isApplicationDateField(routeKey, field) ? "date" : "text"}
                  name={field}
                  value={values[field] ?? ""}
                  onChange={(event) => updateValue(field, event.target.value)}
                  placeholder={inputPlaceholder(routeKey, field)}
                />
              ) : (
                <textarea
                  name={field}
                  value={values[field] ?? ""}
                  onChange={(event) => updateValue(field, event.target.value)}
                  placeholder={inputPlaceholder(routeKey, field)}
                />
              )}
            </label>
          ))}

          {routeKey === "applications_to_review" && (
            <>
              {showSecondApplication ? (
                <>
                  <p className="eyebrow">第 2 条（2/2）</p>
                  {secondApplicationFields.map((field) => (
                    <label key={field} className="field">
                      <span>{fieldLabels[field]}</span>
                      {isApplicationFeedbackField(routeKey, field) ? (
                        <select
                          name={field}
                          value={values[field] ?? ""}
                          onChange={(event) => updateValue(field, event.target.value)}
                        >
                          {applicationFeedbackOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      ) : isCompactApplicationField(routeKey, field) ? (
                        <input
                          type={isApplicationDateField(routeKey, field) ? "date" : "text"}
                          name={field}
                          value={values[field] ?? ""}
                          onChange={(event) => updateValue(field, event.target.value)}
                          placeholder={inputPlaceholder(routeKey, field)}
                        />
                      ) : (
                        <textarea
                          name={field}
                          value={values[field] ?? ""}
                          onChange={(event) => updateValue(field, event.target.value)}
                          placeholder={inputPlaceholder(routeKey, field)}
                        />
                      )}
                    </label>
                  ))}
                </>
              ) : (
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setShowSecondApplication(true)}
                >
                  再补第 2 条投递记录
                </button>
              )}
            </>
          )}

          <ExternalAiNotice />
          <button className="primary-button" type="submit" disabled={isSubmitting}>
            {isSubmitting
              ? "正在生成..."
              : hasProcessingFailure
                ? "再整理一次"
                : "生成今天先做的一步"}
          </button>
          <Link className="secondary-button" href="/">先保存，稍后继续</Link>
        </form>
      </section>
    </main>
  );
}

function isActionableOutputType(outputType: RouteOutput["outputType"]): boolean {
  return outputType === "route_result"
    || outputType === "missing_info"
    || outputType === "light_review";
}

function inputPlaceholder(routeKey: RouteKey, field: string) {
  if (routeKey === "applications_to_review") {
    if (field.startsWith("jdSummary")) return "例如：负责内容整理、活动执行和数据记录。";
    if (field.startsWith("materialVersion")) return "例如：社团经历版 V1。";
    if (field.startsWith("userSuspicion")) return "例如：经历写得太泛，没有体现实际动作。";
    return "只写你能确认的真实投递信息。";
  }

  if (routeKey === "jd_to_revision") {
    if (field === "targetJobTitle") return "例如：AI 产品运营实习生。";
    if (field === "jdTextOrRequirements") return "例如：可独立完成产品数据整理、分析与复盘。";
    if (field === "userMaterial") return "请逐字粘贴原句，例如：可独立完成产品数据整理、分析与复盘。";
    if (field === "currentQuestion") return "例如：我只有能力总结，没有项目记录，这句能不能改？";
  }

  return "可以写“不确定”或“暂时没有”。不要补不存在的经历、数据或结果。";
}

function buildRouteInput(routeKey: RouteKey, values: Record<string, string>): Record<string, unknown> {
  if (routeKey !== "applications_to_review") {
    const contract = getRouteContract(routeKey);
    return Object.fromEntries(
      [...contract.inputFields, ...(contract.optionalInputFields ?? [])].map(
        (field) => [field, values[field] ?? ""],
      ),
    );
  }

  return {
    applications: [
      {
        jobTitle: values.jobTitle ?? "",
        companyOrPlatform: values.companyOrPlatform ?? "",
        submittedAt: values.submittedAt ?? "",
        feedbackStatus: values.feedbackStatus ?? "",
        jdSummary: values.jdSummary ?? "",
        materialVersion: values.materialVersion ?? "",
        userSuspicion: values.userSuspicion ?? "",
      },
      {
        jobTitle: values.jobTitle2 ?? "",
        companyOrPlatform: values.companyOrPlatform2 ?? "",
        submittedAt: values.submittedAt2 ?? "",
        feedbackStatus: values.feedbackStatus2 ?? "",
        jdSummary: values.jdSummary2 ?? "",
        materialVersion: values.materialVersion2 ?? "",
        userSuspicion: values.userSuspicion2 ?? "",
      },
    ],
  };
}

function isCompactApplicationField(routeKey: RouteKey, field: string): boolean {
  if (routeKey !== "applications_to_review") return false;
  return ["jobTitle", "companyOrPlatform", "submittedAt", "feedbackStatus"].includes(
    field.replace(/2$/, ""),
  );
}

function isApplicationDateField(routeKey: RouteKey, field: string): boolean {
  return routeKey === "applications_to_review" && field.replace(/2$/, "") === "submittedAt";
}

function isApplicationFeedbackField(routeKey: RouteKey, field: string): boolean {
  return routeKey === "applications_to_review" && field.replace(/2$/, "") === "feedbackStatus";
}

const applicationFeedbackOptions = [
  { value: "", label: "请选择当前反馈" },
  { value: "暂无反馈", label: "暂无反馈" },
  { value: "已投递", label: "已投递" },
  { value: "已查看", label: "已查看" },
  { value: "笔试", label: "进入笔试" },
  { value: "面试", label: "进入面试" },
  { value: "已拒绝", label: "已拒绝" },
  { value: "已录用", label: "已录用" },
  { value: "其他", label: "其他" },
] as const;
