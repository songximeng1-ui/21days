import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const userFacingFiles = [
  "src/app/page.tsx",
  "src/app/review/page.tsx",
  "src/app/routes/[routeKey]/action/page.tsx",
  "src/app/routes/[routeKey]/input/page.tsx",
  "src/app/routes/[routeKey]/record/page.tsx",
  "src/app/track/page.tsx",
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
  "JD",
  "复盘",
  "轻复盘",
  "材料版本",
  "摘要",
];

const forbiddenInternalCopy = [
  "recordGuide",
  "routeResult",
  "route_result",
  "missing_info",
  "friendly_failure",
  "job_sample",
  "experience_fact",
  "jd_revision",
  "jd_compare",
  "application_record",
  "fill_info",
  "schema",
  "fallback",
  "prompt",
  "token",
];

describe("visible product copy boundaries", () => {
  it("keeps user-facing pages away from scoring, model, report, and internal-flow wording", () => {
    const visibleCopy = userFacingFiles
      .flatMap((file) => extractUserVisibleStrings(file))
      .join("\n");

    for (const forbidden of [...forbiddenCopy, ...forbiddenInternalCopy]) {
      expect(visibleCopy).not.toContain(forbidden);
    }
  });

  it("does not mistake TypeScript identifiers or the browser prompt API for visible copy", () => {
    const source = [
      "const recordGuide = output.recordGuide;",
      "const routeResult = output.routeResult;",
      "window.prompt('编辑这条记录');",
    ].join("\n");

    expect(extractVisibleStringsFromSource(source, "identifiers.tsx")).toEqual([]);
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

  it("keeps muted text at WCAG AA contrast on product backgrounds", () => {
    const cleanup = installProductStyles();
    const rootStyle = getComputedStyle(document.documentElement);

    expect(contrastRatio(rootStyle.getPropertyValue("--muted"), rootStyle.getPropertyValue("--panel")))
      .toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(rootStyle.getPropertyValue("--weak"), rootStyle.getPropertyValue("--background")))
      .toBeGreaterThanOrEqual(4.5);
    cleanup();
  });

  it("gives text actions and back links a roughly 44px touch target", () => {
    const cleanup = installProductStyles();
    for (const className of ["text-button", "back-link"]) {
      const element = document.createElement("button");
      element.className = className;
      document.body.append(element);
      const style = getComputedStyle(element);
      expect(Number.parseFloat(style.minHeight)).toBeGreaterThanOrEqual(44);
      expect(Number.parseFloat(style.minWidth)).toBeGreaterThanOrEqual(44);
    }
    cleanup();
  });
});

function extractUserVisibleStrings(file: string): string[] {
  return extractVisibleStringsFromSource(
    readFileSync(join(process.cwd(), file), "utf8"),
    file,
  );
}

function extractVisibleStringsFromSource(source: string, fileName: string): string[] {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const visible: string[] = [];

  function visit(node: ts.Node) {
    if (ts.isJsxText(node) && node.text.trim()) visible.push(node.text.trim());
    if (ts.isJsxAttribute(node) && node.initializer && ts.isStringLiteral(node.initializer)) {
      visible.push(node.initializer.text);
    }
    if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      ts.isJsxExpression(node.parent)
    ) {
      visible.push(node.text);
    }
    if (
      ts.isPropertyAssignment(node) &&
      (ts.isStringLiteral(node.initializer) || ts.isNoSubstitutionTemplateLiteral(node.initializer)) &&
      isVisibleCopyMap(node.parent.parent)
    ) {
      visible.push(node.initializer.text);
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      /^(?:useState|set[A-Z])/.test(node.expression.text)
    ) {
      const first = node.arguments[0];
      if (first && (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first))) {
        visible.push(first.text);
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return visible;
}

function isVisibleCopyMap(node: ts.Node): boolean {
  return (
    ts.isVariableDeclaration(node) &&
    ts.isIdentifier(node.name) &&
    ["fieldLabels", "recordFieldLabels"].includes(node.name.text)
  );
}

function contrastRatio(foreground: string, background: string): number {
  const foregroundLuminance = relativeLuminance(foreground.trim());
  const backgroundLuminance = relativeLuminance(background.trim());
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255);
  const linear = channels.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  );
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function installProductStyles() {
  const style = document.createElement("style");
  style.textContent = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
  document.head.append(style);
  return () => {
    style.remove();
    document.body.replaceChildren();
  };
}
