import { AiProviderError, type AiProvider, type AiProviderInput, type AiProviderScenario } from "@/ai/provider";
import type { RouteOutput } from "@/domain/types";

export class MockAiProvider implements AiProvider {
  constructor(private readonly scenario: AiProviderScenario = "success") {}

  async generate(input: AiProviderInput): Promise<RouteOutput> {
    if (this.scenario === "provider_failure") {
      throw new AiProviderError();
    }

    if (this.scenario === "invalid_structure") {
      return { broken: true } as unknown as RouteOutput;
    }

    if (this.scenario === "missing_info") {
      return makeMissingInfoOutput(input.routeKey);
    }

    if (this.scenario === "unsafe_output") {
      return makeUnsafeOutput(input.routeKey);
    }

    if (input.input.mode === "light_review") {
      return makeLightReviewOutput(input);
    }

    return makeSuccessfulOutput(input);
  }
}

function makeLightReviewOutput(input: AiProviderInput): RouteOutput {
  const record = input.input.record as {
    actualDone?: string;
    payload?: Record<string, unknown>;
  } | undefined;
  const actualDone = record?.actualDone ?? "你保存了一条真实记录。";
  const next = lightReviewNextStep(input.routeKey);

  return {
    routeKey: input.routeKey,
    outputType: "light_review",
    shortAssessment: "这条记录可以先做一次轻复盘。",
    routeResult: {
      reviewBasis: collectLightReviewBasis(input.routeKey, actualDone, record?.payload),
      clues: ["这一步已经从模糊想法变成了一条可回看的记录"],
      missingInfo: ["还可以补一项更具体的材料版本或事实依据"],
      nextAction: next.actionTitle,
    },
    missingInfo: null,
    todayAction: {
      actionTitle: next.actionTitle,
      actionReason: "先让记录更完整，后续复盘才更可靠。",
      actionSteps: next.actionSteps,
      estimatedTime: "15-30 分钟",
      recordAfterDone: next.recordAfterDone,
      actionType: next.actionType,
    },
    recordGuide: {
      recordType: next.recordType,
      fieldsToRecord: next.fieldsToRecord,
      requiresUserConfirmation: true,
    },
  };
}

function collectLightReviewBasis(
  routeKey: AiProviderInput["routeKey"],
  actualDone: string,
  payload?: Record<string, unknown>,
): string[] {
  if (routeKey !== "applications_to_review" || !payload) {
    return [actualDone];
  }

  const applications = ["", "2"]
    .map((suffix) => {
      const jobTitle = readText(payload[`jobTitle${suffix}`]);
      const companyOrPlatform = readText(payload[`companyOrPlatform${suffix}`]);
      return jobTitle && companyOrPlatform ? `${jobTitle} / ${companyOrPlatform}` : "";
    })
    .filter(Boolean);

  return [actualDone, ...applications];
}

function lightReviewNextStep(routeKey: AiProviderInput["routeKey"]): {
  actionTitle: string;
  actionSteps: string[];
  recordAfterDone: string;
  actionType: RouteOutput["todayAction"]["actionType"];
  recordType: RouteOutput["recordGuide"]["recordType"];
  fieldsToRecord: string[];
} {
  if (routeKey === "direction_to_jobs") {
    return {
      actionTitle: "下一步先保存 1 个真实岗位样本",
      actionSteps: ["用已有关键词搜索", "保存 1 个看得懂的岗位", "记下 JD 摘要"],
      recordAfterDone: "记录岗位名称、公司或平台和 JD 摘要。",
      actionType: "job_sample",
      recordType: "job_sample",
      fieldsToRecord: ["jobTitle", "companyOrPlatform", "jdSummary", "interestPoint", "concernPoint"],
    };
  }
  if (routeKey === "experience_to_resume") {
    return {
      actionTitle: "下一步先补这段经历的一项真实事实",
      actionSteps: ["打开经历记录", "补 1 项动作或交付物", "保存修改"],
      recordAfterDone: "记录实际动作、交付物和仍不确定的事实。",
      actionType: "experience_fact",
      recordType: "experience_fact",
      fieldsToRecord: ["actualActions", "deliverable", "missingFacts"],
    };
  }
  if (routeKey === "jd_to_revision") {
    return {
      actionTitle: "下一步先完成 1 条投递前最小修改",
      actionSteps: ["打开 JD 和材料", "修改 1 条真实表达", "保存修改前后版本"],
      recordAfterDone: "记录修改前后片段和对应 JD 要求。",
      actionType: "jd_revision",
      recordType: "jd_compare",
      fieldsToRecord: ["beforeSnippet", "afterSnippet", "jdRequirement", "submitted"],
    };
  }
  return {
    actionTitle: "下一步先补 1 条最低字段投递记录",
    actionSteps: ["选最近一条投递", "补岗位、公司或平台、投递时间和反馈状态", "保存记录"],
    recordAfterDone: "记录岗位、公司或平台、投递时间和反馈状态。",
    actionType: "application_record",
    recordType: "application",
    fieldsToRecord: ["jobTitle", "companyOrPlatform", "submittedAt", "feedbackStatus"],
  };
}

function makeSuccessfulOutput(input: AiProviderInput): RouteOutput {
  const { routeKey } = input;
  if (routeKey === "direction_to_jobs") {
    const directionName = readText(input.input.interestsOrAcceptables) || readText(input.input.educationBackground);
    const basis = compactTextValues([
      input.input.educationBackground,
      input.input.realExperiences,
      input.input.interestsOrAcceptables,
    ]);
    return {
      routeKey,
      outputType: "route_result",
      shortAssessment: "可以先把方向落到真实岗位样本。",
      routeResult: {
        explorableDirections: [
          {
            directionName,
            searchKeywords: [`${directionName}实习`, `${directionName}助理`],
            basisFromUserMaterial: basis,
            riskOrGap: "还缺真实 JD 样本验证",
            validationFocus: "先观察岗位要求里反复出现的工具和交付物",
          },
        ],
      },
      missingInfo: null,
      todayAction: {
        actionTitle: "今天先保存 1-3 个真实岗位样本",
        actionReason: "先用真实 JD 验证方向，比直接下职业结论更可靠。",
        actionSteps: ["搜索一个关键词", "打开 1-3 个看得懂的岗位", "保存岗位要求摘要"],
        estimatedTime: "15-30 分钟",
        recordAfterDone: "记录岗位名称、公司或平台、JD 摘要、兴趣点和担心点。",
        actionType: "job_sample",
      },
      recordGuide: {
        recordType: "job_sample",
        fieldsToRecord: ["jobTitle", "companyOrPlatform", "jdSummary", "interestPoint", "concernPoint"],
        requiresUserConfirmation: true,
      },
    };
  }

  if (routeKey === "experience_to_resume") {
    const rawExperience = readText(input.input.rawExperience);
    const actualActions = readText(input.input.actualActions);
    const deliverableOrResult = readText(input.input.deliverableOrResult);
    return {
      routeKey,
      outputType: "route_result",
      shortAssessment: "这段经历已经能先整理实际动作。",
      routeResult: {
        confirmedFacts: [rawExperience, actualActions],
        missingFacts: ["还可以补充对象或交付物"],
        doNotExaggerate: ["不要把协助写成负责"],
        resumeSnippetDraft: `${rawExperience}；实际完成：${actualActions}；交付物或结果：${deliverableOrResult}。`,
        supportingFacts: [actualActions, deliverableOrResult],
      },
      missingInfo: null,
      todayAction: {
        actionTitle: "今天先确认这段经历里实际做过的 3 个动作",
        actionReason: "先把事实边界说清楚，后面才适合保存简历片段。",
        actionSteps: ["列出实际动作", "标出交付物", "删掉没做过的表述"],
        estimatedTime: "15-30 分钟",
        recordAfterDone: "记录实际动作、交付物和仍不确定的地方。",
        actionType: "experience_fact",
      },
      recordGuide: {
        recordType: "experience_fact",
        fieldsToRecord: ["actualActions", "deliverable", "missingFacts"],
        requiresUserConfirmation: true,
      },
    };
  }

  if (routeKey === "jd_to_revision") {
    const requirements = splitSourceText(readText(input.input.jdTextOrRequirements));
    const userMaterial = readText(input.input.userMaterial);
    return {
      routeKey,
      outputType: "route_result",
      shortAssessment: "这里先看材料和 JD 的支撑关系，不评价你本人适不适合。",
      routeResult: {
        jdKeyRequirements: requirements,
        supportedByMaterial: [userMaterial],
        unclearFromMaterial: ["还看不出具体交付物"],
        minimalRevisionActions: ["补 1 句具体做过的动作和交付物"],
        afterSubmissionRecording: ["记录材料版本和投递时间"],
      },
      missingInfo: null,
      todayAction: {
        actionTitle: "今天先对照 JD 做 1 条投递前最小修改",
        actionReason: "先改最能支撑 JD 的一处表达，不要同时大改整份简历。",
        actionSteps: ["圈出 JD 的 1 条关键要求", "找到材料里对应经历", "补 1 个真实动作或交付物"],
        estimatedTime: "15-30 分钟",
        recordAfterDone: "记录修改前后片段、修改依据和是否投递。",
        actionType: "jd_revision",
      },
      recordGuide: {
        recordType: "jd_compare",
        fieldsToRecord: ["beforeSnippet", "afterSnippet", "jdRequirement", "submitted"],
        requiresUserConfirmation: true,
      },
    };
  }

  if (routeKey === "applications_to_review") {
    const applications = Array.isArray(input.input.applications)
      ? input.input.applications.filter(isRecord)
      : [];
    const reviewBasis = applications
      .flatMap((application) => [application.jobTitle, application.companyOrPlatform])
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .slice(0, 3);
    return {
      routeKey,
      outputType: "route_result",
      shortAssessment: "先基于真实投递记录看一个可能线索。",
      routeResult: {
        reviewBasis,
        recordSufficiency: "enough",
        possibleClues: ["部分记录还缺材料版本，后续不好判断修改是否有效"],
        informationGaps: ["JD 摘要", "使用的材料版本"],
        nextValidationAction: "补齐 1 条投递记录的材料版本",
      },
      missingInfo: null,
      todayAction: {
        actionTitle: "今天先选择 1 条投递记录补齐材料版本",
        actionReason: "先让这条记录可复盘，再判断下一轮怎么调整。",
        actionSteps: [
          "选最近一条投递",
          "按这个格式补：岗位 / 公司或平台 / 投递时间 / 反馈状态 / JD 摘要 / 材料版本",
          "只写能确认的真实信息，先把这条记录补到可以复盘",
        ],
        estimatedTime: "15-30 分钟",
        recordAfterDone: "记录岗位、公司或平台、投递时间、反馈状态、JD 摘要和材料版本。",
        actionType: "application_record",
      },
      recordGuide: {
        recordType: "application",
        fieldsToRecord: [
          "jobTitle",
          "companyOrPlatform",
          "submittedAt",
          "feedbackStatus",
          "jdSummary",
          "materialVersion",
        ],
        requiresUserConfirmation: true,
      },
    };
  }

  return {
    routeKey,
    outputType: "route_result",
    shortAssessment: "现在可以先推进一个小行动。",
    routeResult: {},
    missingInfo: null,
    todayAction: {
      actionTitle: "今天先补一条真实记录",
      actionReason: "有记录后才适合继续复盘。",
      actionSteps: ["打开材料", "补一条真实信息"],
      estimatedTime: "15-30 分钟",
      recordAfterDone: "保存这条真实记录。",
      actionType: "fill_info",
    },
    recordGuide: {
      recordType: "fill_info",
      fieldsToRecord: ["note"],
      requiresUserConfirmation: true,
    },
  };
}

function makeMissingInfoOutput(routeKey: AiProviderInput["routeKey"]): RouteOutput {
  return {
    routeKey,
    outputType: "missing_info",
    shortAssessment: "还缺一个关键信息，先补这一小块就能继续。",
    routeResult: null,
    missingInfo: {
      cannotJudge: "当前路线的可靠判断",
      alreadyKnown: [],
      missingFields: ["one key field"],
    },
    todayAction: {
      actionTitle: "今天先补一小块真实信息",
      actionReason: "补完这一项后，后面才好继续整理下一步。",
      actionSteps: ["补一条真实信息", "保存后回来继续"],
      estimatedTime: "15-30 分钟",
      recordAfterDone: "记录补充的真实信息。",
      actionType: "fill_info",
    },
    recordGuide: {
      recordType: "fill_info",
      fieldsToRecord: ["note"],
      requiresUserConfirmation: true,
    },
  };
}

function makeUnsafeOutput(routeKey: AiProviderInput["routeKey"]): RouteOutput {
  return {
    ...makeSuccessfulOutput({ routeKey, input: sampleInputForUnsafeOutput(routeKey) }),
    shortAssessment: "匹配度 90%，录取概率很高。",
  };
}

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function compactTextValues(values: unknown[]): string[] {
  return values.map(readText).filter((value) => value.length > 0);
}

function splitSourceText(value: string): string[] {
  const parts = value
    .split(/[\n；;。]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 5);
  return parts.length > 0 ? parts : [value];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function sampleInputForUnsafeOutput(routeKey: AiProviderInput["routeKey"]): Record<string, unknown> {
  if (routeKey === "direction_to_jobs") {
    return {
      educationBackground: "市场营销",
      realExperiences: "课程调研项目",
      interestsOrAcceptables: "活动执行",
    };
  }
  if (routeKey === "experience_to_resume") {
    return {
      rawExperience: "社团活动",
      actualActions: "整理信息",
      deliverableOrResult: "活动清单",
    };
  }
  if (routeKey === "jd_to_revision") {
    return {
      jdTextOrRequirements: "整理岗位信息",
      userMaterial: "整理课程资料",
    };
  }
  return {
    applications: [{ jobTitle: "实习岗位", companyOrPlatform: "招聘平台" }],
  };
}
