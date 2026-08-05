import type { JdRouteInput } from "@/domain/jd-evidence-contract";

export const aiProductOperationsInput: JdRouteInput = {
  targetJobTitle: "AI 产品运营",
  jdTextOrRequirements: [
    "负责 AI 产品日常运维、体验优化和全生命周期管理",
    "使用 Office 及主流数据分析工具，完成产品数据整理、分析和复盘",
    "梳理优化业务流程，并协同研发设计",
    "推进项目并识别风险",
    "理解 AI 场景，能输出产品方案和 PRD",
  ].join("\n"),
  userMaterial: [
    "特斯拉销售专员 2024.06–12：接待；最高跟进 17、成交 9、转化 52.94%；客情维护；抖音运营/直播，引流 +30%，13 条、10万+、全国门店第 3/91。",
    "独自使用 Codex 做应届生求职地图 MVP，PM→UX→UI→研发→测试→上线全流程，解决筹码、投递、面试、下一步等痛点。",
  ].join("\n"),
  currentQuestion: "我看到岗位了，不知道投递前怎么改",
};

export const jdTopologyCases = [
  {
    name: "one requirement to one evidence",
    input: {
      targetJobTitle: "内容运营",
      jdTextOrRequirements: "运营内容账号",
      userMaterial: "运营社团公众号，发布 13 条内容。",
    },
  },
  {
    name: "one requirement to many evidence",
    input: {
      targetJobTitle: "内容运营",
      jdTextOrRequirements: "运营内容账号",
      userMaterial: "运营社团公众号。\n发布 13 条内容。",
    },
  },
  {
    name: "many requirements to one evidence",
    input: {
      targetJobTitle: "产品运营",
      jdTextOrRequirements: "维护产品\n优化体验\n推进项目",
      userMaterial: "独自使用 Codex 做求职地图 MVP，走完测试与上线流程。",
    },
  },
  {
    name: "many requirements to many evidence",
    input: aiProductOperationsInput,
  },
] satisfies Array<{ name: string; input: JdRouteInput }>;
