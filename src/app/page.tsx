"use client";

import { useEffect, useState } from "react";
import { ROUTE_KEYS, getRouteStrategy } from "@/domain/routes";
import { loadHomeProgress, type HomeProgress } from "@/lib/local-store";

export default function Home() {
  const [isLoaded, setIsLoaded] = useState(false);
  const [isChoosingQuestion, setIsChoosingQuestion] = useState(false);
  const [progress, setProgress] = useState<HomeProgress>({
    progressLabel: "第 1 次推进",
    currentAction: null,
    latestRecord: null,
    latestReview: null,
    hasUnfinishedAction: false,
  });

  useEffect(() => {
    queueMicrotask(() => {
      const nextProgress = loadHomeProgress();
      setProgress(nextProgress);
      setIsLoaded(true);
    });
  }, []);

  const hasReturnState = Boolean(
    progress.hasUnfinishedAction || progress.latestRecord || progress.latestReview,
  );
  const shouldShowRoutes = isLoaded && (!hasReturnState || isChoosingQuestion);

  return (
    <main className="shell">
      <section className="home-hero">
        <p className="day-badge">21 天陪跑 · {isLoaded ? progress.progressLabel : "正在读取本地进度"}</p>
        <h1>不用一次想清楚，今天先推进一件事。</h1>
        {!isLoaded ? (
          <p className="muted">正在把你上次保存的行动和记录找出来。</p>
        ) : hasReturnState ? (
          <ReturnHomeState
            progress={progress}
            isChoosingQuestion={isChoosingQuestion}
            onChooseQuestion={() => setIsChoosingQuestion(true)}
          />
        ) : (
          <>
            <p className="lead">你现在最想先解决哪件事？</p>
            <p className="muted">先选你今天最卡的一件事，后面只会给一个小行动。</p>
          </>
        )}
      </section>

      {shouldShowRoutes && <RouteQuestionList isReturnState={hasReturnState} />}

      <section className="home-footer">
        <a className="secondary-button" href="/track">我的求职轨迹</a>
        <p>今天只需要完成一个 15-30 分钟的小行动。</p>
      </section>
    </main>
  );
}

function ReturnHomeState({
  progress,
  isChoosingQuestion,
  onChooseQuestion,
}: {
  progress: HomeProgress;
  isChoosingQuestion: boolean;
  onChooseQuestion: () => void;
}) {
  if (progress.hasUnfinishedAction && progress.currentAction) {
    const action = progress.currentAction.todayAction;

    return (
      <div className="notice">
        <p className="lead">上次这一步还没完成，今天先接着处理它。</p>
        <h2>{action.actionTitle}</h2>
        <p>{action.actionReason}</p>
        <ul className="compact-list">
          {action.actionSteps.map((step) => <li key={step}>{step}</li>)}
        </ul>
        <div className="action-meta">
          <span>{action.estimatedTime}</span>
          <span>{action.recordAfterDone}</span>
        </div>
        <a className="primary-button" href={`/routes/${progress.currentAction.routeKey}/action`}>
          查看这一步行动
        </a>
        <button
          aria-controls="current-question"
          aria-expanded={isChoosingQuestion}
          className="secondary-button"
          type="button"
          onClick={onChooseQuestion}
        >
          换一个当前问题
        </button>
      </div>
    );
  }

  const routeKey = progress.latestReview?.routeKey ?? progress.latestRecord?.routeKey;
  const primaryHref = progress.latestReview && routeKey ? `/routes/${routeKey}/input` : "/review";
  const primaryLabel = progress.latestReview ? "从这个问题继续整理" : "基于这条记录轻复盘";

  return (
    <div className="notice">
      {progress.latestRecord && <p className="lead">最近推进：{progress.latestRecord.actualDone}</p>}
      {progress.latestReview && (
        <>
          <p className="muted">上次复盘后的下一步：</p>
          <h2>{progress.latestReview.nextAction}</h2>
        </>
      )}
      <a className="primary-button" href={primaryHref}>{primaryLabel}</a>
      <button
        aria-controls="current-question"
        aria-expanded={isChoosingQuestion}
        className="secondary-button"
        type="button"
        onClick={onChooseQuestion}
      >
        换一个当前问题
      </button>
    </div>
  );
}

function RouteQuestionList({ isReturnState }: { isReturnState: boolean }) {
  return (
    <section className="route-list" id="current-question" aria-label="选择当前卡点">
      {isReturnState && <h2 className="section-title">你现在想换成哪个问题？</h2>}
      {ROUTE_KEYS.map((routeKey) => {
        const route = getRouteStrategy(routeKey);
        return (
          <a className="route-card" href={`/routes/${routeKey}/input`} key={routeKey}>
            <span>{route.label}</span>
            <strong>选这个</strong>
          </a>
        );
      })}
    </section>
  );
}
