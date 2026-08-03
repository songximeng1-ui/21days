import { createAiProviderFromEnv } from "@/ai/chat-completion-provider";
import type { AiFailureEvent } from "@/ai/failure-diagnostics";
import { generateRouteOutput } from "@/ai/orchestrator";
import { describe, expect, it } from "vitest";

const runRealProviderSmoke =
  process.env.RUN_REAL_PROVIDER_SMOKE === "1" &&
  Boolean(process.env.DEEPSEEK_API_KEY);

describe.runIf(runRealProviderSmoke)("real provider smoke", () => {
  it("turns sufficient JD evidence into one grounded route result", async () => {
    const events: AiFailureEvent[] = [];
    const output = await generateRouteOutput({
      routeKey: "jd_to_revision",
      input: {
        targetJobTitle: "AI产品运营",
        jdTextOrRequirements:
          "负责推进AI产品需求落地与迭代，协同研发、设计和业务团队；能够识别项目风险并推动问题闭环；能够独立撰写产品方案、PRD和复盘文档。",
        userMaterial:
          "负责全国91家门店活动项目推进，整理报名数据并跟进执行，活动总播放量超过10万；独立使用Codex完成应届生求职地图MVP，从需求梳理、产品设计、界面实现到测试上线。",
        currentQuestion: "不知道投递前应该先改哪一段。",
      },
      provider: createAiProviderFromEnv(),
      reporter: {
        report(event) {
          events.push(event);
        },
      },
      requestId: "real-provider-smoke",
      deadlineMs: 60_000,
    });

    expect(output.outputType, JSON.stringify(events)).toBe("route_result");
    expect(output.routeKey).toBe("jd_to_revision");
    expect(output.todayAction.actionType).toBe("jd_revision");
  }, 70_000);
});
