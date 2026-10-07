# Agent 桌面终端位置参考

核对日期：2026-10-07。复用已有官方页面采集，并重新打开各产品对应官方页面确认；本记录只覆盖终端入口、面板和绑定关系。

## Codex Desktop

OpenAI 官方原 `codex/app/features/#integrated-terminal` 路径目前重定向到 ChatGPT Learn 的集成终端文档。文档明确每个 chat 的终端绑定当前项目或 worktree，通过 `New tab → Terminal` 或 Ctrl + 反引号打开。[OpenAI 官方集成终端文档](https://learn.chatgpt.com/docs/integrated-terminal)

该页面的官方界面示意图将终端画在会话输入区下方，作为工作区内的下方面板；官方快捷键文档也明确列出 `Toggle bottom panel (Codex only)` 和 `Toggle terminal (Codex only)`。这里区分“官方示意图中的下方布局”和“文档明确支持的终端/底部面板切换”，不据此声称所有版本都只能把终端放在底部。[界面示意](https://learn.chatgpt.com/docs/integrated-terminal) · [官方快捷键](https://learn.chatgpt.com/docs/reference/commands)

当前页面与渲染截图记录在 `.local/terminal-placement/codex-features.json`、`codex-shortcuts.json` 和 `codex-integrated-terminal.png`。

## Claude Code Desktop

终端入口位于**当前会话的标题栏**：点击 `Terminal`，或在 macOS / Windows 按 Ctrl + 反引号。窗口太窄时，标题栏相关面板按钮收进旁边的 `⋮` 菜单。展开后是与 chat、diff、browser、file 等并列的独立 pane；官方文档允许拖动标题栏改变位置、拖动边缘调整大小，也允许把 terminal 弹出为独立窗口、再停靠回来。文档没有规定终端必须固定在底部或右侧。[终端入口](https://code.claude.com/docs/en/desktop#run-commands-in-the-terminal) · [面板布局](https://code.claude.com/docs/en/desktop#arrange-your-workspace)

终端在当前会话的工作目录打开，并与 Claude 共享环境；因此它与该会话正在操作的项目文件关联。支持在终端 pane 标题栏点击 `+` 新开终端标签，或右击聊天中的文件夹选择 `Open in terminal`。官方注明集成终端只对本地会话开放；上述面板布局功能要求 Claude Desktop v1.2581.0 或更高。[终端与会话关系](https://code.claude.com/docs/en/desktop#run-commands-in-the-terminal) · [版本要求](https://code.claude.com/docs/en/desktop#arrange-your-workspace)

## DeepSeek Harness

官方网站的 “Everything is a plugin” 展示中，`Terminal` 位于官方插件列表，页面资源中的描述为 “Set command time and output limits”。这是终端相关插件的展示，**不能等同于交互终端的入口或展开面板位置**。同页的 “Developer tools” 展示的是执行轨迹和 bash 调用详情，不能据此当成交互终端。[官方 Harness 页面](https://www.deepseek.com/en/harness/)

本页没有展示已展开的交互终端，也没有说明它固定于底部/右侧、与会话/工作空间怎样绑定、是否支持拖动或停靠。因此这里只确认存在 `Terminal` 插件展示；这些具体布局与生命周期问题在本次所核对的官方页面中**没有足够证据**。[核对来源](https://www.deepseek.com/en/harness/)

## 对 Pi Desktop 的布局建议

终端入口放入当前会话右上方的工具区，与文件/检查器等辅助工具形成一致的位置；展开为主工作区底部的可调高度停靠面板，默认收起。该建议借鉴 Claude 的会话工具入口和 Codex 的下方面板，属于目标产品的适配决定，并不是对 DeepSeek 未公开界面的断言。对话中的命令执行结果继续使用现有工具消息表示。
