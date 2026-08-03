import type { LocalRecord } from "@/lib/local-store";

const recordFieldLabels: Record<string, string> = {
  educationBackground: "专业或学习背景",
  realExperiences: "做过的课程、项目或实践",
  interestsOrAcceptables: "感兴趣或不排斥的方向",
  constraints: "暂时不接受的条件",
  targetDirection: "目标方向",
  rawExperience: "真实经历",
  deliverableOrResult: "交付物或结果",
  targetJobTitle: "目标岗位",
  jdTextOrRequirements: "岗位要求",
  userMaterial: "准备使用的材料",
  currentQuestion: "当前疑问",
  actualActions: "实际做过的动作",
  deliverable: "交付物或结果",
  missingFacts: "还不确定的事实",
  confirmedFacts: "来源经历与已确认事实",
  supportingFacts: "支撑这段表达的事实",
  resumeSnippet: "克制简历片段",
  stillMissing: "仍需补充的事实",
  beforeSnippet: "修改前片段",
  afterSnippet: "修改后片段",
  jdRequirement: "对应的岗位要求",
  submitted: "是否已经投递",
  jobTitle: "岗位名称",
  companyOrPlatform: "公司或平台",
  submittedAt: "投递时间",
  feedbackStatus: "反馈状态",
  jdSummary: "这份岗位主要要求",
  materialVersion: "这次使用的简历或材料",
  userSuspicion: "自己怀疑的问题",
};

const recordTypeLabels: Record<string, string> = {
  job_sample: "岗位样本",
  experience_fact: "经历事实",
  resume_snippet: "简历片段",
  jd_compare: "投递前修改记录",
  application: "投递记录",
  feedback: "反馈记录",
  fill_info: "补充信息",
};

export type VisibleRecordField = {
  field: string;
  label: string;
  value: string;
};

export function getVisibleRecordFields(
  payload: Record<string, string>,
): VisibleRecordField[] {
  return Object.entries(recordFieldLabels).flatMap(([field, label]) => {
    const cleaned = payload[field]?.trim();
    return cleaned
      ? [{ field, label, value: formatVisibleFieldValue(field, cleaned) }]
      : [];
  });
}

function formatVisibleFieldValue(field: string, value: string): string {
  if (field !== "submittedAt") return value;
  const isoDate = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!isoDate) return value;
  return `${Number(isoDate[1])}/${Number(isoDate[2])}/${Number(isoDate[3])}`;
}

export function getEditableRecordFields(record: LocalRecord): VisibleRecordField[] {
  return getVisibleRecordFields(record.payload);
}

export function getRecordTypeLabel(recordType: string): string {
  return recordTypeLabels[recordType] ?? "求职记录";
}

export function formatUserFacingList(items: string[]): string {
  const visibleItems = items.map((item) => item.trim()).filter(Boolean);
  return visibleItems
    .map((item, index) =>
      index === visibleItems.length - 1
        ? item
        : item.replace(/[。；;]+$/u, ""),
    )
    .join("；");
}
