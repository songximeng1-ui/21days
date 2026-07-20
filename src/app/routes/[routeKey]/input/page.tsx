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
  applications: "先补 1 条投递记录：岗位、公司、投递时间、反馈状态。",
};

const routeFields: Record<RouteKey, string[]> = {
  experience_to_resume: ["targetDirection", "rawExperience", "actualActions", "deliverableOrResult"],
  jd_to_revision: ["targetJobTitle", "jdTextOrRequirements", "userMaterial"],
  direction_to_jobs: ["educationBackground", "realExperiences", "interestsOrAcceptables", "constraints"],
  applications_to_review: ["applications"],
};

export default function RouteInputPage() {
  const router = useRouter();
  const params = useParams<{ routeKey: RouteKey }>();
  const routeKey = params.routeKey;
  const strategy = getRouteStrategy(routeKey);
  const [draftStatus, setDraftStatus] = useState("已保存草稿");
  const [values, setValues] = useState<Record<string, string>>({});
  const [aiStatus, setAiStatus] = useState("");

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
    setAiStatus("正在阅读你提供的信息。");

    const response = await fetch("/api/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ routeKey, input: values }),
    });

    setAiStatus("正在生成今天先做的一步。");
    const output = (await response.json()) as RouteOutput;
    saveCurrentAction(output);
    router.push(`/routes/${routeKey}/action`);
  }

  return (
    <main className="shell">
      <Link className="back-link" href="/">返回今日入口</Link>
      <section className="panel">
        <p className="eyebrow">路线轻输入</p>
        <h1>{strategy.label}</h1>
        <p className="muted">不用填完美。信息不够时，会先生成一个补信息行动。</p>
        <p className="status">{aiStatus || draftStatus}</p>

        <form onSubmit={submit} className="form-stack">
          {routeFields[routeKey].map((field) => (
            <label key={field} className="field">
              <span>{fieldLabels[field]}</span>
              <textarea
                name={field}
                value={values[field] ?? ""}
                onChange={(event) => updateValue(field, event.target.value)}
                placeholder="可以写“不确定”或“暂时没有”。不要补不存在的经历、数据或结果。"
              />
            </label>
          ))}

          <button className="primary-button" type="submit">生成今天先做的一步</button>
          <Link className="secondary-button" href="/">先保存，稍后继续</Link>
        </form>
      </section>
    </main>
  );
}
