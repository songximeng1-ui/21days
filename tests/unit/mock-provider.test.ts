import { describe, expect, it } from "vitest";
import { MockAiProvider } from "@/ai/mock-provider";

describe("MockAiProvider direction results", () => {
  it("keeps a stated travel constraint visible in every suggested direction", async () => {
    const output = await new MockAiProvider("success").generate({
      routeKey: "direction_to_jobs",
      input: {
        educationBackground: "市场营销专业",
        realExperiences: "整理过社团活动报名数据",
        interestsOrAcceptables: "愿意尝试内容运营和数据整理",
        constraints: "不接受长期出差",
      },
    });

    const directions = output.routeResult?.explorableDirections as Array<{
      basisFromUserMaterial: string[];
      riskOrGap: string;
    }>;
    expect(directions.length).toBeGreaterThanOrEqual(2);
    for (const direction of directions) {
      expect([...direction.basisFromUserMaterial, direction.riskOrGap].join("\n"))
        .toContain("不接受长期出差");
    }
  });
});

describe("MockAiProvider application review", () => {
  it("does not ask for fields already present in two complete application records", async () => {
    const output = await new MockAiProvider("success").generate({
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
    });

    expect(output.outputType).toBe("route_result");
    expect(output.routeResult).toMatchObject({
      informationGaps: ["还缺后续真实反馈"],
      nextValidationAction: "选 1 条投递记录，写下 1 个需要后续反馈验证的问题",
    });
    const visibleOutput = JSON.stringify(output);
    expect(visibleOutput).not.toContain("补齐材料版本");
    expect(visibleOutput).not.toContain('"JD 摘要","使用的材料版本"');
  });
});
