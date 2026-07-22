"use client";

import { useEffect, useState } from "react";
import { ROUTE_KEYS, getRouteStrategy } from "@/domain/routes";
import type { RouteKey, RouteOutput } from "@/domain/types";
import { loadHomeProgress, saveCurrentAction, type HomeProgress } from "@/lib/local-store";

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
    const smallerAction = makeSmallerAction(progress.currentAction);

    return (
      <div className="notice">
        <p className="lead">上次这一步还没做完，今天可以把它缩小一点。</p>
        <h2>{action.actionTitle}</h2>
        <p>{smallerAction.todayAction.actionReason}</p>
        <ul className="compact-list">
          {smallerAction.todayAction.actionSteps.map((step) => <li key={step}>{step}</li>)}
        </ul>
        <div className="action-meta">
          <span>{action.estimatedTime}</span>
          <span>{action.recordAfterDone}</span>
        </div>
        <a
          className="primary-button"
          href={`/routes/${progress.currentAction.routeKey}/action`}
          onClick={() => saveCurrentAction(smallerAction)}
        >
          继续一个更小版本
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
  const reviewAction = progress.latestReview && routeKey ? makeReviewNextAction(routeKey, progress.latestReview.nextAction) : null;
  const primaryHref = reviewAction ? `/routes/${routeKey}/action` : "/review";
  const primaryLabel = reviewAction ? `继续：${reviewAction.todayAction.actionTitle}` : "基于这条记录轻复盘";

  return (
    <div className="notice">
      {progress.latestRecord && <p className="lead">最近推进：{progress.latestRecord.actualDone}</p>}
      {progress.latestReview && (
        <>
          <p className="muted">上次复盘后的下一步：</p>
          <p className="lead">今天继续这一件事</p>
          <h2>{progress.latestReview.nextAction}</h2>
        </>
      )}
      <a
        className="primary-button"
        href={primaryHref}
        onClick={() => {
          if (reviewAction) saveCurrentAction(reviewAction);
        }}
      >
        {primaryLabel}
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

function RouteQuestionList({ isReturnState }: { isReturnState: boolean }) {
  return (
    <section className="route-list" id="current-question" aria-label="选择当前卡点">
      {isReturnState && <h2 className="section-title">你现在想换成哪个问题？</h2>}
      {ROUTE_KEYS.map((routeKey) => {
        const route = getRouteStrategy(routeKey);
        return (
          <a className="route-card" href={`/routes/${routeKey}/input`} key={routeKey}>
            <span>{route.label}</span>
            <strong>从这里开始</strong>
          </a>
        );
      })}
    </section>
  );
}

function makeSmallerAction(output: RouteOutput): RouteOutput {
  const firstStep = output.todayAction.actionSteps[0] ?? output.todayAction.actionTitle;
  return {
    ...output,
    todayAction: {
      ...output.todayAction,
      actionReason: "今天先完成一个更小版本。",
      actionSteps: [`只做第一步：${firstStep}`],
      recordAfterDone: output.todayAction.recordAfterDone,
    },
  };
}

function makeReviewNextAction(routeKey: RouteKey, nextAction: string): RouteOutput {
  return {
    routeKey,
    outputType: "route_result",
    shortAssessment: "根据上次复盘，今天继续这一件事。",
    routeResult: {
      reviewBasis: ["上次轻复盘生成的下一步行动"],
      recordSufficiency: "next_action",
      possibleClues: ["已经有一条可继续推进的行动"],
      informationGaps: ["做完后再补真实记录"],
      nextValidationAction: nextAction,
    },
    missingInfo: null,
    todayAction: {
      actionTitle: nextAction,
      actionReason: "这一步来自上次真实记录后的轻复盘。",
      actionSteps: ["打开上次记录", "完成这一小步", "做完后保存结果"],
      estimatedTime: "15-30 分钟",
      recordAfterDone: "记录这次实际完成了什么。",
      actionType: "fill_info",
    },
    recordGuide: {
      recordType: "fill_info",
      fieldsToRecord: ["note"],
      requiresUserConfirmation: true,
    },
  };
}
