"use client";

import { useEffect, useState } from "react";
import { ROUTE_KEYS, getRouteStrategy } from "@/domain/routes";
import { loadHomeProgress, type HomeProgress } from "@/lib/local-store";

export default function Home() {
  const [progress, setProgress] = useState<HomeProgress>({
    dayIndex: 1,
    currentAction: null,
    latestRecord: null,
    latestReview: null,
    hasUnfinishedAction: false,
  });

  useEffect(() => {
    queueMicrotask(() => setProgress(loadHomeProgress()));
  }, []);

  const hasReturnState = Boolean(
    progress.hasUnfinishedAction || progress.latestRecord || progress.latestReview,
  );

  return (
    <main className="shell">
      <section className="home-hero">
        <p className="day-badge">21 天陪跑 · 第 {progress.dayIndex} 天</p>
        <h1>不用一次想清楚，今天先推进一件事。</h1>
        {hasReturnState ? (
          <ReturnHomeState progress={progress} />
        ) : (
          <>
            <p className="lead">你现在最想先解决哪件事？</p>
            <p className="muted">先选你今天最卡的一件事，后面只会给一个小行动。</p>
          </>
        )}
      </section>

      <section className="route-list" id="current-question" aria-label="选择当前卡点">
        {ROUTE_KEYS.map((routeKey) => {
          const route = getRouteStrategy(routeKey);
          return (
            <a className="route-card" href={`/routes/${routeKey}/input`} key={routeKey}>
              <span>{route.label}</span>
              <strong>开始</strong>
            </a>
          );
        })}
      </section>

      <section className="home-footer">
        <a className="secondary-button" href="/track">我的求职轨迹</a>
        <p>今天只需要完成一个 15-30 分钟的小行动。</p>
      </section>
    </main>
  );
}

function ReturnHomeState({ progress }: { progress: HomeProgress }) {
  if (progress.hasUnfinishedAction && progress.currentAction) {
    return (
      <div className="notice">
        <p className="lead">上次这一步还没完成，今天可以把它缩小一点。</p>
        <h2>{progress.currentAction.todayAction.actionTitle}</h2>
        <a className="primary-button" href={`/routes/${progress.currentAction.routeKey}/input`}>
          继续一个更小版本
        </a>
        <a className="secondary-button" href="#current-question">换一个当前问题</a>
      </div>
    );
  }

  const routeKey = progress.latestReview?.routeKey ?? progress.latestRecord?.routeKey;

  return (
    <div className="notice">
      {progress.latestRecord && <p className="lead">最近推进：{progress.latestRecord.actualDone}</p>}
      {progress.latestReview && (
        <>
          <p className="muted">上次复盘后的下一步：</p>
          <h2>{progress.latestReview.nextAction}</h2>
        </>
      )}
      {routeKey && <a className="primary-button" href={`/routes/${routeKey}/input`}>继续今天的行动</a>}
      <a className="secondary-button" href="#current-question">换一个当前问题</a>
    </div>
  );
}
