import { AiProviderError, type AiProvider, type AiProviderInput, type AiProviderScenario } from "@/ai/provider";
import { selectJobTaxonomyDirections } from "@/domain/job-taxonomy";
import { classifyJdMaterialEvidence } from "@/domain/jd-action-clarity";
import { buildJdEvidenceCatalog } from "@/domain/jd-evidence-contract";
import { isJdRequirementEvidenceRelationSupported } from "@/domain/jd-route-assembler";
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

    if (input.routeKey === "jd_to_revision" && input.deadlineAtMs !== undefined) {
      const narrow = makeJdDecisionCandidate(input);
      if (narrow) return narrow as RouteOutput;
    }

    return makeSuccessfulOutput(input);
  }
}

function makeLightReviewOutput(input: AiProviderInput): RouteOutput {
  const record = (input.input.record ??
    (Array.isArray(input.input.records) ? input.input.records[0] : undefined)) as {
    actualDone?: string;
    payload?: Record<string, unknown>;
  } | undefined;
  const actualDone = record?.actualDone ?? "你保存了一条真实记录。";
  const next = input.routeKey === "direction_to_jobs"
    ? directionLightReviewNextStep(record, actualDone)
    : lightReviewNextStep(input.routeKey);

  return {
    routeKey: input.routeKey,
    outputType: "light_review",
    shortAssessment: "这条记录可以先做一次轻复盘。",
    routeResult: {
      reviewBasis: collectLightReviewBasis(
        input.routeKey,
        actualDone,
        record?.payload,
        Array.isArray(input.input.records) ? input.input.records : [],
      ),
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

function directionLightReviewNextStep(
  record: { actualDone?: string; payload?: Record<string, unknown> } | undefined,
  actualDone: string,
): ReturnType<typeof lightReviewNextStep> {
  const payloadAnchor = record?.payload
    ? Object.values(record.payload).map(readText).find(Boolean)
    : undefined;
  const anchor = readText(record?.payload?.jobTitle) || payloadAnchor || actualDone;
  return {
    actionTitle: `打开“${anchor}”对应的岗位样本并记录 1 条 JD 要求`,
    actionSteps: [
      `打开“${anchor}”对应的岗位样本`,
      `核对“${anchor}”对应岗位的 JD 要求`,
      `记录“${anchor}”对应岗位的 1 条 JD 摘要`,
    ],
    recordAfterDone: `记录“${anchor}”对应岗位的名称、公司或平台和 JD 摘要。`,
    actionType: "job_sample",
    recordType: "job_sample",
    fieldsToRecord: ["jobTitle", "companyOrPlatform", "jdSummary", "interestPoint", "concernPoint"],
  };
}

function collectLightReviewBasis(
  routeKey: AiProviderInput["routeKey"],
  actualDone: string,
  payload?: Record<string, unknown>,
  records: unknown[] = [],
): string[] {
  if (routeKey !== "applications_to_review" || !payload) {
    return [actualDone];
  }

  const persistedJobTitles = records
    .map((item) => isRecord(item) && isRecord(item.payload)
      ? readText(item.payload.jobTitle)
      : "")
    .filter(Boolean);
  if (persistedJobTitles.length > 0) {
    return [actualDone, ...persistedJobTitles].slice(0, 3);
  }

  const applications = ["", "2"]
    .map((suffix) => readText(payload[`jobTitle${suffix}`]))
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
      fieldsToRecord: ["targetJobTitle", "beforeSnippet", "afterSnippet", "jdRequirement", "submitted"],
    };
  }
  return {
    actionTitle: "下一步先补 1 条最低字段投递记录",
    actionSteps: ["选最近一条投递", "补岗位、公司或平台、投递时间和反馈状态", "保存记录"],
    recordAfterDone: "记录岗位、公司或平台、投递时间和反馈状态。",
    actionType: "application_record",
    recordType: "application",
    fieldsToRecord: ["jobTitle", "companyOrPlatform", "submittedAt", "feedbackStatus", "jdSummary", "materialVersion"],
  };
}

function makeSuccessfulOutput(input: AiProviderInput): RouteOutput {
  const { routeKey } = input;
  if (routeKey === "direction_to_jobs") {
    const directions = selectJobTaxonomyDirections(
      compactTextValues([
        input.input.educationBackground,
        input.input.realExperiences,
        input.input.interestsOrAcceptables,
      ]).join(" "),
    );
    const basis = compactTextValues([
      input.input.educationBackground,
      input.input.realExperiences,
      input.input.interestsOrAcceptables,
      input.input.constraints,
    ]);
    return {
      routeKey,
      outputType: "route_result",
      shortAssessment: "可以先把方向落到真实岗位样本。",
      routeResult: {
        explorableDirections: directions.map((direction, index) => ({
            directionName: direction.directionName,
            searchKeywords: direction.searchKeywords,
            basisFromUserMaterial: basis,
            riskOrGap: "还缺真实 JD 样本验证",
            validationFocus: index === 0
              ? "可以先探索：观察岗位要求里反复出现的工具和交付物"
              : "可以先探索：观察岗位日常是否符合已知兴趣和限制",
          })),
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
    const evidenceKind = classifyJdMaterialEvidence(userMaterial);
    const requirement = requirements[0] ?? readText(input.input.jdTextOrRequirements);
    const revisionTarget = userMaterial || "当前材料中的相关经历段落";
    const hasDirectEvidence = evidenceKind === "direct";
    const evidenceCheck = hasDirectEvidence
      ? `打开与“${revisionTarget}”对应的项目文档、截图、版本记录或交付物，核对是否真的做过“${requirement}”相关动作。`
      : "打开这句能力总结对应的项目文档、截图、版本记录或交付物，核对是否有实际动作、使用工具和交付物。";
    return {
      routeKey,
      outputType: "route_result",
      shortAssessment: hasDirectEvidence
        ? "当前材料里已有可核对的实际动作，今天只处理这一处。"
        : "这段材料目前只有能力总结，先核对证据，不改简历。",
      routeResult: {
        jdKeyRequirements: requirements,
        supportedByMaterial: hasDirectEvidence ? [userMaterial] : [],
        unclearFromMaterial: hasDirectEvidence
          ? ["还看不出具体交付物"]
          : ["这是一句能力总结，尚不能证明实际做过对应的岗位动作。"],
        minimalRevisionActions: hasDirectEvidence
          ? [`只核对并保存“${revisionTarget}”这一处，不扩写未提供的结果。`]
          : ["暂不修改这句；先完成证据核对。"],
        afterSubmissionRecording: ["记录材料版本和投递时间"],
        revisionTarget,
        candidateRevision: hasDirectEvidence
          ? `${userMaterial.replace(/[。；;.!?]+$/, "")}。`
          : null,
        evidenceCheck,
      },
      missingInfo: null,
      todayAction: {
        actionTitle: hasDirectEvidence
          ? `核对并保存“${revisionTarget}”这一句`
          : "核对这句能力总结有没有原始证据",
        actionReason: hasDirectEvidence
          ? `这句已有实际动作，只需对照“${requirement}”核对一处。`
          : "这句话现在只是能力总结，不能直接当作已经发生的项目动作。",
        actionSteps: hasDirectEvidence
          ? [
              `打开材料并定位“${revisionTarget}”`,
              evidenceCheck,
              "证据一致时保存原句和候选句；不一致就保留原句并标记证据不足",
            ]
          : [
              evidenceCheck,
              "查找能证明该岗位要求的实际动作、工具和交付物",
              "找到就记录原句和证据；找不到就标记“证据不足”，不要修改简历",
            ],
        estimatedTime: "15-30 分钟",
        recordAfterDone: "记录核对的材料、找到的实际动作或“证据不足”；找到事实后再决定是否生成候选句。",
        completionStandard: "已保存 1 条核对结果：找到可核对事实，或明确记录“证据不足，暂不改材料”。",
        actionType: "jd_revision",
      },
      recordGuide: {
        recordType: "jd_compare",
        fieldsToRecord: ["targetJobTitle", "beforeSnippet", "afterSnippet", "jdRequirement", "submitted"],
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
        possibleClues: ["两条真实投递已经可以对照，但目前不能确认反馈差异由哪个因素造成，仍需验证"],
        informationGaps: ["还缺后续真实反馈"],
        nextValidationAction: "选 1 条投递记录，写下 1 个需要后续反馈验证的问题",
      },
      missingInfo: null,
      todayAction: {
        actionTitle: "今天先选 1 条投递记录，写下 1 个待验证问题",
        actionReason: "现有字段已经完整，下一步只提出一个需要真实反馈验证的问题，不先下结论。",
        actionSteps: [
          "选最近一条投递",
          "对照已记录的 JD 摘要、材料版本和反馈状态",
          "把自己的怀疑写成一个问题，并标明要等什么真实反馈来验证",
        ],
        estimatedTime: "15-30 分钟",
        recordAfterDone: "记录所选岗位、待验证问题和需要等待的真实反馈。",
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

function makeJdDecisionCandidate(input: AiProviderInput): unknown | null {
  const catalog = buildJdEvidenceCatalog({
    targetJobTitle: readText(input.input.targetJobTitle),
    jdTextOrRequirements: readText(input.input.jdTextOrRequirements),
    userMaterial: readText(input.input.userMaterial),
    currentQuestion: readText(input.input.currentQuestion),
  });
  if (catalog.requirements.length === 0 || catalog.materials.length === 0) return null;
  const selectedRequirementIds = catalog.requirements.map((source) => source.sourceId);
  const usedMaterialIds = new Set<string>();
  return {
    routeKey: "jd_to_revision",
    selectedRequirementIds,
    decisions: catalog.requirements.map((requirement) => {
      const material = catalog.materials.find((source) =>
        !usedMaterialIds.has(source.sourceId)
        && classifyJdMaterialEvidence(source.exactQuote) === "direct"
        && isJdRequirementEvidenceRelationSupported(
          requirement.exactQuote,
          source.exactQuote,
          "partial",
        )
      ) ?? null;
      if (material) usedMaterialIds.add(material.sourceId);
      return material ? {
        requirementId: requirement.sourceId,
        evidenceIds: [material.sourceId],
        relation: "partial",
        disposition: "replace",
        revisionTargetId: material.sourceId,
        candidate: makeGroundedMockRevision(material.exactQuote),
        reason: "仅使用这条材料中的可核对事实。",
        conflictSourceIds: null,
      } : {
        requirementId: requirement.sourceId,
        evidenceIds: [],
        relation: "unsupported",
        disposition: "collect_evidence",
        revisionTargetId: null,
        candidate: null,
        reason: "材料中没有该岗位要求的直接证据。",
        conflictSourceIds: null,
      };
    }),
  };
}

function makeGroundedMockRevision(material: string): string {
  const separator = material.search(/[：，]/);
  if (separator < 0) return material;
  const revision = material.slice(separator + 1).trim();
  return revision.length >= 6 ? revision : material;
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
