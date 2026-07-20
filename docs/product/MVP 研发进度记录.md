# MVP 研发进度记录

更新时间：2026-07-20

## 当前阶段

已进入研发阶段第一轮，完成从空仓库搭建新 MVP 工程骨架。

本轮没有沿用旧页面、旧接口或旧报告结构。

## 已完成

- 完整阅读并对齐 10 份产品 / UX / UI / 数据 / AI 文档。
- 新增《MVP 研发边界决策.md》，固定首版研发边界。
- 搭建 Next.js + React + TypeScript + Tailwind 单体应用。
- 实现首页 / 今日入口。
- 实现四条当前卡点入口。
- 实现路线轻输入页。
- 实现路线输出 + 今日行动卡页。
- 实现路线定制记录页。
- 实现即时轻复盘页。
- 实现我的求职轨迹页。
- 实现浏览器本地草稿和记录保存。
- 实现记录编辑、删除、清空。
- 实现 mock AI 编排，不依赖 DeepSeek / Qwen key。
- 实现四路线独立 mock 输出。
- 实现基础安全检查。
- 使用 Code Reviewer agent 审查并修复 Critical / Important 问题。

## 当前验证

已通过：

- `npm.cmd test`
- `npm.cmd run lint`
- `npm.cmd run build`
- `/api/ai` 四路线冒烟测试

最新测试结果：

- 5 个测试文件通过。
- 13 个测试用例通过。

## 当前本地预览

开发服务器已启动：

```text
http://localhost:3000
```

## GitHub 状态

当前机器缺少 GitHub CLI：

```text
gh : The term 'gh' is not recognized
```

当前目录最初也不是 git 仓库，且没有 GitHub remote。

因此本轮无法安全完成 GitHub 推送。已改为先完成本地 git 初始化、提交和 tag。后续推送到 GitHub 需要主人提供以下任一项：

- 已创建好的 GitHub 仓库地址；或
- 允许创建新 GitHub 仓库的明确仓库名与可用 GitHub 认证方式。

## 重要研发边界

- 第一版不做通用自由问 AI。
- 第一版不做报告生成器。
- 第一版不做账号、支付、岗位库、自动抓取 JD、自动投递。
- 用户真实记录默认保存在浏览器本地，服务端不持久化用户原文。
- 每次输出必须落到一个今日行动、补信息行动或轻复盘。

## 下一步建议

1. 安装并登录 GitHub CLI，或提供 GitHub remote。
2. 推送当前本地提交和 tag。
3. 继续补 Playwright 端到端测试。
4. 接入真实 DeepSeek / Qwen provider 前，先补日志脱敏和成本护栏。

