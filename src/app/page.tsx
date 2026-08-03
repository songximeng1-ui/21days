"use client";

import { useEffect, useState } from "react";
import { ROUTE_KEYS, getRouteStrategy } from "@/domain/routes";
import { getRouteContract } from "@/domain/route-contracts";
import type { OutputProvenance } from "@/domain/provenance";
import type { RouteKey, RouteOutput } from "@/domain/types";
import {
  loadHomeProgress,
  saveCurrentAction,
  shrinkUnfinishedAction,
  type HomeProgress,
  type LocalReview,
} from "@/lib/local-store";

export default function Home() {
  const [isLoaded, setIsLoaded] = useState(false);
  const [isChoosingQuestion, setIsChoosingQuestion] = useState(false);
  const [saveError, setSaveError] = useState("");
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
        <p className="day-badge">21 天陪跑 · {isLoaded ? progress.progressLabel : "正在找回上次进度"}</p>
        <h1>不用一次想清楚，今天先推进一件事。</h1>
        {!isLoaded ? (
          <p className="muted">正在把你上次保存的行动和记录找出来。</p>
        ) : hasReturnState ? (
          <ReturnHomeState
            progress={progress}
            isChoosingQuestion={isChoosingQuestion}
            onChooseQuestion={() => setIsChoosingQuestion(true)}
            onSaveFailure={() =>
              setSaveError("下一次行动没有保存成功，请留在本页稍后重试。")
            }
          />
        ) : (
          <>
            <p className="lead">你现在最想先解决哪件事？</p>
            <p className="muted">先选你今天最卡的一件事，后面只会给一个小行动。</p>
          </>
        )}
      </section>

      {saveError && <p className="notice" role="alert">{saveError}</p>}
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
  onSaveFailure,
}: {
  progress: HomeProgress;
  isChoosingQuestion: boolean;
  onChooseQuestion: () => void;
  onSaveFailure: () => void;
}) {
  if (progress.hasUnfinishedAction && progress.currentAction) {
    const smallerAction = shrinkUnfinishedAction(progress.currentAction);

    return (
      <div className="notice">
        <p className="lead">上次这一步还没做完，今天可以把它缩小一点。</p>
        <h2>{smallerAction.todayAction.actionTitle}</h2>
        <p>{smallerAction.todayAction.actionReason}</p>
        <ul className="compact-list">
          {smallerAction.todayAction.actionSteps.map((step) => <li key={step}>{step}</li>)}
        </ul>
        <div className="action-meta">
          <span>{smallerAction.todayAction.estimatedTime}</span>
          <span>{smallerAction.todayAction.recordAfterDone}</span>
          <span>完成标准：{smallerAction.todayAction.completionStandard}</span>
        </div>
        <a
          className="primary-button"
          href={`/routes/${progress.currentAction.routeKey}/action`}
          onClick={(event) => {
            try {
              saveCurrentAction(smallerAction);
            } catch {
              event.preventDefault();
              onSaveFailure();
            }
          }}
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
  const reviewAction = progress.latestReview && routeKey
    ? makeReviewNextAction(routeKey, progress.latestReview)
    : null;
  const shouldContinueFillingInfo = progress.latestRecord?.recordType === "fill_info" && routeKey;
  const primaryHref = reviewAction
    ? `/routes/${routeKey}/action`
    : shouldContinueFillingInfo
      ? `/routes/${routeKey}/input`
      : "/review";
  const primaryLabel = reviewAction
    ? `继续：${reviewAction.todayAction.actionTitle}`
    : shouldContinueFillingInfo
      ? "继续补信息"
      : "基于这条记录看看下一步";

  return (
    <div className="notice">
      {progress.latestRecord && <p className="lead">最近推进：{progress.latestRecord.actualDone}</p>}
      {progress.latestReview && (
        <>
          <p className="muted">上次记录后的下一步：</p>
          <p className="lead">今天继续这一件事</p>
          <h2>{progress.latestReview.nextAction}</h2>
        </>
      )}
      <a
        className="primary-button"
        href={primaryHref}
        onClick={(event) => {
          if (!reviewAction) return;
          try {
            saveCurrentAction(reviewAction);
          } catch {
            event.preventDefault();
            onSaveFailure();
          }
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

function makeReviewNextAction(routeKey: RouteKey, review: LocalReview): RouteOutput | null {
  const nextAction = review.nextAction;
  const contract = getRouteContract(routeKey);
  const actionType =
    review.nextActionType === contract.actionType
      ? review.nextActionType
      : contract.actionType;
  const recordType =
    review.nextRecordType === contract.recordType
      ? review.nextRecordType
      : contract.recordType;
  const output: RouteOutput = {
    routeKey,
    outputType: "light_review",
    shortAssessment: "根据上次记录，今天继续这一件事。",
    routeResult: {
      reviewBasis: review.reviewBasis,
      clues: review.clues,
      missingInfo: review.missingInfo,
      nextAction: review.nextAction,
    },
    missingInfo: null,
    todayAction: {
      actionTitle: nextAction,
      actionReason: "这一步来自上次真实记录后整理出的下一步。",
      actionSteps: ["打开上次记录", "完成这一小步", "做完后保存结果"],
      estimatedTime: "15-30 分钟",
      recordAfterDone: "记录这次实际完成了什么。",
      actionType,
    },
    recordGuide: {
      recordType,
      fieldsToRecord:
        review.nextRecordType === contract.recordType && review.nextFieldsToRecord?.length
          ? review.nextFieldsToRecord
          : [...contract.fieldsToRecord],
      requiresUserConfirmation: true,
    },
  };
  output.provenance = makeReviewContinuationProvenance(review, output);
  return Object.keys(output.provenance).length > 0 ? output : null;
}

function makeReviewContinuationProvenance(
  review: LocalReview,
  output: RouteOutput,
): OutputProvenance {
  const provenance: OutputProvenance = {};
  const original = review.provenance ?? {};
  const anchors: string[] = [];
  review.reviewBasis.forEach((_, index) => {
    const sourceClaim = original[`routeResult.reviewBasis.${index}`];
    if (sourceClaim?.kind === "fact" && sourceClaim.sources.length > 0) {
      const path = `routeResult.reviewBasis.${index}`;
      provenance[path] = sourceClaim;
      anchors.push(path);
    }
  });
  if (anchors.length === 0) return {};

  const inference = (claimPath: string) => {
    provenance[claimPath] = {
      kind: "inference",
      sources: [],
      derivedFromClaims: anchors,
    };
  };
  inference("shortAssessment");
  review.reviewBasis.forEach((_, index) => {
    const path = `routeResult.reviewBasis.${index}`;
    if (!provenance[path]) inference(path);
  });
  review.clues.forEach((_, index) => inference(`routeResult.clues.${index}`));
  review.missingInfo.forEach((_, index) => inference(`routeResult.missingInfo.${index}`));
  inference("routeResult.nextAction");
  inference("todayAction.actionTitle");
  inference("todayAction.actionReason");
  output.todayAction.actionSteps.forEach((_, index) =>
    inference(`todayAction.actionSteps.${index}`),
  );
  inference("todayAction.estimatedTime");
  inference("todayAction.recordAfterDone");
  inference("todayAction.actionType");
  inference("recordGuide.recordType");
  output.recordGuide.fieldsToRecord.forEach((_, index) =>
    inference(`recordGuide.fieldsToRecord.${index}`),
  );
  return provenance;
}
