import { describe, expect, it, vi } from "vitest";
import { ChatCompletionProvider, createAiProviderFromEnv } from "@/ai/chat-completion-provider";
import { AiProviderError, type AiProviderInput } from "@/ai/provider";
import { MockAiProvider } from "@/ai/mock-provider";
import type { RouteKey } from "@/domain/types";
import { isRouteInputSufficient } from "@/domain/routes";
import { routeOutputSchema } from "@/schemas/route-output";

const validOutput = {
  routeKey: "experience_to_resume",
  outputType: "route_result",
  shortAssessment: "先把这段经历整理成真实动作。",
  routeResult: {
    confirmedFacts: ["组织过报名信息"],
    missingFacts: ["还缺交付物数量"],
    doNotExaggerate: ["不要写成独立负责"],
    resumeSnippetDraft: "协助整理活动报名信息。",
    supportingFacts: ["报名表整理"],
  },
  missingInfo: null,
  todayAction: {
    actionTitle: "今天先确认这段经历的 3 个真实动作",
    actionReason: "事实边界清楚后，简历表述才可靠。",
    actionSteps: ["列出动作", "标出交付物", "删掉没做过的表述"],
    estimatedTime: "15-30 分钟",
    recordAfterDone: "记录动作、交付物和不确定信息。",
    actionType: "experience_fact",
  },
  recordGuide: {
    recordType: "experience_fact",
    fieldsToRecord: ["actualActions", "deliverable", "missingFacts"],
    requiresUserConfirmation: true,
  },
};

async function capturePrompt(input: AiProviderInput): Promise<string> {
  const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
    void _url;
    void _init;
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify(validOutput) } }],
      }),
      { status: 200 },
    );
  });
  const provider = new ChatCompletionProvider({
    apiKey: "test-key",
    baseUrl: "https://api.example.com",
    model: "test-model",
    fetchFn: fetchMock,
  });

  await provider.generate(input);

  const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
  const body = JSON.parse(requestInit.body as string) as {
    messages: Array<{ content: string }>;
  };
  return body.messages.map((message) => message.content).join("\n");
}

function parsePromptSection(prompt: string, begin: string, end: string): Record<string, unknown> {
  const section = prompt.split(begin)[1]?.split(end)[0]?.trim();
  if (!section) throw new Error(`Missing prompt section: ${begin}`);
  return JSON.parse(section) as Record<string, unknown>;
}

const routePromptCases: Array<{
  routeKey: RouteKey;
  input: Record<string, unknown>;
  routeResultFields: string[];
  actionType: string;
  recordType: string;
  fieldsToRecord: string[];
}> = [
  {
    routeKey: "direction_to_jobs",
    input: {
      educationBackground: "信息管理专业",
      realExperiences: "整理社团报名信息",
      interestsOrAcceptables: "不排斥内容整理",
      constraints: "暂不考虑夜班",
    },
    routeResultFields: ["explorableDirections", "directionName", "searchKeywords", "basisFromUserMaterial", "riskOrGap", "validationFocus"],
    actionType: "job_sample",
    recordType: "job_sample",
    fieldsToRecord: ["jobTitle", "companyOrPlatform", "jdSummary", "interestPoint", "concernPoint"],
  },
  {
    routeKey: "experience_to_resume",
    input: {
      targetDirection: "运营",
      rawExperience: "社团活动",
      actualActions: "整理报名表",
      deliverableOrResult: "报名名单",
    },
    routeResultFields: ["confirmedFacts", "missingFacts", "doNotExaggerate", "resumeSnippetDraft", "supportingFacts"],
    actionType: "experience_fact",
    recordType: "experience_fact",
    fieldsToRecord: ["actualActions", "deliverable", "missingFacts"],
  },
  {
    routeKey: "jd_to_revision",
    input: {
      targetJobTitle: "内容运营实习生",
      jdTextOrRequirements: "负责选题和数据记录",
      userMaterial: "整理社团推文并记录阅读数据",
    },
    routeResultFields: ["jdKeyRequirements", "supportedByMaterial", "unclearFromMaterial", "minimalRevisionActions", "afterSubmissionRecording"],
    actionType: "jd_revision",
    recordType: "jd_compare",
    fieldsToRecord: ["beforeSnippet", "afterSnippet", "jdRequirement", "submitted"],
  },
  {
    routeKey: "applications_to_review",
    input: {
      applications: [
        {
          jobTitle: "内容运营实习",
          companyOrPlatform: "A 公司",
          submittedAt: "7 月 1 日",
          feedbackStatus: "暂无反馈",
          jdSummary: "负责内容整理",
          materialVersion: "社团经历版",
        },
        {
          jobTitle: "新媒体运营实习",
          companyOrPlatform: "B 公司",
          submittedAt: "7 月 3 日",
          feedbackStatus: "已查看",
          jdSummary: "负责选题和数据记录",
          materialVersion: "项目经历版",
        },
      ],
    },
    routeResultFields: ["reviewBasis", "recordSufficiency", "possibleClues", "informationGaps", "nextValidationAction"],
    actionType: "application_record",
    recordType: "application",
    fieldsToRecord: ["jobTitle", "companyOrPlatform", "submittedAt", "feedbackStatus", "jdSummary", "materialVersion"],
  },
];

describe("ChatCompletionProvider", () => {
  it.each(routePromptCases)(
    "sends the complete forced result contract for $routeKey",
    async ({ routeKey, input, routeResultFields, actionType, recordType, fieldsToRecord }) => {
      const prompt = await capturePrompt({ routeKey, input });
      const contract = parsePromptSection(prompt, "ACTIVE_ROUTE_CONTRACT_BEGIN", "ACTIVE_ROUTE_CONTRACT_END") as {
        recordGuide: { fieldsToRecord: string[] };
      };
      const example = parsePromptSection(prompt, "ACTIVE_ROUTE_EXAMPLE_BEGIN", "ACTIVE_ROUTE_EXAMPLE_END") as {
        output: { recordGuide: { fieldsToRecord: string[] } };
      };

      expect(prompt).toContain("ACTIVE_ROUTE_CONTRACT_BEGIN");
      expect(prompt).toContain(`\"routeKey\": \"${routeKey}\"`);
      expect(prompt).toContain('\"outputType\": \"route_result\"');
      expect(prompt).toContain("routeResult 必须是非 null 对象");
      expect(prompt).toContain('\"missingInfo\": null');
      for (const field of routeResultFields) expect(prompt).toContain(`\"${field}\"`);
      expect(prompt).toContain(`\"actionType\": \"${actionType}\"`);
      expect(prompt).toContain(`\"recordType\": \"${recordType}\"`);
      expect(prompt).toContain('\"estimatedTime\": \"15-30 分钟\"');
      expect(prompt).toContain('\"requiresUserConfirmation\": true');
      expect(prompt).toContain("不得选择 missing_info、light_review 或 friendly_failure");
      expect(contract.recordGuide.fieldsToRecord).toEqual(fieldsToRecord);
      expect(example.output.recordGuide.fieldsToRecord).toEqual(fieldsToRecord);
    },
  );

  it("teaches the exact direction count and keyword bounds in the contract and example", async () => {
    const directionCase = routePromptCases[0];
    const prompt = await capturePrompt({ routeKey: directionCase.routeKey, input: directionCase.input });
    const contract = parsePromptSection(prompt, "ACTIVE_ROUTE_CONTRACT_BEGIN", "ACTIVE_ROUTE_CONTRACT_END") as {
      routeResult: { explorableDirections: Array<{ validationFocus: string }> };
    };
    const example = parsePromptSection(prompt, "ACTIVE_ROUTE_EXAMPLE_BEGIN", "ACTIVE_ROUTE_EXAMPLE_END") as {
      output: {
        routeResult: { explorableDirections: Array<{ searchKeywords: string[]; validationFocus: string }> };
      };
    };

    expect(prompt).toContain("2-3 direction items");
    expect(prompt).toContain("3-5 items");
    expect(contract.routeResult.explorableDirections[0]?.validationFocus).toContain("可以先探索");
    expect(example.output.routeResult.explorableDirections).toHaveLength(2);
    for (const direction of example.output.routeResult.explorableDirections) {
      expect(direction.searchKeywords).toHaveLength(3);
      expect(direction.validationFocus).toContain("可以先探索");
    }
  });

  it("uses two complete sufficient application records without teaching a time or material gap", async () => {
    const applicationCase = routePromptCases[3];
    const prompt = await capturePrompt({ routeKey: applicationCase.routeKey, input: applicationCase.input });
    const example = parsePromptSection(prompt, "ACTIVE_ROUTE_EXAMPLE_BEGIN", "ACTIVE_ROUTE_EXAMPLE_END") as {
      input: { applications: Array<Record<string, unknown>> };
      output: { routeResult: { recordSufficiency: string; informationGaps: string[]; nextValidationAction: string } };
    };
    const canonicalFields = applicationCase.fieldsToRecord;

    expect(example.input.applications).toHaveLength(2);
    expect(isRouteInputSufficient("applications_to_review", example.input)).toBe(true);
    for (const application of example.input.applications) {
      expect(Object.keys(application)).toEqual(canonicalFields);
      for (const field of canonicalFields) expect(application[field]).toEqual(expect.any(String));
    }
    expect(JSON.stringify(example.output.routeResult)).not.toMatch(/还缺投递时间|补齐.*投递.*时间|还缺.*材料版本/);
  });

  it("binds the application validation action to one current record and one small variable", async () => {
    const applicationCase = routePromptCases[3];
    const prompt = await capturePrompt({ routeKey: applicationCase.routeKey, input: applicationCase.input });
    const example = parsePromptSection(prompt, "ACTIVE_ROUTE_EXAMPLE_BEGIN", "ACTIVE_ROUTE_EXAMPLE_END") as {
      input: { applications: Array<{ jobTitle: string; materialVersion: string }> };
      output: { routeResult: { nextValidationAction: string } };
    };
    const nextAction = example.output.routeResult.nextValidationAction;

    expect(prompt).toContain("选择一条当前投递记录");
    expect(prompt).toContain("绑定该记录现有的 jobTitle 或 materialVersion");
    expect(prompt).toContain("只调整一个小变量");
    expect(nextAction).toContain(example.input.applications[0].jobTitle);
    expect(nextAction).toContain(example.input.applications[0].materialVersion);
    expect(nextAction).toContain("只调整");
    expect(nextAction).not.toMatch(/新增.*投递|等待.*投递|下一轮新增/);
  });

  it("states that JD support may be empty and must never be invented", async () => {
    const jdCase = routePromptCases[2];
    const prompt = await capturePrompt({ routeKey: jdCase.routeKey, input: jdCase.input });

    expect(prompt).toContain("supportedByMaterial 是 0-5 条 userMaterial 的严格逐字引用");
    expect(prompt).toContain("没有直接支撑时必须返回空数组");
  });

  it("keeps every direction output field tentative without repeating forbidden conclusion terms", async () => {
    const directionCase = routePromptCases[0];
    const prompt = await capturePrompt({ routeKey: directionCase.routeKey, input: directionCase.input });

    expect(prompt).toContain("方向内容必须使用“可以先探索”这种暂定表达");
    expect(prompt).toContain("所有输出字段都不得使用匹配、适合、录取、概率或强烈推荐类结论");
    expect(prompt).toContain("即使作为守则提醒，也不要在任何输出字段复述这些禁用术语名称");
  });

  it("forbids upgrading participation or assistance into stronger experience roles", async () => {
    const experienceCase = routePromptCases[1];
    const prompt = await capturePrompt({ routeKey: experienceCase.routeKey, input: experienceCase.input });

    expect(prompt).toContain("必须保留“参与”或“协助”的角色强度");
    expect(prompt).toContain("不得改写成“负责”“独立负责”“主导”或“独立完成”");
  });

  it("keeps application suspicions visibly user-authored and verification-oriented", async () => {
    const applicationCase = routePromptCases[3];
    const prompt = await capturePrompt({ routeKey: applicationCase.routeKey, input: applicationCase.input });

    expect(prompt).toContain("possibleClues 每一项必须包含不确定或待验证标记");
    expect(prompt).toContain("userSuspicion 只能标注为用户自己的怀疑或待验证线索");
    expect(prompt).toContain("不得改写成事实或失败原因");
  });

  it.each(routePromptCases)(
    "includes exactly one active-route contract/example for $routeKey",
    async ({ routeKey, input, routeResultFields }) => {
      const prompt = await capturePrompt({ routeKey, input });
      const otherCases = routePromptCases.filter((routeCase) => routeCase.routeKey !== routeKey);

      expect(prompt.match(/ACTIVE_ROUTE_CONTRACT_BEGIN/g)).toHaveLength(1);
      expect(prompt.match(/ACTIVE_ROUTE_EXAMPLE_BEGIN/g)).toHaveLength(1);
      for (const field of routeResultFields) expect(prompt).toContain(`\"${field}\"`);
      for (const other of otherCases) {
        expect(prompt).not.toContain(`\"routeKey\": \"${other.routeKey}\"`);
        for (const field of other.routeResultFields) expect(prompt).not.toContain(`\"${field}\"`);
      }
    },
  );

  it.each([
    {
      routeKey: "direction_to_jobs" as const,
      input: {
        educationBackground: "ALLOW_DIRECTION_EDUCATION",
        realExperiences: "ALLOW_DIRECTION_EXPERIENCE",
        interestsOrAcceptables: "ALLOW_DIRECTION_INTEREST",
        constraints: "ALLOW_DIRECTION_CONSTRAINT",
        privateNotes: "DENY_DIRECTION_PRIVATE",
      },
      allowed: ["ALLOW_DIRECTION_EDUCATION", "ALLOW_DIRECTION_EXPERIENCE", "ALLOW_DIRECTION_INTEREST", "ALLOW_DIRECTION_CONSTRAINT"],
      denied: "DENY_DIRECTION_PRIVATE",
      mapping: "basisFromUserMaterial",
    },
    {
      routeKey: "experience_to_resume" as const,
      input: {
        targetDirection: "ALLOW_EXPERIENCE_DIRECTION",
        rawExperience: "ALLOW_EXPERIENCE_RAW",
        actualActions: "ALLOW_EXPERIENCE_ACTION",
        deliverableOrResult: "ALLOW_EXPERIENCE_RESULT",
        privateNotes: "DENY_EXPERIENCE_PRIVATE",
      },
      allowed: ["ALLOW_EXPERIENCE_DIRECTION", "ALLOW_EXPERIENCE_RAW", "ALLOW_EXPERIENCE_ACTION", "ALLOW_EXPERIENCE_RESULT"],
      denied: "DENY_EXPERIENCE_PRIVATE",
      mapping: "confirmedFacts / supportingFacts",
    },
    {
      routeKey: "jd_to_revision" as const,
      input: {
        targetJobTitle: "ALLOW_JD_TITLE",
        jdTextOrRequirements: "ALLOW_JD_REQUIREMENT",
        userMaterial: "ALLOW_JD_MATERIAL",
        privateNotes: "DENY_JD_PRIVATE",
      },
      allowed: ["ALLOW_JD_REQUIREMENT", "ALLOW_JD_MATERIAL"],
      denied: "DENY_JD_PRIVATE",
      mapping: "jdKeyRequirements <- jdTextOrRequirements; supportedByMaterial <- userMaterial",
    },
    {
      routeKey: "applications_to_review" as const,
      input: {
        applications: [{ jobTitle: "ALLOW_APPLICATION_RECORD" }],
        privateNotes: "DENY_APPLICATION_PRIVATE",
      },
      allowed: ["ALLOW_APPLICATION_RECORD"],
      denied: "DENY_APPLICATION_PRIVATE",
      mapping: "reviewBasis <- applications",
    },
  ])("limits evidence sources and bans transformed quotes for $routeKey", async ({ routeKey, input, allowed, denied, mapping }) => {
    const prompt = await capturePrompt({ routeKey, input });
    const evidenceSection = prompt.split("ALLOWED_EVIDENCE_BEGIN")[1]?.split("ALLOWED_EVIDENCE_END")[0] ?? "";

    for (const value of allowed) expect(evidenceSection).toContain(value);
    expect(evidenceSection).not.toContain(denied);
    expect(prompt).toContain(mapping);
    expect(prompt).toContain("严格连续逐字引用同一个白名单来源值");
    expect(prompt).toContain("不得添加前缀或后缀");
    expect(prompt).toContain("不得跨字段拼接");
    expect(prompt).toContain("不得用同义词改写");
  });

  it("serializes only allow-listed corrective retry fields without replaying sensitive context", async () => {
    const input = {
      routeKey: "experience_to_resume" as const,
      input: {
        targetDirection: "运营",
        rawExperience: "COMPLETE_INPUT_SECRET",
        actualActions: "整理报名表",
        deliverableOrResult: "报名名单",
      },
      retryFeedback: {
        stage: "candidate_schema",
        code: "candidate_zod",
        schemaPaths: ["routeResult.confirmedFacts[0]"],
        previousOutput: "FIRST_FULL_CANDIDATE DeepSeek Qwen fallback prompt token API key stack trace 内部错误",
        providerName: "PROVIDER_SECRET",
        apiKey: "sk-secret-test-key",
        completeInput: "COMPLETE_INPUT_SECRET",
      },
    } as AiProviderInput;

    const prompt = await capturePrompt(input);
    const retrySection = prompt.split("RETRY_CORRECTION_BEGIN")[1]?.split("RETRY_CORRECTION_END")[0] ?? "";

    expect(retrySection).toContain('\"stage\": \"candidate_schema\"');
    expect(retrySection).toContain('\"code\": \"candidate_zod\"');
    expect(retrySection).toContain("routeResult.confirmedFacts[0]");
    expect(retrySection).not.toMatch(
      /FIRST_FULL_CANDIDATE|PROVIDER_SECRET|sk-secret-test-key|COMPLETE_INPUT_SECRET|DeepSeek|Qwen|fallback|prompt|token|API key|stack trace|内部错误/i,
    );
  });

  it("adds positive tentative regeneration guidance for a safety-boundary retry", async () => {
    const prompt = await capturePrompt({
      routeKey: "direction_to_jobs",
      input: {
        educationBackground: "DIRECTION_INPUT_SECRET",
        realExperiences: "整理社团报名信息",
        interestsOrAcceptables: "不排斥信息整理",
      },
      retryFeedback: {
        stage: "safety",
        code: "safety_boundary",
        previousOutput: "UNSAFE_CANDIDATE_SECRET",
        providerName: "PROVIDER_SECRET",
      },
    } as AiProviderInput);
    const retrySection = prompt.split("RETRY_CORRECTION_BEGIN")[1]?.split("RETRY_CORRECTION_END")[0] ?? "";

    expect(retrySection).toContain('\"stage\": \"safety\"');
    expect(retrySection).toContain('\"code\": \"safety_boundary\"');
    expect(retrySection).toContain("删除违规结论，只重新生成使用“可以先探索”表达、且有证据支撑的路线内容");
    expect(retrySection).not.toMatch(/UNSAFE_CANDIDATE_SECRET|PROVIDER_SECRET|DIRECTION_INPUT_SECRET/);
  });

  it.each(routePromptCases.slice(1))(
    "keeps direction-only wording out of $routeKey safety retries",
    async ({ routeKey, input }) => {
      const prompt = await capturePrompt({
        routeKey,
        input,
        retryFeedback: {
          stage: "safety",
          code: "safety_boundary",
          previousOutput: "UNSAFE_CANDIDATE_SECRET",
          providerName: "PROVIDER_SECRET",
        },
      } as AiProviderInput);
      const retrySection = prompt.split("RETRY_CORRECTION_BEGIN")[1]?.split("RETRY_CORRECTION_END")[0] ?? "";

      expect(retrySection).toContain("删除违规结论，重新生成有证据支撑、符合当前路线契约的内容");
      expect(retrySection).not.toContain("可以先探索");
      expect(retrySection).not.toMatch(/UNSAFE_CANDIDATE_SECRET|PROVIDER_SECRET/);
    },
  );

  it("keeps direction-only wording out of light-review safety retries", async () => {
    const prompt = await capturePrompt({
      routeKey: "direction_to_jobs",
      input: {
        mode: "light_review",
        record: {
          actualDone: "保存了一条岗位样本",
          payload: { jobTitle: "内容运营实习" },
          userConfirmed: true,
        },
      },
      retryFeedback: {
        stage: "safety",
        code: "safety_boundary",
        previousOutput: "UNSAFE_LIGHT_REVIEW_SECRET",
      },
    } as AiProviderInput);
    const retrySection = prompt.split("RETRY_CORRECTION_BEGIN")[1]?.split("RETRY_CORRECTION_END")[0] ?? "";

    expect(retrySection).toContain("删除违规结论，重新生成有证据支撑、符合当前路线契约的内容");
    expect(retrySection).not.toContain("可以先探索");
    expect(retrySection).not.toContain("UNSAFE_LIGHT_REVIEW_SECRET");
  });

  it("adds exact allowlisted evidence-copy guidance for a grounding retry", async () => {
    const prompt = await capturePrompt({
      routeKey: "direction_to_jobs",
      input: {
        educationBackground: "DIRECTION_INPUT_SECRET",
        realExperiences: "整理社团报名信息",
        interestsOrAcceptables: "不排斥信息整理",
      },
      retryFeedback: {
        stage: "grounding",
        code: "grounding_failure",
        previousOutput: "UNGROUNDED_CANDIDATE_SECRET",
        apiKey: "sk-secret-retry-key",
      },
    } as AiProviderInput);
    const retrySection = prompt.split("RETRY_CORRECTION_BEGIN")[1]?.split("RETRY_CORRECTION_END")[0] ?? "";

    expect(retrySection).toContain('\"stage\": \"grounding\"');
    expect(retrySection).toContain('\"code\": \"grounding_failure\"');
    expect(retrySection).toContain(
      "每个证据数组条目必须从一个 ALLOWED_EVIDENCE value 完整逐字复制，不得改写、添加前缀或后缀、跨字段合并",
    );
    expect(retrySection).not.toMatch(
      /UNGROUNDED_CANDIDATE_SECRET|sk-secret-retry-key|DIRECTION_INPUT_SECRET/,
    );
  });

  it("deep-picks only documented application fields for route input and evidence", async () => {
    const prompt = await capturePrompt({
      routeKey: "applications_to_review",
      input: {
        applications: [{
          jobTitle: "ALLOW_APP_TITLE",
          companyOrPlatform: "ALLOW_APP_COMPANY",
          submittedAt: "ALLOW_APP_TIME",
          feedbackStatus: "ALLOW_APP_STATUS",
          jdSummary: "ALLOW_APP_JD",
          materialVersion: "ALLOW_APP_VERSION",
          userSuspicion: "ALLOW_APP_SUSPICION",
          privateNotes: "DENY_APP_PRIVATE_NOTES",
          internalScore: "DENY_APP_INTERNAL_SCORE",
        }],
      },
    });
    const inputSection = prompt.split("ACTIVE_ROUTE_INPUT_BEGIN")[1]?.split("ACTIVE_ROUTE_INPUT_END")[0] ?? "";
    const evidenceSection = prompt.split("ALLOWED_EVIDENCE_BEGIN")[1]?.split("ALLOWED_EVIDENCE_END")[0] ?? "";

    for (const section of [inputSection, evidenceSection]) {
      expect(section).toContain("ALLOW_APP_TITLE");
      expect(section).toContain("ALLOW_APP_COMPANY");
      expect(section).toContain("ALLOW_APP_TIME");
      expect(section).toContain("ALLOW_APP_STATUS");
      expect(section).toContain("ALLOW_APP_JD");
      expect(section).toContain("ALLOW_APP_VERSION");
      expect(section).toContain("ALLOW_APP_SUSPICION");
      expect(section).not.toMatch(/DENY_APP_PRIVATE_NOTES|DENY_APP_INTERNAL_SCORE|privateNotes|internalScore/);
    }
  });

  it("sends a JSON-only chat completion request and parses the model response", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
      void _url;
      void _init;
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify(validOutput),
              },
            },
          ],
        }),
        { status: 200 },
      );
    });
    const provider = new ChatCompletionProvider({
      apiKey: "test-key",
      baseUrl: "https://api.example.com",
      model: "test-model",
      fetchFn: fetchMock,
    });

    const result = await provider.generate({
      routeKey: "experience_to_resume",
      input: {
        targetDirection: "运营",
        rawExperience: "社团活动",
        actualActions: "整理报名表",
        deliverableOrResult: "报名名单",
      },
    });

    expect(result.todayAction.actionType).toBe("experience_fact");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-key",
          "Content-Type": "application/json",
        }),
      }),
    );
    const firstCall = fetchMock.mock.calls[0];
    expect(firstCall).toBeDefined();
    const requestInit = firstCall?.[1] as RequestInit;
    const body = JSON.parse(requestInit.body as string);
    expect(body.model).toBe("test-model");
    expect(body.max_tokens).toBe(1000);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(JSON.stringify(body.messages)).toContain("只返回 JSON");
    expect(JSON.stringify(body.messages)).toContain("confirmedFacts");
    expect(JSON.stringify(body.messages)).toContain("resumeSnippetDraft");
    expect(JSON.stringify(body.messages)).toContain("supportingFacts");
    expect(JSON.stringify(body.messages)).toContain("只能逐字引用用户输入中的事实");
  });

  it("adds dedicated light review constraints to light review requests", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
      void _url;
      void _init;
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  ...validOutput,
                  outputType: "light_review",
                  routeResult: {
                    reviewBasis: ["用户记录了一个真实行动"],
                    clues: ["这条记录可以继续补材料版本"],
                    missingInfo: ["还缺材料版本"],
                    nextAction: "下次先补材料版本",
                  },
                }),
              },
            },
          ],
        }),
        { status: 200 },
      );
    });
    const provider = new ChatCompletionProvider({
      apiKey: "test-key",
      baseUrl: "https://api.example.com",
      model: "test-model",
      fetchFn: fetchMock,
    });

    await provider.generate({
      routeKey: "applications_to_review",
      input: {
        mode: "light_review",
        record: {
          actualDone: "补了内容运营实习、A 公司、7 月 1 日投递、暂无反馈。",
          payload: { jobTitle: "内容运营实习" },
        },
      },
    });

    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(requestInit.body as string);
    const messages = JSON.stringify(body.messages);
    expect(messages).toContain("light_review");
    expect(messages).toContain("真实记录");
    expect(messages).toContain("reviewBasis");
    expect(messages).toContain("application_record");
    expect(messages).toContain("recordType: application");
  });

  it.each(routePromptCases)(
    "uses a schema-complete source-route contract for $routeKey light review prompts",
    async ({ routeKey, actionType, recordType, fieldsToRecord }) => {
      const prompt = await capturePrompt({
        routeKey,
        input: {
          mode: "light_review",
          record: { actualDone: "保存了一个真实行动", payload: { note: "已确认" } },
        },
      });
      const contract = parsePromptSection(prompt, "ACTIVE_ROUTE_CONTRACT_BEGIN", "ACTIVE_ROUTE_CONTRACT_END") as {
        routeKey: RouteKey;
        outputType: string;
        shortAssessment: string;
        routeResult: Record<string, unknown>;
        missingInfo: null;
        todayAction: {
          actionTitle: string;
          actionReason: string;
          actionSteps: string[];
          estimatedTime: string;
          recordAfterDone: string;
          actionType: string;
        };
        recordGuide: { recordType: string; fieldsToRecord: string[]; requiresUserConfirmation: boolean };
      };

      expect(contract.routeKey).toBe(routeKey);
      expect(contract.outputType).toBe("light_review");
      expect(contract.shortAssessment).toBe("string");
      expect(Object.keys(contract.routeResult)).toEqual(["reviewBasis", "clues", "missingInfo", "nextAction"]);
      expect(contract.missingInfo).toBeNull();
      expect(contract.todayAction).toEqual({
        actionTitle: "string",
        actionReason: "string",
        actionSteps: ["string (1-4 items)"],
        estimatedTime: "15-30 分钟",
        recordAfterDone: "string",
        actionType,
      });
      expect(contract.recordGuide).toEqual({ recordType, fieldsToRecord, requiresUserConfirmation: true });
    },
  );

  it.each(routePromptCases)(
    "uses a valid grounded complete $routeKey light review example",
    async ({ routeKey, actionType, recordType, fieldsToRecord }) => {
      const prompt = await capturePrompt({
        routeKey,
        input: {
          mode: "light_review",
          record: { actualDone: "保存了一个真实行动", payload: { note: "已确认" } },
        },
      });
      const example = parsePromptSection(prompt, "ACTIVE_ROUTE_EXAMPLE_BEGIN", "ACTIVE_ROUTE_EXAMPLE_END") as {
        input: { record: { actualDone: string; payload: Record<string, unknown> } };
        output: Record<string, unknown> & {
          routeResult: { reviewBasis: string[] };
          todayAction: { actionType: string };
          recordGuide: { recordType: string; fieldsToRecord: string[] };
        };
      };

      expect(routeOutputSchema.safeParse(example.output).success).toBe(true);
      expect(example.output).not.toEqual(
        parsePromptSection(prompt, "ACTIVE_ROUTE_CONTRACT_BEGIN", "ACTIVE_ROUTE_CONTRACT_END"),
      );
      expect(example.output.routeResult.reviewBasis).toEqual([example.input.record.actualDone]);
      expect(example.output.todayAction.actionType).toBe(actionType);
      expect(example.output.recordGuide).toMatchObject({ recordType, fieldsToRecord });
    },
  );

  it("teaches a direction light review to act on the current job sample immediately", async () => {
    const prompt = await capturePrompt({
      routeKey: "direction_to_jobs",
      input: {
        mode: "light_review",
        record: {
          actualDone: "保存了用户运营实习岗位样本",
          payload: {
            jobTitle: "用户运营实习",
            jdSummary: "用户社群维护",
            interestPoint: "活动执行",
          },
        },
      },
    });
    const example = parsePromptSection(prompt, "ACTIVE_ROUTE_EXAMPLE_BEGIN", "ACTIVE_ROUTE_EXAMPLE_END") as {
      input: {
        record: {
          actualDone: string;
          payload: { jobTitle: string; jdSummary: string; searchKeyword: string };
        };
      };
      output: {
        routeResult: { reviewBasis: string[]; nextAction: string };
        todayAction: {
          actionTitle: string;
          actionReason: string;
          actionSteps: string[];
          recordAfterDone: string;
        };
      };
    };
    const actionCopy = [
      example.output.routeResult.nextAction,
      example.output.todayAction.actionTitle,
      example.output.todayAction.actionReason,
      ...example.output.todayAction.actionSteps,
      example.output.todayAction.recordAfterDone,
    ].join("\n");

    expect(prompt).toContain("明确围绕当前岗位样本、搜索关键词或 JD");
    expect(prompt).toContain("立即可做的具体动词");
    expect(prompt).toContain("routeResult.nextAction 自身");
    expect(prompt).toContain("record.actualDone 或 record.payload");
    expect(prompt).toContain("todayAction.actionTitle 与 actionSteps");
    expect(prompt).toContain("不得把具体动词、路线词和记录锚点拆散到不同字段");
    expect(prompt).toContain("等待、以后或任何“后续再……”");
    expect(routeOutputSchema.safeParse(example.output).success).toBe(true);
    expect(example.output.routeResult.reviewBasis).toEqual([example.input.record.actualDone]);
    expect(actionCopy).toMatch(/打开|保存|记录|搜索|找到|选择|补|修改|填写|标出|复制|核对|整理|列出|确认/);
    expect(actionCopy).toMatch(/岗位|JD|关键词|搜索/);
    expect(actionCopy).toMatch(
      new RegExp(
        `${example.input.record.payload.jobTitle}|${example.input.record.payload.jdSummary}|${example.input.record.payload.searchKeyword}`,
      ),
    );
  });

  it("teaches an experience light review to advance the current confirmed experience record", async () => {
    const prompt = await capturePrompt({
      routeKey: "experience_to_resume",
      input: {
        mode: "light_review",
        record: {
          actualDone: "确认了社团招新经历",
          payload: {
            actualActions: "整理报名表",
            deliverable: "报名名单",
            missingFacts: "还缺报名人数",
          },
        },
      },
    });
    const example = parsePromptSection(prompt, "ACTIVE_ROUTE_EXAMPLE_BEGIN", "ACTIVE_ROUTE_EXAMPLE_END") as {
      input: { record: { actualDone: string; payload: Record<string, string> } };
      output: {
        routeResult: { nextAction: string };
        todayAction: {
          actionTitle: string;
          actionReason: string;
          actionSteps: string[];
          recordAfterDone: string;
        };
      };
    };
    const actionCopy = [
      example.output.routeResult.nextAction,
      example.output.todayAction.actionTitle,
      example.output.todayAction.actionReason,
      ...example.output.todayAction.actionSteps,
      example.output.todayAction.recordAfterDone,
    ].join("\n");
    const sourceValues = [
      example.input.record.actualDone,
      ...Object.values(example.input.record.payload),
    ];

    expect(prompt).toContain("围绕当前已确认记录中的经历、事实、动作、交付物或简历片段");
    expect(prompt).toContain("一项可以立即执行的具体补事实或克制简历动作");
    expect(actionCopy).toMatch(/经历|事实|动作|交付|简历/);
    expect(sourceValues.some((value) => actionCopy.includes(value))).toBe(true);
    expect(actionCopy).not.toContain("补充一项真实信息");
  });

  it("teaches an application light review to bind one current record and change one variable now", async () => {
    const prompt = await capturePrompt({
      routeKey: "applications_to_review",
      input: {
        mode: "light_review",
        record: {
          actualDone: "保存了内容运营实习投递记录",
          payload: {
            jobTitle: "内容运营实习",
            materialVersion: "社团经历版",
            feedbackStatus: "暂无反馈",
          },
        },
      },
    });
    const example = parsePromptSection(prompt, "ACTIVE_ROUTE_EXAMPLE_BEGIN", "ACTIVE_ROUTE_EXAMPLE_END") as {
      input: { record: { payload: { jobTitle: string; materialVersion: string } } };
      output: {
        routeResult: { nextAction: string };
        todayAction: {
          actionTitle: string;
          actionReason: string;
          actionSteps: string[];
          recordAfterDone: string;
        };
      };
    };
    const actionCopy = [
      example.output.routeResult.nextAction,
      example.output.todayAction.actionTitle,
      example.output.todayAction.actionReason,
      ...example.output.todayAction.actionSteps,
      example.output.todayAction.recordAfterDone,
    ].join("\n");

    expect(prompt).toContain("绑定当前 record.payload 中一个 jobTitle 或 materialVersion");
    expect(prompt).toContain("只调整一个变量并立即记录");
    expect(actionCopy).toMatch(
      new RegExp(`${example.input.record.payload.jobTitle}|${example.input.record.payload.materialVersion}`),
    );
    expect(actionCopy).toContain("只调整");
    expect(actionCopy).toContain("记录");
    expect(actionCopy).not.toMatch(/等待|新增.*投递|下一轮新增/);
  });

  it.each([
    {
      name: "transport",
      response: () => Promise.reject(new Error("network includes secret-test-key")),
      kind: "transport",
    },
    {
      name: "retryable HTTP",
      response: () => Promise.resolve(new Response("sensitive response body", { status: 503 })),
      kind: "retryable_http",
    },
    {
      name: "non-retryable HTTP",
      response: () => Promise.resolve(new Response("sensitive response body", { status: 400 })),
      kind: "non_retryable_http",
    },
    {
      name: "provider-envelope JSON",
      response: () => Promise.resolve(new Response("sensitive response body", { status: 200 })),
      kind: "envelope_json",
    },
    {
      name: "null provider envelope",
      response: () => Promise.resolve(new Response("null", { status: 200 })),
      kind: "envelope_json",
    },
    {
      name: "object content",
      response: () =>
        Promise.resolve(
          new Response(JSON.stringify({ choices: [{ message: { content: { unsafe: "shape" } } }] }), {
            status: 200,
          }),
        ),
      kind: "envelope_json",
    },
    {
      name: "numeric content",
      response: () =>
        Promise.resolve(
          new Response(JSON.stringify({ choices: [{ message: { content: 42 } }] }), { status: 200 }),
        ),
      kind: "envelope_json",
    },
    {
      name: "empty content",
      response: () =>
        Promise.resolve(
          new Response(JSON.stringify({ choices: [{ message: { content: "   " } }] }), { status: 200 }),
        ),
      kind: "empty_content",
    },
    {
      name: "model-content JSON",
      response: () =>
        Promise.resolve(
          new Response(JSON.stringify({ choices: [{ message: { content: "sensitive response body" } }] }), {
            status: 200,
          }),
        ),
      kind: "model_json",
    },
  ])("makes one HTTP request and exposes a sanitized $name error", async ({ response, kind }) => {
    const fetchMock = vi.fn(response);
    const provider = new ChatCompletionProvider({
      apiKey: "secret-test-key",
      baseUrl: "https://api.example.com?secret=query-value",
      model: "test-model",
      fetchFn: fetchMock,
    });
    const sensitiveInput = "sensitive user input";

    const error = await provider
      .generate({
        routeKey: "experience_to_resume",
        input: {
          targetDirection: sensitiveInput,
          rawExperience: "sensitive prompt material",
          actualActions: "整理报名表",
          deliverableOrResult: "报名名单",
        },
      })
      .catch((caught: unknown) => caught);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(error).toBeInstanceOf(AiProviderError);
    expect((error as AiProviderError).kind).toBe(kind);
    const serialized = JSON.stringify({
      ...(error as object),
      name: (error as Error).name,
      message: (error as Error).message,
    });
    expect(serialized).not.toMatch(
      /secret-test-key|sensitive user input|sensitive prompt material|Authorization|sensitive response body|query-value/i,
    );
  });

  it("returns an explicit primary/fallback provider set whose generate call is single-attempt", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("primary failure", { status: 503 }));
    const provider = createAiProviderFromEnv(
      {
        DEEPSEEK_API_KEY: "deepseek-key",
        DEEPSEEK_BASE_URL: "https://deepseek.example.com",
        QWEN_API_KEY: "qwen-key",
        QWEN_BASE_URL: "https://qwen.example.com/compatible-mode/v1",
      },
      fetchMock,
    );

    await expect(
      provider.generate({
        routeKey: "experience_to_resume",
        input: {
          targetDirection: "运营",
          rawExperience: "社团活动",
          actualActions: "整理报名表",
          deliverableOrResult: "报名名单",
        },
      }),
    ).rejects.toMatchObject({ kind: "retryable_http" });

    expect(provider).toMatchObject({ primary: expect.anything(), fallback: expect.anything() });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to mock provider in non-production when DeepSeek is not configured", () => {
    const provider = createAiProviderFromEnv({ NODE_ENV: "development" });

    expect(provider).toBeInstanceOf(MockAiProvider);
  });

  it("returns provider failure in production when DeepSeek is not configured", async () => {
    const provider = createAiProviderFromEnv({ NODE_ENV: "production" });

    await expect(
      provider.generate({
        routeKey: "experience_to_resume",
        input: {},
      }),
    ).rejects.toThrow();
  });
});
