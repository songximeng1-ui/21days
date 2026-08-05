import { describe, expect, it } from "vitest";
import { assembleJdRouteOutput, buildJdEvidenceCatalog } from "@/domain/jd-route-assembler";
import { jdMappingCandidateSchema } from "@/schemas/jd-mapping-candidate";
import { generateRouteOutput } from "@/ai/orchestrator";

const aiProductOpsInput = {
  targetJobTitle: "AI产品运营",
  jdTextOrRequirements: [
    "负责产品日常运维、体验优化和全生命周期管理",
    "熟练使用 Office 及主流数据分析工具，完成产品数据整理、分析和复盘",
    "主导业务流程梳理优化，并协同研发设计",
    "推进项目并识别风险",
    "理解 AI 场景，能输出产品方案和 PRD",
  ].join("\n"),
  userMaterial: [
    "特斯拉销售专员 2024.06–12：接待；客户开发（最高跟进17，成交9，转化52.94%）；客情维护；抖音运营/直播（引流+30%，13条、10万+、全国门店第3/91）。",
    "独自用 Codex 做应届生求职地图 MVP，走完 PM→UX→UI→研发→测试→上线全流程，解决筹码、投递、面试、下一步等痛点。",
  ].join("\n"),
  currentQuestion: "我看到岗位了，不知道投递前怎么改",
};

describe("JD narrow mapping contract", () => {
  it("accepts only requirement-to-material mappings, not a model-authored RouteOutput", () => {
    expect(jdMappingCandidateSchema.safeParse({
      routeKey: "jd_to_revision",
      mappings: [{
        requirementId: "req-2",
        materialId: "mat-1",
        candidate: "用真实转化和直播数据说明运营复盘基础。",
        reason: "材料有可核对的运营数据。",
        risk: "未提供具体数据分析工具。",
      }],
    }).success).toBe(true);
    expect(jdMappingCandidateSchema.safeParse({
      routeKey: "jd_to_revision",
      outputType: "route_result",
      todayAction: { actionTitle: "模型决定行动" },
    }).success).toBe(false);
  });

  it("assembles the exact AI product operations fixture without inventing tools, PRD, users, iterations, or collaboration", () => {
    const catalog = buildJdEvidenceCatalog(aiProductOpsInput);
    const output = assembleJdRouteOutput(aiProductOpsInput, {
      routeKey: "jd_to_revision",
      mappings: [
        {
          requirementId: "req-2",
          materialId: "mat-1",
          candidate: "基于客户开发与抖音直播记录，复盘最高跟进17、成交9、转化52.94%及引流+30%的结果。",
          reason: "材料包含可核对的转化和运营数据。",
          risk: "未提供 Office 或主流数据分析工具使用证据。",
        },
        {
          requirementId: "req-5",
          materialId: "mat-2",
          candidate: "使用 Codex 完成应届生求职地图 MVP 从 PM、UX、UI、研发、测试到上线的全流程。",
          reason: "材料包含 AI 产品全流程证据。",
          risk: "没有 PRD 交付物证据。",
        },
      ],
    });

    expect(output.outputType).toBe("route_result");
    expect(output.routeResult?.revisionTarget).toBe(catalog.materials[0]?.quote);
    expect(output.routeResult?.jdKeyRequirements).toEqual([
      catalog.requirements[1]?.quote,
      catalog.requirements[4]?.quote,
    ]);
    expect(output.routeResult?.supportedByMaterial).toEqual([
      catalog.materials[0]?.quote,
      catalog.materials[1]?.quote,
    ]);
    expect(JSON.stringify(output)).not.toMatch(/用户数|迭代\s*\d|跨团队协作/);
    expect(output.routeResult?.candidateRevision).not.toMatch(/Office|SQL|Python|Tableau|Power\s*BI|PRD|协同研发设计|独立完成/);
    expect((output.routeResult?.unclearFromMaterial as string[]).join(" ")).toMatch(/数据分析工具|PRD/);
  });

  it("keeps a JD quote containing 主导 but drops an unsupported candidate role upgrade", () => {
    const input = {
      targetJobTitle: "产品运营",
      jdTextOrRequirements: "主导业务流程梳理优化，并协同研发设计",
      userMaterial: "用 Codex 做应届生求职地图 MVP，完成测试和上线。",
      currentQuestion: "怎么改",
    };
    const output = assembleJdRouteOutput(input, {
      routeKey: "jd_to_revision",
      mappings: [{
        requirementId: "req-1",
        materialId: "mat-1",
        candidate: "主导业务流程优化并协同研发设计，独立完成产品上线。",
        reason: "尝试对应岗位要求。",
        risk: "角色强度无证据。",
      }],
    });

    expect(output.routeResult?.jdKeyRequirements).toEqual([
      "主导业务流程梳理优化，并协同研发设计",
    ]);
    expect(output.routeResult?.candidateRevision).toBeNull();
    expect(JSON.stringify(output.routeResult?.minimalRevisionActions)).not.toMatch(
      /主导|负责|独立完成|协同研发设计/,
    );
  });

  it("splits one-line JD requirements while rejecting invented user scale and iteration counts", () => {
    const input = {
      targetJobTitle: "AI 产品运营",
      jdTextOrRequirements: "负责体验优化；推进项目并识别风险；输出产品方案",
      userMaterial: "用 Codex 做应届生求职地图 MVP，并完成测试和上线。",
      currentQuestion: "怎么改",
    };
    const catalog = buildJdEvidenceCatalog(input);
    expect(catalog.requirements.map((item) => item.quote)).toEqual([
      "负责体验优化",
      "推进项目并识别风险",
      "输出产品方案",
    ]);
    const output = assembleJdRouteOutput(input, {
      routeKey: "jd_to_revision",
      mappings: [{
        requirementId: "req-3",
        materialId: "mat-1",
        candidate: "服务数万用户并迭代数次，完成产品方案。",
        reason: "尝试对应产品方案。",
        risk: "用户规模和迭代次数无证据。",
      }],
    });
    expect(output.routeResult?.candidateRevision).toBeNull();
  });

  it("passes a narrow provider mapping through deterministic assembly, safety, grounding, and provenance", async () => {
    const events: unknown[] = [];
    const output = await generateRouteOutput({
      routeKey: "jd_to_revision",
      input: aiProductOpsInput,
      requestId: "req_jd_fixture",
      reporter: { report: async (event) => { events.push(event); } },
      provider: {
        generate: async () => ({
          routeKey: "jd_to_revision",
          mappings: [{
            requirementId: "req-5",
            materialId: "mat-2",
            candidate: "独自用 Codex 做应届生求职地图 MVP，走完 PM→UX→UI→研发→测试→上线全流程，解决筹码、投递、面试、下一步等痛点。",
            reason: "材料包含 AI 产品全流程事实。",
            risk: "未提供 PRD 交付物证据。",
          }],
        }),
      },
    }).catch((error) => {
      throw new Error(`${String(error)} events=${JSON.stringify(events)}`);
    });

    expect(output.outputType).toBe("route_result");
    expect(output.routeResult?.revisionTarget).toBe(
      buildJdEvidenceCatalog(aiProductOpsInput).materials[1]?.quote,
    );
    expect(output.provenance).toBeDefined();
    expect(JSON.stringify(output)).not.toMatch(/用户数|迭代\s*\d|跨团队协作|熟练使用.*数据分析工具/);
  });
});
