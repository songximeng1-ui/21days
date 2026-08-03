import { describe, expect, it } from "vitest";
import { MockAiProvider } from "@/ai/mock-provider";
import { generateRouteOutput } from "@/ai/orchestrator";
import { attachOutputProvenance } from "@/domain/provenance";
import { routeOutputWithProvenanceSchema } from "@/schemas/route-output";

const experienceInput = {
  targetDirection: "内容运营",
  rawExperience: "协助整理社团活动报名信息",
  actualActions: "核对报名表并整理名单",
  deliverableOrResult: "保存了一份报名名单",
};

const applicationsInput = {
  applications: [
    {
      jobTitle: "内容运营实习生",
      companyOrPlatform: "A 公司",
      submittedAt: "2026-07-01",
      feedbackStatus: "暂无反馈",
      jdSummary: "内容整理",
      materialVersion: "社团经历版",
    },
    {
      jobTitle: "运营助理",
      companyOrPlatform: "B 公司",
      submittedAt: "2026-07-03",
      feedbackStatus: "已查看",
      jdSummary: "信息维护",
      materialVersion: "项目经历版",
    },
  ],
};

describe("fact provenance adversarial matrix", () => {
  it("grounds an empty-input missing-information action in the observed missing field", async () => {
    const output = await generateRouteOutput({
      routeKey: "direction_to_jobs",
      input: {},
    });

    expect(output.outputType).toBe("missing_info");
    expect(routeOutputWithProvenanceSchema.safeParse(output).success).toBe(true);
    const missingClaim = output.provenance?.["missingInfo.missingFields.0"];
    expect(missingClaim).toMatchObject({
      kind: "fact",
      sources: [{
        sourceType: "user_input",
        path: expect.any(String),
        quote: "未提供",
      }],
    });
  });

  it.each([
    "使用 Python 整理 1000 条用户数据。",
    "使用 Salesforce 建立客户台账。",
    "使用飞书制作日报并维护客户信息。",
    "推动阅读量增长 30%。",
    "获得校级一等奖学金。",
    "在清华大学负责用户研究。",
  ])("rejects an unsupported resume fact: %s", async (resumeSnippetDraft) => {
    const output = await new MockAiProvider("success").generate({
      routeKey: "experience_to_resume",
      input: experienceInput,
    });
    const result = attachOutputProvenance(
      {
        ...output,
        routeResult: { ...output.routeResult, resumeSnippetDraft },
      },
      experienceInput,
    );

    expect(result.ok).toBe(false);
  });

  it.each([
    "待验证线索：A 公司可能更偏好 985 院校学生。",
    "可能需要验证：B 公司是否偏好本地户籍。",
    "待验证线索：两家公司可能只接受硕士学历。",
    "可能需要验证：A 公司是否更偏好男性候选人。",
    "待验证线索：B 公司可能要求党员身份。",
  ])("rejects an unsupported company or school preference: %s", async (clue) => {
    const output = await new MockAiProvider("success").generate({
      routeKey: "applications_to_review",
      input: applicationsInput,
    });
    const result = attachOutputProvenance(
      {
        ...output,
        routeResult: { ...output.routeResult, possibleClues: [clue] },
      },
      applicationsInput,
    );

    expect(result.ok).toBe(false);
  });

  it("keeps inference separate while binding every visible leaf to a safe source path", async () => {
    const output = await new MockAiProvider("success").generate({
      routeKey: "experience_to_resume",
      input: experienceInput,
    });
    const result = attachOutputProvenance(output, experienceInput);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const claim of Object.values(result.output.provenance ?? {})) {
      expect(["fact", "inference"]).toContain(claim.kind);
      if (claim.kind === "fact") expect(claim.sources.length).toBeGreaterThan(0);
      expect(claim.sources.every((source) => source.path && source.quote.length <= 12)).toBe(true);
    }
  });

  it.each([
    {
      mutate: (output: Awaited<ReturnType<MockAiProvider["generate"]>>) => ({
        ...output,
        shortAssessment: "用户拥有三年海外市场经验。",
      }),
    },
    {
      mutate: (output: Awaited<ReturnType<MockAiProvider["generate"]>>) => ({
        ...output,
        routeResult: {
          ...output.routeResult,
          missingFacts: ["用户缺乏海外市场经验。"],
        },
      }),
    },
    {
      mutate: (output: Awaited<ReturnType<MockAiProvider["generate"]>>) => ({
        ...output,
        todayAction: {
          ...output.todayAction,
          actionReason: "A 公司明确要求海外工作经验。",
        },
      }),
    },
  ])("rejects unsupported facts outside the primary fact arrays", async ({ mutate }) => {
    const output = await new MockAiProvider("success").generate({
      routeKey: "experience_to_resume",
      input: experienceInput,
    });

    expect(attachOutputProvenance(mutate(output), experienceInput).ok).toBe(false);
  });

  it("binds a long fact only to source fields that actually support it", async () => {
    const output = await new MockAiProvider("success").generate({
      routeKey: "experience_to_resume",
      input: experienceInput,
    });
    const fact = "核对报名表并整理名单";
    const result = attachOutputProvenance(
      {
        ...output,
        routeResult: {
          ...output.routeResult,
          confirmedFacts: [fact],
          supportingFacts: [fact],
          resumeSnippetDraft: `${fact}。`,
        },
      },
      experienceInput,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.provenance?.["routeResult.confirmedFacts.0"].sources).toEqual([
      expect.objectContaining({ path: "actualActions" }),
    ]);
  });

  it("rejects a factual leaf when there is no source at all", async () => {
    const output = await new MockAiProvider("success").generate({
      routeKey: "experience_to_resume",
      input: experienceInput,
    });
    expect(attachOutputProvenance(output, {}).ok).toBe(false);
  });

  it("keeps confirmed-record identity and version on review sources", async () => {
    const record = {
      id: "record-1",
      version: 3,
      actualDone: "核对并保存了一份报名名单",
      payload: { actualActions: "核对报名表并整理名单" },
    };
    const output = await new MockAiProvider("success").generate({
      routeKey: "experience_to_resume",
      input: experienceInput,
    });
    const result = attachOutputProvenance(
      {
        ...output,
        routeResult: {
          ...output.routeResult,
          confirmedFacts: ["核对报名表并整理名单"],
          supportingFacts: ["核对报名表并整理名单"],
          resumeSnippetDraft: "核对报名表并整理名单。",
        },
      },
      record,
      "confirmed_record",
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const refs = Object.values(result.output.provenance ?? {}).flatMap((claim) => claim.sources);
    expect(refs.every((ref) => ref.recordId === "record-1" && ref.recordVersion === 3)).toBe(true);
  });

  it.each([
    {
      routeKey: "jd_to_revision" as const,
      input: {
        targetJobTitle: "Backend developer",
        jdTextOrRequirements: "Communication",
        userMaterial: "Communication",
      },
      path: "routeResult.minimalRevisionActions.0",
      mutate: (output: Awaited<ReturnType<MockAiProvider["generate"]>>) => ({
        ...output,
        routeResult: {
          ...output.routeResult,
          minimalRevisionActions: ["User has Kubernetes production experience"],
        },
      }),
    },
    {
      routeKey: "applications_to_review" as const,
      input: applicationsInput,
      path: "routeResult.informationGaps.0",
      mutate: (output: Awaited<ReturnType<MockAiProvider["generate"]>>) => ({
        ...output,
        routeResult: {
          ...output.routeResult,
          informationGaps: ["A company explicitly requires a masters degree"],
        },
      }),
    },
    {
      routeKey: "experience_to_resume" as const,
      input: experienceInput,
      path: "todayAction.actionReason",
      mutate: (output: Awaited<ReturnType<MockAiProvider["generate"]>>) => ({
        ...output,
        todayAction: {
          ...output.todayAction,
          actionReason: "You completed 100 applications",
        },
      }),
    },
  ])(
    "rejects a factual assertion outside the old fact allowlist at $path",
    async ({ routeKey, input, mutate }) => {
      const output = await new MockAiProvider("success").generate({
        routeKey,
        input,
      });

      expect(attachOutputProvenance(mutate(output), input).ok).toBe(false);
    },
  );

  it.each([
    {
      path: "shortAssessment",
      mutate: (output: Awaited<ReturnType<MockAiProvider["generate"]>>) => ({
        ...output,
        shortAssessment: "The candidate speaks fluent French.",
      }),
    },
    {
      path: "todayAction.actionReason",
      mutate: (output: Awaited<ReturnType<MockAiProvider["generate"]>>) => ({
        ...output,
        todayAction: {
          ...output.todayAction,
          actionReason: "The candidate speaks fluent French.",
        },
      }),
    },
  ])("defaults an unknown factual verb to fact at $path", async ({ mutate }) => {
    const output = await new MockAiProvider("success").generate({
      routeKey: "experience_to_resume",
      input: experienceInput,
    });

    expect(attachOutputProvenance(mutate(output), experienceInput).ok).toBe(false);
  });

  it("rejects a new action hidden inside a mostly matching factual sentence", async () => {
    const input = {
      targetDirection: "Operations",
      rawExperience: "Registration support",
      actualActions: "Checked registration form and organized attendee list",
      deliverableOrResult: "Saved attendee list",
    };
    const output = await new MockAiProvider("success").generate({
      routeKey: "experience_to_resume",
      input,
    });

    const result = attachOutputProvenance(
      {
        ...output,
        routeResult: {
          ...output.routeResult,
          confirmedFacts: ["Checked registration form"],
          supportingFacts: ["organized attendee list"],
          resumeSnippetDraft: "Checked registration form and analyzed attendee list",
        },
      },
      input,
    );

    expect(result).toEqual({
      ok: false,
      unsupportedPath: "routeResult.resumeSnippetDraft",
    });
  });

  it.each([
    {
      source: "Used Excel to organize 5 application records",
      claim: "Used Excel and Tableau to organize 5 application records",
    },
    {
      source: "Used Excel to organize 5 application records",
      claim: "Used Excel to organize 50 application records",
    },
    {
      source: "Submitted to A company",
      claim: "Submitted to A company and B company",
    },
  ])("rejects an unsupported atomic addition: $claim", async ({ source, claim }) => {
    const input = {
      targetDirection: "Operations",
      rawExperience: source,
      actualActions: source,
      deliverableOrResult: source,
    };
    const output = await new MockAiProvider("success").generate({
      routeKey: "experience_to_resume",
      input,
    });

    expect(
      attachOutputProvenance(
        {
          ...output,
          routeResult: {
            ...output.routeResult,
            confirmedFacts: [source],
            supportingFacts: [source],
            resumeSnippetDraft: claim,
          },
        },
        input,
      ).ok,
    ).toBe(false);
  });

  it("rejects inference when it cannot name any grounded fact claim it derives from", () => {
    const result = attachOutputProvenance(
      {
        routeKey: "experience_to_resume",
        outputType: "friendly_failure",
        shortAssessment: "Could not determine a result yet",
        routeResult: null,
        missingInfo: null,
        todayAction: {
          actionTitle: "Try again later",
          actionReason: "No grounded result is available",
          actionSteps: ["Return later"],
          estimatedTime: "Later",
          recordAfterDone: "Keep the draft",
          actionType: "fill_info",
        },
        recordGuide: {
          recordType: "fill_info",
          fieldsToRecord: ["draft"],
          requiresUserConfirmation: true,
        },
      },
      {},
    );

    expect(result).toEqual({
      ok: false,
      unsupportedPath: "shortAssessment",
    });
  });

  it("links a direction inference only to the fact claims in the same direction item", async () => {
    const input = {
      educationBackground: "普通本科市场营销专业",
      realExperiences: "整理过社团内容并协助校园活动执行",
      interestsOrAcceptables: "愿意尝试内容运营和活动执行",
      constraints: "不接受长期出差",
    };
    const output = await new MockAiProvider("success").generate({
      routeKey: "direction_to_jobs",
      input,
    });
    const result = attachOutputProvenance(output, input);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      result.output.provenance?.["routeResult.explorableDirections.0.riskOrGap"]
        .derivedFromClaims,
    ).toEqual([
      "routeResult.explorableDirections.0.basisFromUserMaterial.0",
      "routeResult.explorableDirections.0.basisFromUserMaterial.1",
      "routeResult.explorableDirections.0.basisFromUserMaterial.2",
      "routeResult.explorableDirections.0.basisFromUserMaterial.3",
    ]);
  });

  it("keeps each review source bound to its own nested record identity and version", () => {
    const records = [
      {
        id: "application-1",
        version: 2,
        actualDone: "Submitted to A company",
        payload: { jobTitle: "Content intern" },
      },
      {
        id: "application-2",
        version: 4,
        actualDone: "Submitted to B company",
        payload: { jobTitle: "Operations intern" },
      },
    ];
    const result = attachOutputProvenance(
      {
        routeKey: "applications_to_review",
        outputType: "light_review",
        shortAssessment: "Compare the two grounded records",
        routeResult: {
          reviewBasis: ["Submitted to A company", "Submitted to B company"],
          clues: ["Could compare the feedback"],
          missingInfo: ["Missing feedback details"],
          nextAction: "Check the feedback",
        },
        missingInfo: null,
        todayAction: {
          actionTitle: "Check the feedback",
          actionReason: "Use the two grounded records",
          actionSteps: ["Open both records"],
          estimatedTime: "15-30 minutes",
          recordAfterDone: "Save the feedback",
          actionType: "application_record",
        },
        recordGuide: {
          recordType: "application",
          fieldsToRecord: ["feedbackStatus"],
          requiresUserConfirmation: true,
        },
      },
      { records },
      "confirmed_record",
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.provenance?.["routeResult.reviewBasis.0"].sources).toEqual([
      expect.objectContaining({
        path: "records.0.actualDone",
        recordId: "application-1",
        recordVersion: 2,
      }),
    ]);
    expect(result.output.provenance?.["routeResult.reviewBasis.1"].sources).toEqual([
      expect.objectContaining({
        path: "records.1.actualDone",
        recordId: "application-2",
        recordVersion: 4,
      }),
    ]);
    const sourcePaths = Object.values(result.output.provenance ?? {}).flatMap((claim) =>
      claim.sources.map((source) => source.path),
    );
    expect(sourcePaths).not.toContain("records.0.id");
    expect(sourcePaths).not.toContain("records.0.version");
    expect(sourcePaths).not.toContain("records.1.id");
    expect(sourcePaths).not.toContain("records.1.version");
  });

  it("rejects a relationship assembled from facts that only occur in different records", () => {
    const records = [
      {
        id: "application-1",
        version: 2,
        actualDone: "Acme company requires SQL",
      },
      {
        id: "application-2",
        version: 4,
        actualDone: "Used Tableau",
      },
    ];
    const result = attachOutputProvenance(
      {
        routeKey: "applications_to_review",
        outputType: "light_review",
        shortAssessment: "Needs verification",
        routeResult: {
          reviewBasis: ["Acme company requires Tableau"],
          clues: ["Needs verification"],
          missingInfo: ["Needs verification"],
          nextAction: "Needs verification",
        },
        missingInfo: null,
        todayAction: {
          actionTitle: "Check the records",
          actionReason: "Needs verification",
          actionSteps: ["Compare the records"],
          estimatedTime: "15-30 minutes",
          recordAfterDone: "Save the comparison",
          actionType: "application_record",
        },
        recordGuide: {
          recordType: "application",
          fieldsToRecord: ["feedbackStatus"],
          requiresUserConfirmation: true,
        },
      },
      { records },
      "confirmed_record",
    );

    expect(result).toEqual({
      ok: false,
      unsupportedPath: "routeResult.reviewBasis.0",
    });
  });

  it("quotes the evidence fragment that supports the claim instead of the source prefix", () => {
    const result = attachOutputProvenance(
      {
        routeKey: "applications_to_review",
        outputType: "light_review",
        shortAssessment: "Needs verification",
        routeResult: {
          reviewBasis: ["Acme company"],
          clues: ["Needs verification"],
          missingInfo: ["Needs verification"],
          nextAction: "Needs verification",
        },
        missingInfo: null,
        todayAction: {
          actionTitle: "Check the record",
          actionReason: "Needs verification",
          actionSteps: ["Open the record"],
          estimatedTime: "15-30 minutes",
          recordAfterDone: "Save the result",
          actionType: "application_record",
        },
        recordGuide: {
          recordType: "application",
          fieldsToRecord: ["feedbackStatus"],
          requiresUserConfirmation: true,
        },
      },
      {
        id: "application-1",
        version: 7,
        actualDone: "This preamble is unrelated then Acme company",
      },
      "confirmed_record",
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.provenance?.["routeResult.reviewBasis.0"].sources).toEqual([
      expect.objectContaining({
        quote: "Acme company",
        recordId: "application-1",
        recordVersion: 7,
      }),
    ]);
  });

  it("treats an explicit add-more prompt as inference in a partial application flow", () => {
    const input = {
      applications: [{
        jobTitle: "内容运营实习",
        companyOrPlatform: "A 公司",
        submittedAt: "7 月 1 日",
        feedbackStatus: "暂无反馈",
      }],
    };
    const result = attachOutputProvenance(
      {
        routeKey: "applications_to_review",
        outputType: "missing_info",
        shortAssessment: "第 1 条投递已经有最低记录，再补两项就能用于对照复盘。",
        routeResult: null,
        missingInfo: {
          cannotJudge: "这条投递使用的材料是否支撑岗位要求",
          alreadyKnown: [
            "岗位名称：内容运营实习",
            "公司或平台：A 公司",
            "投递时间：7 月 1 日",
          ],
          missingFields: ["第 1 条投递的 JD 摘要", "第 1 条投递的材料版本"],
        },
        todayAction: {
          actionTitle: "今天先补第 1 条投递的 JD 摘要和材料版本",
          actionReason: "这两项能让下一次复盘基于真实岗位要求和真实材料版本。",
          actionSteps: ["打开这条投递对应的岗位页面", "写下 JD 摘要"],
          estimatedTime: "15-30 分钟",
          recordAfterDone: "记录 JD 摘要和材料版本。",
          actionType: "fill_info",
        },
        recordGuide: {
          recordType: "application",
          fieldsToRecord: ["jdSummary", "materialVersion"],
          requiresUserConfirmation: true,
        },
      },
      input,
    );

    expect(result.ok, result.ok ? undefined : result.unsupportedPath).toBe(true);
  });
});
