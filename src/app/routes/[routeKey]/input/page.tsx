"use client";

import { FormEvent, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { getRouteStrategy } from "@/domain/routes";
import type { RouteKey, RouteOutput } from "@/domain/types";
import { loadDraft, saveCurrentAction, saveDraft } from "@/lib/local-store";

const fieldLabels: Record<string, string> = {
  targetDirection: "你大概想投什么方向？",
  rawExperience: "先写一段相关真实经历。",
  actualActions: "这段经历里你实际做过哪些动作？",
  deliverableOrResult: "有交付物或结果吗？没有可以写“无明确结果”。",
  targetJobTitle: "目标岗位名称是什么？",
  jdTextOrRequirements: "贴上真实 JD 或 3-5 条岗位要求。",
  userMaterial: "贴上你准备使用的相关经历或简历片段。",
  educationBackground: "你的专业或学习背景是什么？",
  realExperiences: "你做过哪些课程、项目、社团、兼职或实习？",
  interestsOrAcceptables: "你感兴趣或不排斥哪些事情？",
  constraints: "有哪些暂时不想接受的工作条件？",
  jobTitle: "第 1 条投递：岗位名称",
  companyOrPlatform: "第 1 条投递：公司或平台",
  submittedAt: "第 1 条投递：投递时间",
  feedbackStatus: "第 1 条投递：当前反馈状态",
  jdSummary: "第 1 条投递：岗位要求摘要",
  materialVersion: "第 1 条投递：使用的材料版本",
  userSuspicion: "你自己怀疑的问题是什么？可选。",
  jobTitle2: "第 2 条投递：岗位名称",
  companyOrPlatform2: "第 2 条投递：公司或平台",
  submittedAt2: "第 2 条投递：投递时间",
  feedbackStatus2: "第 2 条投递：当前反馈状态",
  jdSummary2: "第 2 条投递：岗位要求摘要",
  materialVersion2: "第 2 条投递：使用的材料版本",
  userSuspicion2: "第 2 条投递：你自己怀疑的问题是什么？可选。",
};

const routeFields: Record<RouteKey, string[]> = {
  experience_to_resume: ["targetDirection", "rawExperience", "actualActions", "deliverableOrResult"],
  jd_to_revision: ["targetJobTitle", "jdTextOrRequirements", "userMaterial"],
  direction_to_jobs: ["educationBackground", "realExperiences", "interestsOrAcceptables", "constraints"],
  applications_to_review: [
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
  ],
};

export default function RouteInputPage() {
  const router = useRouter();
  const params = useParams<{ routeKey: RouteKey }>();
  const routeKey = params.routeKey;
  const strategy = getRouteStrategy(routeKey);
  const [draftStatus, setDraftStatus] = useState("已保存草稿");
  const [values, setValues] = useState<Record<string, string>>({});
  const [aiStatus, setAiStatus] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    queueMicrotask(() => setValues(loadDraft(routeKey)));
  }, [routeKey]);

  function updateValue(field: string, value: string) {
    const next = { ...values, [field]: value };
    setValues(next);
    setDraftStatus("正在保存");
    saveDraft(routeKey, next);
    setDraftStatus("已保存草稿");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    setIsSubmitting(true);
    setAiStatus("正在阅读你提供的信息。");
    const controller = new AbortController();
    const longWaitTimer = window.setTimeout(() => {
      setAiStatus("还在整理，内容已经保存，可以稍后回来继续。");
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

      if (!response.ok) {
        throw new Error("Request failed");
      }

      setAiStatus("正在生成今天先做的一步。");
      const output = (await response.json()) as RouteOutput;
      saveCurrentAction(output);
      router.push(`/routes/${routeKey}/action`);
    } catch {
      setAiStatus("这次暂时没整理出来。草稿已经保存在本页，可以稍后再试。");
      setIsSubmitting(false);
    } finally {
      window.clearTimeout(longWaitTimer);
      window.clearTimeout(timeoutTimer);
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

        <form onSubmit={submit} className="form-stack" aria-busy={isSubmitting}>
          {routeFields[routeKey].map((field) => (
            <label key={field} className="field">
              <span>{fieldLabels[field]}</span>
              <textarea
                name={field}
                value={values[field] ?? ""}
                onChange={(event) => updateValue(field, event.target.value)}
                placeholder={inputPlaceholder(routeKey)}
              />
            </label>
          ))}

          <button className="primary-button" type="submit" disabled={isSubmitting}>
            {isSubmitting ? "正在生成..." : "生成今天先做的一步"}
          </button>
          <Link className="secondary-button" href="/">先保存，稍后继续</Link>
        </form>
      </section>
    </main>
  );
}

function inputPlaceholder(routeKey: RouteKey) {
  if (routeKey === "applications_to_review") {
    return "只写你能确认的真实投递信息；如果 JD 摘要或材料版本还不具体，先去补齐后再提交。";
  }

  return "可以写“不确定”或“暂时没有”。不要补不存在的经历、数据或结果。";
}

function buildRouteInput(routeKey: RouteKey, values: Record<string, string>): Record<string, unknown> {
  if (routeKey !== "applications_to_review") {
    return values;
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
