import { describe, expect, it } from "vitest";
import {
  ROUTE_KEYS,
  getRouteStrategy,
  isRouteInputSufficient,
} from "@/domain/routes";

describe("route strategies", () => {
  it("keeps four independent route strategies", () => {
    expect(ROUTE_KEYS).toEqual([
      "direction_to_jobs",
      "experience_to_resume",
      "jd_to_revision",
      "applications_to_review",
    ]);

    const recordTypes = ROUTE_KEYS.map((routeKey) => getRouteStrategy(routeKey).recordType);
    expect(new Set(recordTypes).size).toBe(4);
  });

  it("keeps product route names stable in the domain layer", () => {
    expect(ROUTE_KEYS.map((routeKey) => getRouteStrategy(routeKey).routeName)).toEqual([
      "方向 -> 岗位样本",
      "经历 -> 简历材料",
      "JD -> 投递前最小修改",
      "投递记录 -> 轻复盘",
    ]);
  });

  it("marks complete experience input sufficient", () => {
    expect(
      isRouteInputSufficient("experience_to_resume", {
        targetDirection: "operations",
        rawExperience: "student club account",
        actualActions: "planned topics, edited posts, published content",
        deliverableOrResult: "published 6 posts",
      })
    ).toBe(true);
  });

  it("marks missing JD input insufficient for JD revision", () => {
    expect(
      isRouteInputSufficient("jd_to_revision", {
        targetJobTitle: "operations intern",
        userMaterial: "managed a student club account",
      })
    ).toBe(false);
  });

  it("does not treat vague no-feedback application worry as sufficient review evidence", () => {
    expect(
      isRouteInputSufficient("applications_to_review", {
        applications: "投了很多岗位都没反馈，不知道是不是我太差了",
      })
    ).toBe(false);
  });

  it("keeps one minimum application record insufficient for review output", () => {
    expect(
      isRouteInputSufficient("applications_to_review", {
        applications: {
          jobTitle: "内容运营实习",
          companyOrPlatform: "A 公司",
          submittedAt: "7 月 1 日",
          feedbackStatus: "暂无反馈",
        },
      })
    ).toBe(false);
  });

  it("requires at least two application records with review fields before review output", () => {
    expect(
      isRouteInputSufficient("applications_to_review", {
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
      })
    ).toBe(true);
  });

  it("keeps partial structured application records insufficient", () => {
    expect(
      isRouteInputSufficient("applications_to_review", {
        applications: {
          jobTitle: "内容运营实习",
          feedbackStatus: "暂无反馈",
        },
      })
    ).toBe(false);
  });

  it("keeps application records with unknown JD or material version insufficient for review", () => {
    expect(
      isRouteInputSufficient("applications_to_review", {
        applications: [
          {
            jobTitle: "内容运营实习",
            companyOrPlatform: "A 公司",
            submittedAt: "7 月 1 日",
            feedbackStatus: "暂无反馈",
            jdSummary: "不确定",
            materialVersion: "社团经历版",
          },
          {
            jobTitle: "新媒体运营实习",
            companyOrPlatform: "B 公司",
            submittedAt: "7 月 3 日",
            feedbackStatus: "已查看",
            jdSummary: "负责选题和数据记录",
            materialVersion: "不知道",
          },
        ],
      })
    ).toBe(false);
  });

  it("keeps application records with unfinished placeholder review fields insufficient", () => {
    expect(
      isRouteInputSufficient("applications_to_review", {
        applications: [
          {
            jobTitle: "内容运营实习",
            companyOrPlatform: "A 公司",
            submittedAt: "7 月 1 日",
            feedbackStatus: "暂无反馈",
            jdSummary: "还没整理",
            materialVersion: "社团经历版",
          },
          {
            jobTitle: "新媒体运营实习",
            companyOrPlatform: "B 公司",
            submittedAt: "7 月 3 日",
            feedbackStatus: "已查看",
            jdSummary: "负责选题和数据记录",
            materialVersion: "无明确版本",
          },
        ],
      })
    ).toBe(false);
  });

  it("keeps natural-language application text insufficient until it is structured", () => {
    expect(
      isRouteInputSufficient("applications_to_review", {
        applications: "内容运营实习 A 公司 7 月 1 日投递 暂无反馈",
      })
    ).toBe(false);
  });
});
