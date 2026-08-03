import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import {
  evidenceScreenshotPath,
  installEvidenceCapture,
  type EvidenceCapture,
} from "./evidence";

const configuredEvidenceRoot =
  process.env.PLAYWRIGHT_EVIDENCE_DIR ?? process.env.E2E_EVIDENCE_DIR;
if (!configuredEvidenceRoot) {
  throw new Error(
    "PLAYWRIGHT_EVIDENCE_DIR or E2E_EVIDENCE_DIR must be assigned by the Playwright config.",
  );
}
const evidenceRoot: string = configuredEvidenceRoot;

const routes = [
  ["direction_to_jobs", "我不知道能投哪些岗位"],
  ["experience_to_resume", "我的经历不知道怎么写进简历"],
  ["jd_to_revision", "我看到岗位了，不知道投递前怎么改"],
  ["applications_to_review", "我投了一些，但没什么反馈"],
] as const;

const browserProblems = new WeakMap<Page, string[]>();
const evidenceCaptures = new WeakMap<Page, EvidenceCapture>();

test.beforeEach(async ({ page }, testInfo) => {
  const problems: string[] = [];
  browserProblems.set(page, problems);
  evidenceCaptures.set(page, installEvidenceCapture(page, testInfo, evidenceRoot));
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      problems.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  await page.goto("/");
  await page.evaluate(() => window.localStorage.clear());
});

test.afterEach(async ({ page }) => {
  evidenceCaptures.get(page)?.finish();
  expect(browserProblems.get(page) ?? []).toEqual([]);
});

test("home and all four route inputs are usable without serious WCAG or overflow defects", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "不用一次想清楚，今天先推进一件事。" })).toBeVisible();
  await expectNoSeriousA11yViolations(page);
  await expectNoHorizontalOverflow(page);

  for (const [routeKey, heading] of routes) {
    await page.goto(`/routes/${routeKey}/input`);
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    const notice = page.getByLabel("外部 AI 数据说明");
    await expect(notice).toContainText("第三方 AI 瞬时处理");
    await expect(notice).toContainText("应用服务端不持久化原文");
    await expectNoSeriousA11yViolations(page);
    await expectNoHorizontalOverflow(page);
    await page.screenshot({
      path: evidenceScreenshotPath(
        evidenceRoot,
        testInfo.project.name,
        routeKey,
        "input",
      ),
      fullPage: true,
    });
  }
});

test("one application record cannot cross the two-record review gate", async ({ page }) => {
  await page.goto("/routes/applications_to_review/input");
  await fillApplication(page, 1);
  await expect(page.getByText(/至少需要两条可对照的投递记录/)).toBeVisible();
  await expect(page.getByLabel("第 2 条投递：岗位名称")).toHaveCount(0);
  await page.getByRole("button", { name: "再补第 2 条投递记录" }).click();
  await expect(page.getByLabel("第 2 条投递：岗位名称")).toBeVisible();
});

test("all four complete routes reach a document-shaped action", async ({ page }, testInfo) => {
  for (const [routeKey] of routes) {
    await page.goto(`/routes/${routeKey}/input`);
    await page.evaluate(() => window.localStorage.clear());
    await page.reload();
    await fillCompleteRoute(page, routeKey);
    await page.getByRole("button", { name: "生成今天先做的一步" }).click();
    await expect(page).toHaveURL(new RegExp(`/routes/${routeKey}/action$`));
    await expect(page.getByText("今日行动", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "我做完了，记录结果" })).toBeVisible();
    await page.screenshot({
      path: evidenceScreenshotPath(
        evidenceRoot,
        testInfo.project.name,
        routeKey,
        "complete-action",
      ),
      fullPage: true,
    });
  }
});

test("all four incomplete routes stop at one honest missing-information action", async ({
  page,
}, testInfo) => {
  for (const [routeKey] of routes) {
    await page.goto(`/routes/${routeKey}/input`);
    await page.evaluate(() => window.localStorage.clear());
    await page.reload();
    await page.getByRole("button", { name: "生成今天先做的一步" }).click();
    await expect(page).toHaveURL(new RegExp(`/routes/${routeKey}/action$`));
    await expect(page.getByText("补信息行动", { exact: true })).toBeVisible();
    await expect(page.getByText("还缺一个关键信息", { exact: true })).toBeVisible();
    await page.screenshot({
      path: evidenceScreenshotPath(
        evidenceRoot,
        testInfo.project.name,
        routeKey,
        "missing-information",
      ),
      fullPage: true,
    });
  }
});

test("external-AI wait, limit and failure states retain the user's draft", async ({ page }) => {
  await page.goto("/routes/jd_to_revision/input");
  await page.getByLabel("目标岗位名称是什么？").fill("内容运营实习");
  await page.getByLabel(/把岗位要求粘贴进来/).fill("负责内容整理和数据记录");
  const material = page.getByLabel(/粘贴你准备核对或修改的原句/);
  await material.fill("整理报名表并核对名单");

  await page.route("**/api/ai", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 350));
    await route.fulfill({
      status: 429,
      headers: { "Content-Type": "application/json", "Retry-After": "60" },
      body: JSON.stringify({ error: "rate_limited" }),
    });
  });

  await page.getByRole("button", { name: "生成今天先做的一步" }).click();
  await expect(page.getByRole("button", { name: "正在生成..." })).toBeDisabled();
  await expect(page.getByRole("status")).toContainText("正在阅读你提供的信息");
  await expect(page.getByRole("status")).toContainText("这次暂时没整理出来");
  await expect(material).toHaveValue("整理报名表并核对名单");
  const expectedNetworkErrors = browserProblems.get(page) ?? [];
  expect(expectedNetworkErrors).toEqual([
    expect.stringMatching(/429 \(Too Many Requests\)/),
  ]);
  expectedNetworkErrors.length = 0;
});

test("browser timeout aborts the pending AI request and keeps the draft", async ({ page }) => {
  await page.addInitScript(() => {
    const nativeSetTimeout = window.setTimeout.bind(window);
    window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) =>
      nativeSetTimeout(handler, timeout === 30_000 ? 120 : timeout, ...args)) as typeof window.setTimeout;
  });
  let requestFailed = false;
  page.on("requestfailed", (request) => {
    if (request.url().includes("/api/ai")) requestFailed = true;
  });
  await page.route("**/api/ai", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 800));
    try {
      await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    } catch {
      // The expected client abort makes the intercepted route impossible to fulfill.
    }
  });
  await page.goto("/routes/jd_to_revision/input");
  await page.getByLabel("目标岗位名称是什么？").fill("内容运营实习");
  await page.getByLabel(/把岗位要求粘贴进来/).fill("负责内容整理和数据记录");
  const material = page.getByLabel(/粘贴你准备核对或修改的原句/);
  await material.fill("整理报名表并核对名单");

  await page.getByRole("button", { name: "生成今天先做的一步" }).click();

  await expect(page.getByRole("status")).toContainText("这次暂时没整理出来");
  await expect.poll(() => requestFailed).toBe(true);
  await expect(material).toHaveValue("整理报名表并核对名单");
});

test("draft save failure is explicit and never drops the typed value", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Object.defineProperty(Storage.prototype, "setItem", {
      configurable: true,
      value(this: Storage, key: string, value: string) {
        if (key.startsWith("mvp-draft:")) throw new Error("quota");
        return original.call(this, key, value);
      },
    });
  });
  await page.goto("/routes/experience_to_resume/input");
  const direction = page.getByLabel("你大概想投什么方向？");
  await direction.fill("内容运营");
  await expect(direction).toHaveValue("内容运营");
  await expect(page.getByRole("status")).toContainText("这次没有保存成功");
  await page.screenshot({
    path: evidenceScreenshotPath(
      evidenceRoot,
      testInfo.project.name,
      "experience_to_resume",
      "save-failure",
    ),
    fullPage: true,
  });
});

test("resume snippet confirmation, safe copy, versioning, weekly review and source cascade work end to end", async ({
  page,
  context,
}, testInfo) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/routes/experience_to_resume/input");
  await page.evaluate(() => {
    const started = new Date();
    started.setDate(started.getDate() - 6);
    window.localStorage.setItem(
      "mvp-journey",
      JSON.stringify({ journeyStartedAt: started.toISOString() }),
    );
  });
  await fillCompleteRoute(page, "experience_to_resume");
  await page.getByRole("button", { name: "生成今天先做的一步" }).click();
  await page.getByRole("link", { name: "我做完了，记录结果" }).click();
  await page.screenshot({
    path: evidenceScreenshotPath(
      evidenceRoot,
      testInfo.project.name,
      "experience_to_resume",
      "record",
    ),
    fullPage: true,
  });

  const snippetField = page.getByLabel("克制简历片段");
  const originalSnippet = await snippetField.inputValue();
  expect(originalSnippet.trim().length).toBeGreaterThan(0);
  await page.getByLabel("实际完成了什么？").fill("整理并核对了这段经历的真实动作。");
  await page.getByLabel(/我确认这条记录反映了我实际做过的事/).check();
  await page.getByRole("button", { name: "保存并看看下一步" }).click();
  await expect(page).toHaveURL(/\/review$/);
  await expect(page.getByLabel("外部 AI 数据说明")).toBeVisible();
  await expect(page.getByRole("button", { name: "同意并生成这次回看" })).toBeVisible();
  await page.screenshot({
    path: evidenceScreenshotPath(
      evidenceRoot,
      testInfo.project.name,
      "experience_to_resume",
      "review",
    ),
    fullPage: true,
  });

  await page.goto("/track");
  await expect(page.getByText(/第 7 天/)).toBeVisible();
  await expect(page.getByText("真实推进：1 次")).toBeVisible();
  const snippetArticle = page.getByRole("article").filter({ hasText: "简历片段版本" }).first();
  await expect(snippetArticle.getByText("版本 1", { exact: false })).toBeVisible();
  await snippetArticle.getByRole("button", { name: "复制已确认片段" }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(originalSnippet);

  await snippetArticle.getByRole("button", { name: "编辑这条记录" }).click();
  await snippetArticle.getByLabel("编辑：克制简历片段").fill(`${originalSnippet}，带来 80% 增长`);
  await snippetArticle.getByRole("button", { name: "保存修改" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "来源经历无法支撑" })).toBeVisible();
  await snippetArticle.getByLabel("编辑：克制简历片段").fill(originalSnippet);
  await snippetArticle.getByLabel("编辑实际完成").fill("再次核对了片段与来源经历。");
  await snippetArticle.getByRole("button", { name: "保存修改" }).click();
  await expect(page.getByText("版本 2", { exact: false }).first()).toBeVisible();

  await page.getByRole("button", { name: "生成过去 7 天回看" }).click();
  await expect(page.getByText(/过去 7 天完成了/)).toBeVisible();
  await expect(page.getByText(/下一轮先做/)).toBeVisible();
  await expectNoSeriousA11yViolations(page);
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    path: evidenceScreenshotPath(
      evidenceRoot,
      testInfo.project.name,
      "experience_to_resume",
      "track",
    ),
    fullPage: true,
  });

  const sourceArticle = page.getByRole("article").filter({ hasText: "来源经历与已确认事实" }).first();
  await sourceArticle.getByRole("button", { name: "删除这条记录" }).click();
  await sourceArticle.getByRole("button", { name: "确认删除这条记录" }).click();
  await expect(page.getByRole("heading", { name: "简历片段版本" })).toHaveCount(0);
});

test("direction route carries constraints through action, record, light review and seven-day track", async ({
  page,
}, testInfo) => {
  await page.goto("/routes/direction_to_jobs/input");
  await startDaySevenJourney(page);
  await fillCompleteRoute(page, "direction_to_jobs");
  await expectPageQualityAndScreenshot(page, testInfo, "direction_to_jobs", "deep-input-filled");

  await clickAndExpectAiSuccess(page, "生成今天先做的一步");
  await expect(page).toHaveURL(/\/routes\/direction_to_jobs\/action$/);
  await expect(page.getByRole("heading", { name: "可以先探索的方向" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "内容运营", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "活动执行", exact: true })).toBeVisible();
  await expect(page.getByText("内容运营 实习", { exact: true })).toBeVisible();
  await expect(page.getByText("不接受长期出差", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("预计用时：15-30 分钟", { exact: true })).toBeVisible();
  await expectPageQualityAndScreenshot(page, testInfo, "direction_to_jobs", "deep-action");

  await page.getByRole("link", { name: "我做完了，记录结果" }).click();
  await page.getByLabel("实际完成了什么？").fill("保存并核对了 1 个内容运营实习生岗位样本。");
  await page.getByLabel("岗位名称").fill("内容运营实习生");
  await page.getByLabel("公司或平台").fill("A 公司招聘页");
  await page.getByLabel("这份岗位主要要求").fill("负责公众号内容排版，协助活动执行并记录活动数据。");
  await page.getByLabel("你愿意继续看的点").fill("内容排版和活动执行");
  await page.getByLabel("你担心或不确定的点").fill("长期出差频率暂时不清楚");
  await page.getByLabel(/我确认这条记录反映了我实际做过的事/).check();
  await expectPageQualityAndScreenshot(page, testInfo, "direction_to_jobs", "record");
  await page.getByRole("button", { name: "保存并看看下一步" }).click();

  await expect(page).toHaveURL(/\/review$/);
  await expect(page.getByText("岗位名称：内容运营实习生", { exact: true })).toBeVisible();
  await clickAndExpectAiSuccess(page, "同意并生成这次回看");
  await expect(page.getByRole("status")).toContainText("已根据这条记录整理出下一步");
  await expect(page.getByText(/保存并核对了 1 个内容运营实习生岗位样本/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "看到的线索" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "还缺的信息" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "下一步行动" })).toBeVisible();
  await expectPageQualityAndScreenshot(page, testInfo, "direction_to_jobs", "light-review");
  await page.getByRole("link", { name: "设为下一次行动" }).click();

  await page.goto("/track");
  await expect(page.getByText(/第 7 天/)).toBeVisible();
  await expect(page.getByText("已记录行动：1 次")).toBeVisible();
  await expect(page.getByText("岗位名称：内容运营实习生", { exact: true })).toBeVisible();
  await expect(page.getByText("公司或平台：A 公司招聘页", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "生成过去 7 天回看" }).click();
  await expect(page.getByText(/过去 7 天完成了 1 次真实推进/)).toBeVisible();
  await expect(page.getByText(/再保存 1 个真实岗位样本/)).toBeVisible();
  await expectNoInternalValues(page, ["job_sample", "route_result"]);
  await expectPageQualityAndScreenshot(page, testInfo, "direction_to_jobs", "track");
});

test("JD route preserves truthful prefill through revision, light review and seven-day track", async ({
  page,
}, testInfo) => {
  const targetJobTitle = "内容运营实习生";
  const beforeSnippet = "社团宣传组，编辑推文并统计报名表";
  const jdRequirement = "需要内容选题、数据记录、基础沟通协作";
  const afterSnippet = "协助编辑 2 篇社团推文，并整理 120 条活动报名信息。";

  await page.goto("/routes/jd_to_revision/input");
  await startDaySevenJourney(page);
  await fillCompleteRoute(page, "jd_to_revision");
  await expectPageQualityAndScreenshot(page, testInfo, "jd_to_revision", "deep-input-filled");

  await clickAndExpectAiSuccess(page, "生成今天先做的一步");
  await expect(page).toHaveURL(/\/routes\/jd_to_revision\/action$/);
  await expect(page.getByLabel("岗位要求对照结果")).toBeVisible();
  await expect(page.getByRole("heading", { name: "这次对照的岗位要求" })).toBeVisible();
  await expect(page.getByText(jdRequirement, { exact: true })).toBeVisible();
  await expect(page.getByText(beforeSnippet, { exact: true })).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "有证据后可使用的候选文本", exact: true })).toBeVisible();
  await expect(page.getByText("预计用时：15-30 分钟", { exact: true })).toBeVisible();
  await expectPageQualityAndScreenshot(page, testInfo, "jd_to_revision", "deep-action");

  await page.getByRole("link", { name: "我做完了，记录结果" }).click();
  await expect(page.getByLabel("目标岗位名称")).toHaveValue(targetJobTitle);
  await expect(page.getByLabel("修改前片段")).toHaveValue(beforeSnippet);
  await expect(page.getByLabel("对应的岗位要求")).toHaveValue(jdRequirement);
  await expect(page.getByLabel("修改后片段")).toHaveValue(`${beforeSnippet}。`);
  await expect(page.getByLabel("是否已经投递")).toHaveValue("");
  await page.getByLabel("实际完成了什么？").fill("按真实经历完成 1 条投递前最小修改并提交。");
  await page.getByLabel("修改后片段").fill(afterSnippet);
  await page.getByLabel("是否已经投递").fill("是，已使用修改后材料投递");
  await page.getByLabel(/我确认这条记录反映了我实际做过的事/).check();
  await expectPageQualityAndScreenshot(page, testInfo, "jd_to_revision", "record");
  await page.getByRole("button", { name: "保存并看看下一步" }).click();

  await expect(page).toHaveURL(/\/review$/);
  await expect(page.getByText(`目标岗位：${targetJobTitle}`, { exact: true })).toBeVisible();
  await expect(page.getByText(`修改前片段：${beforeSnippet}`, { exact: true })).toBeVisible();
  await expect(page.getByText(`修改后片段：${afterSnippet}`, { exact: true })).toBeVisible();
  await expect(page.getByText(`对应的岗位要求：${jdRequirement}`, { exact: true })).toBeVisible();
  await clickAndExpectAiSuccess(page, "同意并生成这次回看");
  await expect(page.getByRole("status")).toContainText("已根据这条记录整理出下一步");
  await expect(page.getByText(/按真实经历完成 1 条投递前最小修改并提交/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "看到的线索" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "还缺的信息" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "下一步行动" })).toBeVisible();
  await expectPageQualityAndScreenshot(page, testInfo, "jd_to_revision", "light-review");
  await page.getByRole("link", { name: "设为下一次行动" }).click();

  await page.goto("/track");
  await expect(page.getByText(/第 7 天/)).toBeVisible();
  await expect(page.getByText("已记录行动：1 次")).toBeVisible();
  await expect(page.getByText(`目标岗位：${targetJobTitle}`, { exact: true })).toBeVisible();
  await expect(page.getByText(`修改前片段：${beforeSnippet}`, { exact: true })).toBeVisible();
  await expect(page.getByText(`修改后片段：${afterSnippet}`, { exact: true })).toBeVisible();
  await expect(page.getByText(`对应的岗位要求：${jdRequirement}`, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "生成过去 7 天回看" }).click();
  await expect(page.getByText(/过去 7 天完成了 1 次真实推进/)).toBeVisible();
  await expect(page.getByText(/再核对 1 条岗位要求与材料表述/)).toBeVisible();
  await expectNoInternalValues(page, ["jd_compare", "route_result"]);
  await expectPageQualityAndScreenshot(page, testInfo, "jd_to_revision", "track");
});

test("JD capability claim becomes a concrete evidence check without inventing a resume sentence", async ({
  page,
}, testInfo) => {
  const capabilityClaim = "可独立完成产品数据整理、分析与复盘";

  await page.goto("/routes/jd_to_revision/input");
  await page.getByLabel("目标岗位名称是什么？").fill("AI 产品运营实习");
  await page.getByLabel(/把岗位要求粘贴进来/).fill(capabilityClaim);
  await page.getByLabel(/粘贴你准备核对或修改的原句/).fill(capabilityClaim);
  await page.getByLabel(/你最想确认什么/).fill(capabilityClaim);

  await clickAndExpectAiSuccess(page, "生成今天先做的一步");
  await expect(page).toHaveURL(/\/routes\/jd_to_revision\/action$/);
  await expect(page.getByRole("heading", { name: "今天只做这一件事" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "证据与候选文本", exact: true })).toBeVisible();
  await expect(page.getByText("当前证据不足，暂不修改这句。先按上面的行动核对原始材料。", { exact: true })).toBeVisible();
  await expect(page.getByText(/完成标准：已保存 1 条核对结果/)).toBeVisible();
  await expect(page.locator("body")).not.toContainText("对照数据分析要求补一句真实动作");
  await expectPageQualityAndScreenshot(page, testInfo, "jd_to_revision", "claim-only-action");

  await page.getByRole("link", { name: "我做完了，记录结果" }).click();
  await expect(page.getByLabel("修改前片段")).toHaveValue(capabilityClaim);
  await expect(page.getByLabel("修改后片段")).toHaveValue("");
  await expect(page.getByLabel("对应的岗位要求")).toHaveValue(capabilityClaim);
  await expectPageQualityAndScreenshot(page, testInfo, "jd_to_revision", "claim-only-record");
});

test("two application records persist separately and unlock explicit light review", async ({
  page,
}, testInfo) => {
  await page.goto("/routes/applications_to_review/input");
  await fillCompleteRoute(page, "applications_to_review");
  await page.getByRole("button", { name: "生成今天先做的一步" }).click();
  await page.getByRole("link", { name: "我做完了，记录结果" }).click();
  await page.getByLabel("实际完成了什么？").fill("核对并保存了两条真实投递记录。");
  await page.getByLabel(/我确认这条记录反映了我实际做过的事/).check();
  await page.getByRole("button", { name: "保存并看看下一步" }).click();

  await expect(page).toHaveURL(/\/review$/);
  await expect(page.getByLabel("外部 AI 数据说明")).toBeVisible();
  await page.getByRole("button", { name: "同意并生成这次回看" }).click();
  await expect(page.getByRole("status")).toContainText("已根据这条记录整理出下一步");
  await page.getByRole("link", { name: "设为下一次行动" }).click();
  await page.goto("/track");
  await expect(page.getByText("已记录行动：1 次")).toBeVisible();
  await expect(page.getByText("岗位名称：内容运营实习")).toBeVisible();
  await expect(page.getByText("岗位名称：新媒体运营实习")).toBeVisible();
  await expect(page.locator("body")).not.toContainText("sourceExperienceId");
  await expect(page.locator("body")).not.toContainText("application_record");
  await expect(page.locator("body")).not.toContainText("record-");
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    path: evidenceScreenshotPath(
      evidenceRoot,
      testInfo.project.name,
      "applications_to_review",
      "track",
    ),
    fullPage: true,
  });
});

test("missing-information save derives and echoes actualDone instead of silently dropping it", async ({
  page,
}) => {
  await page.goto("/routes/jd_to_revision/input");
  await page.getByRole("button", { name: "生成今天先做的一步" }).click();
  await page.getByRole("link", { name: "我补完了，去记录" }).click();
  const requiredField = page.locator("form textarea").nth(1);
  await requiredField.fill("内容运营实习");
  await page.getByLabel(/我确认这条记录反映了我实际做过的事/).check();
  await page.getByRole("button", { name: "保存补充信息，继续判断" }).click();
  await expect(page).toHaveURL(/\/routes\/jd_to_revision\/input$/);

  await page.goto("/track");
  await expect(page.getByText("补充了 1 项信息")).toBeVisible();
  await expect(page.getByText(/内容运营实习/).first()).toBeVisible();
});

async function fillApplication(page: Page, index: 1 | 2) {
  const prefix = `第 ${index} 条投递：`;
  await page.getByLabel(`${prefix}岗位名称`).fill(index === 1 ? "内容运营实习" : "新媒体运营实习");
  await page.getByLabel(`${prefix}公司或平台`).fill(index === 1 ? "A 公司" : "B 公司");
  await page.getByLabel(`${prefix}投递时间`).fill(index === 1 ? "2026-07-01" : "2026-07-03");
  await page
    .getByLabel(`${prefix}当前反馈状态`)
    .selectOption(index === 1 ? "暂无反馈" : "已查看");
  await page.getByLabel(`${prefix}这份岗位主要要求`).fill("负责内容整理和数据记录");
  await page.getByLabel(`${prefix}这次投递用的简历/材料`).fill(`社团经历版 V${index}`);
}

async function fillCompleteRoute(page: Page, routeKey: (typeof routes)[number][0]) {
  if (routeKey === "direction_to_jobs") {
    await page.getByLabel("你的专业或学习背景是什么？").fill("普通本科，市场营销专业");
    await page.getByLabel(/你做过哪些课程/).fill("做过社团公众号排版和活动报名表整理");
    await page.getByLabel(/你感兴趣或不排斥/).fill("能接受内容运营、活动执行、行政助理数据整理");
    await page.getByLabel(/有哪些暂时不想接受/).fill("不接受长期出差");
    return;
  }
  if (routeKey === "experience_to_resume") {
    await page.getByLabel("你大概想投什么方向？").fill("内容运营");
    await page.getByLabel(/先写一段相关真实经历/).fill("参加学院活动宣传组");
    await page.getByLabel(/实际做过哪些动作/).fill("整理活动亮点、编辑推文、统计报名表");
    await page.getByLabel(/有交付物或结果吗/).fill("发布 2 篇推文，整理 120 条报名信息");
    return;
  }
  if (routeKey === "jd_to_revision") {
    await page.getByLabel("目标岗位名称是什么？").fill("内容运营实习生");
    await page.getByLabel(/把岗位要求粘贴进来/).fill("需要内容选题、数据记录、基础沟通协作");
    await page.getByLabel(/粘贴你准备核对或修改的原句/).fill("社团宣传组，编辑推文并统计报名表");
    return;
  }
  await fillApplication(page, 1);
  await page.getByRole("button", { name: "再补第 2 条投递记录" }).click();
  await fillApplication(page, 2);
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(overflow.document).toBeLessThanOrEqual(overflow.viewport + 1);
}

async function expectNoSeriousA11yViolations(page: Page) {
  const result = await new AxeBuilder({ page }).analyze();
  const blocking = result.violations.filter((violation) =>
    violation.impact === "critical" || violation.impact === "serious",
  );
  expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
}

async function clickAndExpectAiSuccess(page: Page, buttonName: string) {
  const [response] = await Promise.all([
    page.waitForResponse((candidate) =>
      candidate.url().endsWith("/api/ai") && candidate.request().method() === "POST"
    ),
    page.getByRole("button", { name: buttonName }).click(),
  ]);
  expect(response.status()).toBe(200);
}

async function startDaySevenJourney(page: Page) {
  await page.evaluate(() => {
    const started = new Date();
    started.setDate(started.getDate() - 6);
    window.localStorage.setItem(
      "mvp-journey",
      JSON.stringify({ journeyStartedAt: started.toISOString() }),
    );
  });
}

async function expectPageQualityAndScreenshot(
  page: Page,
  testInfo: TestInfo,
  routeKey: string,
  state: string,
) {
  await expectNoSeriousA11yViolations(page);
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    path: evidenceScreenshotPath(
      evidenceRoot,
      testInfo.project.name,
      routeKey,
      state,
    ),
    fullPage: true,
  });
}

async function expectNoInternalValues(page: Page, rawEnums: string[]) {
  const visibleText = await page.locator("body").innerText();
  for (const rawEnum of rawEnums) expect(visibleText).not.toContain(rawEnum);
  expect(visibleText).not.toMatch(
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i,
  );
  expect(visibleText).not.toMatch(/\brecord-[A-Za-z0-9_-]+\b/);
}
