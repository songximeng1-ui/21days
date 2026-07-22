import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const userFacingFiles = [
  "src/app/page.tsx",
  "src/app/review/page.tsx",
  "src/app/routes/[routeKey]/action/page.tsx",
  "src/app/routes/[routeKey]/input/page.tsx",
  "src/app/routes/[routeKey]/record/page.tsx",
  "src/app/track/page.tsx",
  "src/ai/orchestrator.ts",
];

const forbiddenCopy = [
  "匹配度",
  "录取概率",
  "适合你",
  "不适合你",
  "能力不行",
  "生成报告",
  "路线轻输入",
  "系统才能",
  "DeepSeek",
  "Qwen",
  "API key",
];

describe("visible product copy boundaries", () => {
  it("keeps user-facing pages away from scoring, model, report, and internal-flow wording", () => {
    const visibleCopy = userFacingFiles
      .map((file) => readFileSync(join(process.cwd(), file), "utf8"))
      .join("\n");

    for (const forbidden of forbiddenCopy) {
      expect(visibleCopy).not.toContain(forbidden);
    }
  });

  it("keeps mobile hero titles from being clipped on narrow screens", () => {
    const cleanup = installProductStyles();
    const hero = document.createElement("section");
    hero.className = "home-hero";
    const title = document.createElement("h1");
    title.textContent = "SuperLongEnglishJobTitleWithoutAnySpaces";
    hero.append(title);
    document.body.append(hero);

    const style = getComputedStyle(title);
    expect(style.maxWidth).toBe("100%");
    expect(style.overflowWrap).toBe("anywhere");
    expect(style.wordBreak).toBe("break-word");
    cleanup();
  });

  it("forces every dynamic action, route-result, review, and record text node to wrap", () => {
    const cleanup = installProductStyles();
    const panel = document.createElement("section");
    panel.className = "panel";
    const dynamicText = document.createElement("p");
    dynamicText.textContent = "https://example.com/a-very-long-url-without-breaks";
    panel.append(dynamicText);
    document.body.append(panel);

    const textStyle = getComputedStyle(dynamicText);
    expect(textStyle.maxWidth).toBe("100%");
    expect(textStyle.overflowWrap).toBe("anywhere");
    expect(textStyle.wordBreak).toBe("break-word");

    for (const className of ["action-card", "evidence-block", "route-result", "timeline-item"]) {
      const element = document.createElement("div");
      element.className = className;
      document.body.append(element);
      expect(getComputedStyle(element).minWidth).toBe("0px");
    }
    cleanup();
  });

  it("declares a mobile viewport so narrow screens use the device width", () => {
    const layout = readFileSync(join(process.cwd(), "src/app/layout.tsx"), "utf8");

    expect(layout).toContain("export const viewport");
    expect(layout).toContain("width: \"device-width\"");
    expect(layout).toContain("initialScale: 1");
  });
});

function installProductStyles() {
  const style = document.createElement("style");
  style.textContent = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
  document.head.append(style);
  return () => {
    style.remove();
    document.body.replaceChildren();
  };
}
