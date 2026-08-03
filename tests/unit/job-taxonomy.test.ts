import { describe, expect, it } from "vitest";
import {
  JOB_TAXONOMY_VERSION,
  selectJobTaxonomyDirections,
  validateDirectionCandidates,
} from "@/domain/job-taxonomy";

describe("job taxonomy", () => {
  it("keeps a traceable internal source version and accepts common entry-level directions", () => {
    expect(JOB_TAXONOMY_VERSION).toBe("2026-07-31.v1");
    expect(validateDirectionCandidates([
      {
        directionName: "内容运营（Content Operations）",
        searchKeywords: ["内容运营 实习", "新媒体运营 助理"],
      },
      {
        directionName: "外贸跟单助理",
        searchKeywords: ["外贸跟单 实习", "外贸助理 校招"],
      },
    ])).toEqual({ ok: true, version: JOB_TAXONOMY_VERSION });
  });

  it("rejects fictional or unmappable direction names even when they borrow a real role term", () => {
    expect(validateDirectionCandidates([
      {
        directionName: "火星殖民客户成功官",
        searchKeywords: ["火星客户成功 实习", "量子殖民 助理"],
      },
      {
        directionName: "内容运营",
        searchKeywords: ["内容运营 实习"],
      },
    ])).toEqual({ ok: false, version: JOB_TAXONOMY_VERSION });
  });

  it("rejects duplicate directions even when each direction is individually valid", () => {
    const duplicate = {
      directionName: "内容运营（Content Operations）",
      searchKeywords: ["内容运营 实习", "新媒体运营 助理"],
    };

    expect(validateDirectionCandidates([duplicate, duplicate])).toEqual({
      ok: false,
      version: JOB_TAXONOMY_VERSION,
    });
  });

  it("rejects two aliases that map to the same job family", () => {
    expect(validateDirectionCandidates([
      {
        directionName: "内容运营",
        searchKeywords: ["内容运营 实习"],
      },
      {
        directionName: "内容运营（Content Operations）",
        searchKeywords: ["新媒体运营 助理"],
      },
    ])).toEqual({
      ok: false,
      version: JOB_TAXONOMY_VERSION,
    });
  });

  it("returns no directions when the material has no positive taxonomy evidence", () => {
    expect(selectJobTaxonomyDirections("我还在了解自己适合什么工作。"))
      .toEqual([]);
  });

  it("does not fill a second direction when only one job family has positive evidence", () => {
    expect(selectJobTaxonomyDirections("做过内容运营相关的社团推文整理。"))
      .toEqual([
        {
          directionName: "内容运营",
          searchKeywords: ["内容运营 实习", "新媒体运营 助理", "内容助理 校招"],
        },
      ]);
  });

  it("returns the two positively matched job families", () => {
    expect(selectJobTaxonomyDirections("做过审计实习，也愿意尝试销售助理。"))
      .toEqual([
        {
          directionName: "销售助理",
          searchKeywords: ["销售助理 实习", "销售 实习", "商务拓展 助理"],
        },
        {
          directionName: "审计助理",
          searchKeywords: ["审计助理 实习", "审计助理 校招", "审计实习"],
        },
      ]);
  });

  it("does not treat explicitly rejected job families as positive evidence", () => {
    expect(selectJobTaxonomyDirections(
      "我不想做内容运营，也不接受销售助理；愿意尝试活动执行和审计助理。",
    )).toEqual([
      {
        directionName: "审计助理",
        searchKeywords: ["审计助理 实习", "审计助理 校招", "审计实习"],
      },
      {
        directionName: "活动执行",
        searchKeywords: ["活动执行 实习", "会展助理 实习", "活动运营 助理"],
      },
    ]);
  });

  it("keeps a positive family after an adjacent rejected family", () => {
    expect(selectJobTaxonomyDirections("不想销售助理，审计助理可以尝试。"))
      .toEqual([
        {
          directionName: "审计助理",
          searchKeywords: ["审计助理 实习", "审计助理 校招", "审计实习"],
        },
      ]);
  });

  it("recognizes softened rejection wording within its own clause", () => {
    expect(selectJobTaxonomyDirections("不太想做销售助理，愿意审计助理。"))
      .toEqual([
        {
          directionName: "审计助理",
          searchKeywords: ["审计助理 实习", "审计助理 校招", "审计实习"],
        },
    ]);
  });

  it("keeps an explicitly positive role after a rejected role separated by a list comma", () => {
    expect(selectJobTaxonomyDirections("不想销售助理、审计助理可以尝试。"))
      .toEqual([
        {
          directionName: "审计助理",
          searchKeywords: ["审计助理 实习", "审计助理 校招", "审计实习"],
        },
      ]);
  });

  it("keeps a positive role after an 而 transition", () => {
    expect(selectJobTaxonomyDirections("不想销售助理而愿意尝试审计助理。"))
      .toEqual([
        {
          directionName: "审计助理",
          searchKeywords: ["审计助理 实习", "审计助理 校招", "审计实习"],
        },
      ]);
  });
});
