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
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    queueMicrotask(() => setOutput(loadCurrentAction()));
  }, []);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!output || !confirmed) return;

    saveRecord({
      routeKey: params.routeKey,
      recordType: output.recordGuide.recordType,
      actionTitle: output.todayAction.actionTitle,
      actualDone,
      userConfirmed: confirmed,
    });
    router.push("/review");
  }

  return (
    <main className="shell">
      <section className="panel">
        <p className="eyebrow">记录今天做完了什么</p>
        <h1>{output?.todayAction.actionTitle ?? "记录结果"}</h1>
        <p className="muted">这条记录只保存在你的浏览器里。这里仅展示你自己保存的求职记录。</p>

        <form className="form-stack" onSubmit={submit}>
          <label className="field">
            <span>实际完成了什么？</span>
            <textarea value={actualDone} onChange={(event) => setActualDone(event.target.value)} />
          </label>

          <label className="checkbox">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            <span>我确认这条记录反映了我实际做过的事；如果没有做过，不要保留。</span>
          </label>

          <button className="primary-button" type="submit" disabled={!confirmed || !actualDone.trim()}>
            保存并轻复盘
          </button>
          <Link className="secondary-button" href="/track">只查看我的求职轨迹</Link>
        </form>
      </section>
    </main>
  );
}
