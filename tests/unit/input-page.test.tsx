import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import RouteInputPage from "@/app/routes/[routeKey]/input/page";

const push = vi.fn();
let routeKeyParam = "experience_to_resume";

vi.mock("next/navigation", () => ({
  useParams: () => ({ routeKey: routeKeyParam }),
  useRouter: () => ({ push }),
}));

describe("RouteInputPage draft status", () => {
  beforeEach(() => {
    window.localStorage.clear();
    push.mockReset();
    routeKeyParam = "experience_to_resume";
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("shows reading and then an unsaved state instead of claiming a fresh draft was saved", async () => {
    render(<RouteInputPage />);

    expect(screen.getByRole("status")).toHaveTextContent("正在读取草稿");
    expect(await screen.findByText("还没有保存的草稿。")).toBeInTheDocument();
    expect(screen.queryByText("已保存草稿。")).not.toBeInTheDocument();
  });

  it("reports a successful save only after an input change", async () => {
    render(<RouteInputPage />);
    const field = await screen.findByLabelText("你大概想投什么方向？");

    fireEvent.change(field, { target: { value: "内容运营" } });

    expect(field).toHaveValue("内容运营");
    expect(screen.getByRole("status")).toHaveTextContent("已保存草稿。");
  });

  it("keeps the typed value and shows friendly copy when saving fails", async () => {
    render(<RouteInputPage />);
    const field = await screen.findByLabelText("你大概想投什么方向？");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });

    fireEvent.change(field, { target: { value: "内容运营" } });

    expect(field).toHaveValue("内容运营");
    expect(screen.getByRole("status")).toHaveTextContent(
      "这次没有保存成功，请先不要关闭页面，稍后再试。",
    );
    expect(screen.queryByText(/quota|localStorage|setItem/i)).not.toBeInTheDocument();
  });

  it("does not claim the draft was saved when saving and submission both fail", async () => {
    render(<RouteInputPage />);
    const field = await screen.findByLabelText("你大概想投什么方向？");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    fireEvent.change(field, { target: { value: "内容运营" } });
    fireEvent.click(screen.getByRole("button", { name: "生成今天先做的一步" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        "这次暂时没整理出来。当前填写还保留在页面上，但没有保存成功，请稍后再试。",
      );
    });
    expect(screen.getByRole("status")).not.toHaveTextContent("草稿已经保存在本页");
    expect(field).toHaveValue("内容运营");
  });
});
