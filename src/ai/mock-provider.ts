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

    return makeSuccessfulOutput(input.routeKey);
  }
}

function makeLightReviewOutput(input: AiProviderInput): RouteOutput {
  const record = input.input.record as { actualDone?: string } | undefined;
  const actualDone = record?.actualDone ?? "你保存了一条真实记录。";

  return {
    routeKey: input.routeKey,
    outputType: "light_review",
    shortAssessment: "这条记录可以先做一次轻复盘。",
    routeResult: {
      reviewBasis: [actualDone],
      clues: ["这一步已经从模糊想法变成了一条可回看的记录"],
      missingInfo: ["还可以补一项更具体的材料版本或事实依据"],
      nextAction: "下次先补这条记录里还缺的一项事实。",
    },
    missingInfo: null,
    todayAction: {
      actionTitle: "下次先补这条记录里还缺的一项事实",
      actionReason: "先让记录更完整，后续复盘才更可靠。",
      actionSteps: ["打开这条记录", "补 1 项真实事实", "保存修改"],
      estimatedTime: "15-30 分钟",
      recordAfterDone: "记录补充的事实和仍不确定的地方。",
      actionType: "fill_info",
    },
    recordGuide: {
      recordType: "fill_info",
      fieldsToRecord: ["missingFact"],
      requiresUserConfirmation: true,
    },
  };
}

function makeSuccessfulOutput(routeKey: AiProviderInput["routeKey"]): RouteOutput {
  if (routeKey === "direction_to_jobs") {
    return {
      routeKey,
      outputType: "route_result",
      shortAssessment: "可以先把方向落到真实岗位样本。",
      routeResult: {
        explorableDirections: [
          {
            directionName: "内容运营",
            searchKeywords: ["内容运营实习", "新媒体运营实习", "社群运营助理"],
            basisFromUserMaterial: ["有内容整理或社团经历"],
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
    return {
      routeKey,
      outputType: "route_result",
      shortAssessment: "这段经历已经能先整理实际动作。",
      routeResult: {
        confirmedFacts: ["已提供经历和实际动作"],
        missingFacts: ["还可以补充对象或交付物"],
        doNotExaggerate: ["不要把协助写成负责"],
        resumeSnippetDraft: "参与活动资料整理，协助完成报名信息汇总。",
        supportingFacts: ["整理报名表"],
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
    return {
      routeKey,
      outputType: "route_result",
      shortAssessment: "这里先看材料和 JD 的支撑关系，不评价你本人适不适合。",
      routeResult: {
        jdKeyRequirements: ["内容整理", "沟通协作", "基础数据记录"],
        supportedByMaterial: ["材料里能看到内容整理经历"],
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
    return {
      routeKey,
      outputType: "route_result",
      shortAssessment: "先基于真实投递记录看一个可能线索。",
      routeResult: {
        reviewBasis: ["最近补充的投递记录"],
        recordSufficiency: "enough",
        possibleClues: ["部分记录还缺材料版本，后续不好判断修改是否有效"],
        informationGaps: ["JD 摘要", "使用的材料版本"],
        nextValidationAction: "补齐 1 条投递记录的材料版本",
      },
      missingInfo: null,
      todayAction: {
        actionTitle: "今天先选择 1 条投递记录补齐材料版本",
        actionReason: "先让这条记录可复盘，再判断下一轮怎么调整。",
        actionSteps: ["选最近一条投递", "补岗位要求摘要", "补当时使用的材料版本"],
        estimatedTime: "15-30 分钟",
        recordAfterDone: "记录岗位、公司或平台、投递时间、材料版本和反馈状态。",
        actionType: "application_record",
      },
      recordGuide: {
        recordType: "application",
        fieldsToRecord: ["jobTitle", "companyOrPlatform", "submittedAt", "materialVersion", "feedbackStatus"],
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
      actionReason: "补完这一项后，系统才能继续整理下一步。",
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
    ...makeSuccessfulOutput(routeKey),
    shortAssessment: "匹配度 90%，录取概率很高。",
  };
}
