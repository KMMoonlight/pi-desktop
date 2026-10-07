# Agent 桌面对话与设置结构参考

核对日期：2026-10-07。范围仅为 Claude Code Desktop、Codex Desktop 和 DeepSeek 官方 Agent Harness 的对话层级、操作入口与设置信息结构；不扩展功能、平台或版本验收。

最明确的参考是 Claude 的 **Normal / Thinking / Verbose** 对话详略层级，以及 DeepSeek 的 **简短执行步骤 / 独立执行轨迹检查器**。它们都提供减少正文干扰的机制。设置方面，官方资料能证明一些具体管理入口和配置作用范围，不能据此拼出未展示的完整设置导航。

## 对话过程：已核实的机制

| 产品 | 对话正文和执行过程 | 文件与运行控制 | 证据边界 |
| --- | --- | --- | --- |
| Claude Code Desktop | **Normal**：完整文字回复，工具调用收成摘要；**Thinking**：在摘要工具调用之外显示思考；**Verbose**：展示每次工具调用、文件读取、中间步骤与思考。入口是会话标题旁菜单 → Transcript view，支持 Ctrl+O 切换。[官方章节](https://code.claude.com/docs/en/desktop#switch-view-modes) | 文件改动产生 `+12 -1` 等统计入口，打开独立 diff pane；文件路径可打开文件 pane。停止按钮立即中断；运行时也可以继续发送修正，当前动作完成后处理。[改动审查](https://code.claude.com/docs/en/desktop#review-changes-with-diff-view) · [文件](https://code.claude.com/docs/en/desktop#open-and-edit-files) · [输入与中断](https://code.claude.com/docs/en/desktop#use-the-prompt-box) | 本次确认详略模式和入口，不推断每一种工具卡片的像素布局，也不把文档页面目录当作产品导航。 |
| Codex Desktop | 既有官方 Features 示例把固定会话、Projects、Recents 放在左侧；Add 菜单提供文件、Goal、Plan mode 和插件入口。集成终端示例在输入区显示模型、思考等级与工作环境选择。[Features 示例](https://learn.chatgpt.com/docs/features) · [输入区示例](https://learn.chatgpt.com/docs/integrated-terminal) | 官方快捷键文档分别列出 Open review tab、Toggle file tree、Open model picker；说明这些有独立入口。[官方命令与快捷键](https://learn.chatgpt.com/docs/reference/commands) | 本轮无法重新访问 OpenAI 官方相关页面，以上复用已保存的官方页面正文和截图；没有足够证据确认它具体怎样折叠思考、工具、一次执行的分组或最终结果。 |
| DeepSeek Harness | 官网主界面示意中，用户消息是右侧气泡，助理回复是主内容列；`Thought for a while` 是低强调的可展开样式摘要。插件开发演示把 Load skill / Read / Thinking / Write 等显示为紧凑步骤行，文件写入行带路径和增删统计；工具过程与文字回复采用不同的视觉层级。[官网主界面与 Everything is a plugin 演示](https://www.deepseek.com/en/harness/) | 官网另设 Developer tools 展示执行轨迹：Input / Model / Tools 时间线、按 Turn 分组的事件，以及 Summary / Payload / Result / Schema / Timing 详情。文件成果展示为可识别文件卡片，改动使用独立 `Review · turn 1` 视图。[官网 Developer tools / Complete a range of tasks 演示](https://www.deepseek.com/en/harness/) | 本次打开并截图核对的是官网演示，不能当作已实测安装版全部行为；官网没有充分展示停止、取消、审批等交互流程。 |

Claude 官方对话层级原文，已从本轮取得的完整官方 Markdown 核对：

> **Normal** — Tool calls collapsed into summaries, with full text responses
>
> **Thinking** — Tool calls collapsed into summaries, plus Claude's thinking
>
> **Verbose** — Every tool call, file read, and intermediate step Claude takes, plus Claude's thinking

原文保存于 `.local/conversation-settings-evidence/claude-desktop-source.md` 的 `### Switch view modes`；既有 `.local/modern-evidence/claude-desktop.json` 完整正文也有同段内容。[原始官方 Markdown](https://code.claude.com/docs/en/desktop.md)

## 设置：真实管理入口与配置范围分别看

| 主题 | Claude Code Desktop | Codex Desktop | DeepSeek Harness |
| --- | --- | --- | --- |
| 分类导航 | 官方明确出现 **Settings → Claude Code** 与 **Settings → Connectors**，但本次没有完整设置窗口截图，不声称已经核实所有分类的顺序和布局。[Claude Code 入口](https://code.claude.com/docs/en/desktop#whats-not-available-in-desktop) · [Connectors 入口](https://code.claude.com/docs/en/desktop#connect-external-tools) | 已有官方快捷键资料明确 **Settings → Keyboard Shortcuts**；本轮未核实完整分类导航。[官方快捷键](https://learn.chatgpt.com/docs/reference/commands) | 官网侧栏示意展示独立 **Plugins** 和 **Automation** 入口；没有展示完整 Settings 分类导航。[官网主界面](https://www.deepseek.com/en/harness/) |
| 模型与账号 | 模型选择在发送按钮附近，允许会话中切换；桌面应用先登录账号。资料没有展示一个聚合所有模型提供商与账号的设置页。[开始会话](https://code.claude.com/docs/en/desktop#start-a-session) · [共享配置](https://code.claude.com/docs/en/desktop#shared-configuration) | 既有官方输入区示例显示模型与思考等级选择；本轮未核实账号设置的完整布局。[官方输入区示例](https://learn.chatgpt.com/docs/integrated-terminal) | 官网输入区示意展示模型和思考等级，不足以确定账号或服务商设置结构。[官网主界面](https://www.deepseek.com/en/harness/) |
| MCP / 连接 | `+ → Connectors` 添加；**Manage connectors** 或 **Settings → Connectors** 管理/断开。Connectors 是有图形配置流程的 MCP 服务；未列出的 MCP 仍通过配置文件添加。[连接入口和管理](https://code.claude.com/docs/en/desktop#connect-external-tools) | 本轮未核实其 MCP 设置页面结构。 | 官网展示插件式扩展，但没有足够证据描述独立 MCP 设置页。[官网](https://www.deepseek.com/en/harness/) |
| 插件 / 扩展 | `+ → Plugins` 查看已安装插件和技能；**Add plugin** 打开市场浏览，**Manage plugins** 用于启停和卸载；插件可安装在 user、project 或 local-only 范围。[插件入口](https://code.claude.com/docs/en/desktop#install-plugins) | 官方 Features 示例在 Add 菜单列出插件入口；没有据此确认整个管理页。[官方示例](https://learn.chatgpt.com/docs/features) | 官网展示单独插件列表，区分 Official / Installed，含 Add plugin；插件不仅扩展工具和技能，也可以扩展界面。[官网 Everything is a plugin](https://www.deepseek.com/en/harness/) |
| 全局 / 项目 | **文件配置的范围**已明确：User 对本机全部项目生效；Shared project 对项目及使用已提交配置的协作者生效；Project local 只作用于本人的该项目。桌面与 CLI 共享相关文件。这不是“桌面设置页每项都有一个统一范围切换”的证据。[作用范围](https://code.claude.com/docs/en/settings#settings-files-and-who-they-affect) · [桌面共享配置](https://code.claude.com/docs/en/desktop#shared-configuration) | 本轮未核实全局/项目配置如何在桌面 UI 中表达。 | 主界面有 Workspace 区域；不能由此推断每个设置字段的作用范围。[官网主界面](https://www.deepseek.com/en/harness/) |
| 外观与高级配置 | 本次资料证明可以直接编辑共享配置文件管理权限与配置；没有核实桌面外观页以及高级 JSON 编辑器的具体版式。官方文件文档中的终端 theme 示例不能当作桌面外观导航证据。[共享文件](https://code.claude.com/docs/en/desktop#shared-configuration) · [配置入口边界](https://code.claude.com/docs/en/desktop#whats-not-available-in-desktop) | 本轮未核实外观与高级配置页面布局。 | 官网未展示这两类完整设置页。[官网](https://www.deepseek.com/en/harness/) |

## 可以借鉴什么，哪些仍是设计决定

有直接来源支持的机制是：正文先显示完整文字答复；工具与思考有可调详略；改动、文件、轨迹详情有专用审查区域；添加与管理连接/插件使用不同入口；配置范围有真实含义。[Claude 对话详略](https://code.claude.com/docs/en/desktop#switch-view-modes) · [Claude 连接](https://code.claude.com/docs/en/desktop#connect-external-tools) · [Claude 插件](https://code.claude.com/docs/en/desktop#install-plugins) · [DeepSeek 轨迹演示](https://www.deepseek.com/en/harness/)

将 Pi Desktop 具体划分为哪些设置分类、是否使用左侧设置导航、怎样展示保存状态、是否按一次执行分组工具、默认何种显示模式，仍属于目标产品的设计决定，不能包装成三款产品已共同使用的“统一规范”。本记录没有证明未来版本、任意第三方扩展或所有系统的行为。

## 证据与访问状态

- 本轮重新获取的 Claude 官方完整 Markdown：`.local/conversation-settings-evidence/claude-desktop-source.md`、`claude-settings-source.md`。HTML 浏览失败后，官方 `.md` 端点读取成功；不是搜索摘要或二手文章。
- 本轮重新打开 DeepSeek 官网采集：`.local/conversation-settings-evidence/harness.json`；截图 `harness-main-conversation.png`、`harness-execution-steps.png`、`harness-plugin-demo.png`、`harness-developer-trace.png`。截图均为官方页面渲染的示意。
- DeepSeek 既有插件管理与 Review 示意来源：`.local/design-evidence/harness.json`、`harness.html`，以及 `harness-Everything-is-a-plugin.png`。本轮官网正文再次确认相同机制；不将其宣传演示解释为真实文件操作测试。
- Codex 已有官方采集：`.local/modern-evidence/codex-features.json`、`codex-features.png`，`.local/terminal-placement/codex-features.json`、`codex-integrated-terminal.png`、`codex-shortcuts.json`。旧 developers 路径此前重定向到 Learn，本文引用最终的 Learn 地址。
- 本轮 Codex 官方设置/Features 访问出现连接关闭或超时；Google 针对官方域名的搜索触发了验证码，没有用它作为事实来源。没有因此补写未公开或未核实的设置内容。

以上为研究结果。本轮没有修改产品代码或用户设置，也没有新增 in-app 浏览器标签。

## 当前 Pi Desktop 的实际差异

本节是本项目的只读观察和设计建议，不是对其他产品界面的描述。
本轮没有修改应用代码、会话内容或配置。

| 当前结构 | 对使用的影响 | 建议 |
| --- | --- | --- |
| 正文、思考和独立工具卡片按 SDK 消息顺序连续显示 | 阅读一轮任务时，过程细节与最终答复竞争注意力 | 保留时间顺序，以一次用户请求为视觉分组；工具用简短步骤摘要，结果答复保持正文层级 |
| 工具外层显示工具名和状态，内部继续使用原 Pi renderer | 同一个步骤可能重复展示技术名称和较长输出 | 标准工具显示“动作 + 目标 + 状态”，详情保留原组件和回调；交互工具保持可见、可操作 |
| 思考开关和工具展开分散在设置、检查器、各消息 | 用户难以快速选择“阅读结果”或“查看执行” | 在会话菜单提供普通 / 思考 / 详细视图预设，逐项展开继续有效；展示预设不改变模型推理等级 |
| 常规页同级放默认模型、消息投递、缓存预热、压缩 token 阈值、重试毫秒、外观、项目信任 | 不同使用频率和作用范围混在一个长表单中 | 常规保留常用默认行为；外观独立；缓存、token 和重试细节进入高级；项目信任进入项目 |
| 页面统一显示全局 / 项目切换，但账号、显示、信任等动作有各自真实作用范围 | 切换范围后容易误以为本页所有操作都写入项目 | 只在支持该范围的页显示范围选择；字段标明继承或覆盖，保持 SDK 的真实持久化语义 |
| 一部分设置即时生效，另一部分依赖位于长表单底部的保存按钮 | 用户难以判断修改是否已生效 | 明确生效方式；对草稿编辑提供可见的保存状态和统一保存区 |
| MCP 添加表单、原始 JSON 参数常驻；扩展安装输入常驻 | 已安装项的管理与首次添加互相干扰 | 默认先展示已配置项和状态，用“添加”打开表单；完整配置编辑进入明确的高级入口 |
| 设置页仍保留项目历史侧栏和会话文件 / 终端按钮 | 会话导航与设置分类导航竞争同一工作区 | 设置采用分类侧栏 + 内容区，并保留返回工作区入口；会话工具留在会话工作区 |

当前证据：`.local/conversation-settings/current-inventory.json`、
`current-settings-general.png`、`current-settings-models.png`、
`current-settings-mcp.png`、`current-settings-packages.png`、
`current-settings-advanced.png` 和 `current-conversation.png`。
本轮截图复核了五个设置页；前后会话 ID、消息数、草稿、全局设置与项目设置
均保持不变，未出现页面错误。工具展示还参考了已有的
`.local/workspace-evidence/tools.png` 与
`.local/screenshots/tool-display-1440-partial.png`；这些截图中扩展 fixture 的
自定义文案不当作产品字段。

## 建议应用到本项目的布局

对话保持一条清晰的阅读主线：用户请求 → 执行中的简短说明和工具步骤 →
最终答复 / 文件结果。思考和工具日志通过展开查看；运行中的步骤、失败和
需要用户输入的控件显式显示。排查检查器可展示完整参数、输出和 SDK 状态。
建议先做到摘要和详情的层级，再考虑整轮折叠；不重排中途答复，不隐藏待处理
交互，也不为第三方 self renderer 强制套用标准工具摘要。

设置建议按下面的分类组织已有功能，采用分类侧栏和一列易扫描的设置行。
这是一份本项目的应用建议，不宣称任何参考产品使用完全相同的分类：

| 分类 | 收纳已有内容 |
| --- | --- |
| 常规 | 会话默认行为、执行中消息投递 |
| 外观与显示 | 主题、思考与工具展示偏好 |
| 模型与账号 | 已连接提供商、添加账号、默认模型、轮换范围；自定义端点通过高级入口访问 |
| 项目 | 当前项目、项目信任、可覆盖的项目设置与继承来源 |
| MCP | 已配置服务器、连接状态；添加或编辑服务器单独打开表单 |
| 扩展 | 已安装包、更新和移除；添加包单独打开表单 |
| 高级 | 缓存策略、压缩阈值、重试细节、原始配置和运行信息 |

上述调整只改变已有功能的组织和显示方式。它不新增权限模式、并行任务、
worktree、新的认证服务，也不改变 Pi SDK 配置、扩展回调或 xterm 的归属。
