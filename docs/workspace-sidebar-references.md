# Workspace 添加与侧栏参考

核对日期：2026-10-07。范围仅为 Claude Code Desktop 与 DeepSeek 官方 Agent Harness 的本地目录选择、添加 workspace、新建会话及侧栏组织。只读取官方文档、官网示意和官方源码；没有操作用户预览、会话或目录。

两款产品都把“在哪个目录工作”和“打开哪个会话”作为明确概念。最适合本项目直接采用的是：目录选择器、按项目分组的紧凑会话列表、独立的展开和新建操作。**DeepSeek 当前的添加 workspace 会接着打开新会话**；本项目采用这一已证实流程，选择确认的文案应交代“添加目录并打开新会话”，避免无提示切走当前任务。取消选择只退出，不登记或新建。

## Claude Code Desktop：文档证明的行为

| 问题 | 已核实内容 | 官方证据 |
| --- | --- | --- |
| 项目目录在哪里选 | 新会话发送第一条消息前，在输入区配置 Environment、Project folder、Model、Permission mode；Project folder 是本地目录或仓库。 | [Start a session](https://code.claude.com/docs/en/desktop#start-a-session) |
| 会话与目录的关系 | 每个会话有自己的历史和项目目录，彼此独立。侧栏列出会话，可同时进行多项任务。 | [Desktop application](https://code.claude.com/docs/en/desktop) |
| 新建的入口 | 侧栏有 `+ New session`，也支持 Ctrl+N；这与选择项目目录是不同步骤。 | [Work in parallel with sessions](https://code.claude.com/docs/en/desktop#work-in-parallel-with-sessions) |
| 分组与筛选 | 侧栏顶部控件可按状态、项目、环境筛选，并按项目分组。 | [Work in parallel with sessions](https://code.claude.com/docs/en/desktop#work-in-parallel-with-sessions) |
| 次要会话操作 | 会话 hover 出现 archive 操作；会话工具栏标题用于重命名；会话菜单可从标题旁或侧栏行打开。 | [Work in parallel with sessions](https://code.claude.com/docs/en/desktop#work-in-parallel-with-sessions) · [Continue in another surface](https://code.claude.com/docs/en/desktop#continue-in-another-surface) |

这份文档没有充分展示一个独立的本地“添加 workspace 注册表”页面，也没有证明点击项目分组标题具体是否切换目录。本次不补写这些行为。Git worktree、环境筛选、并行执行等不在本轮移植范围。

本轮重新下载的完整原文：`.local/workspace-claude-desktop-source.md`，来自 [官方 Markdown](https://code.claude.com/docs/en/desktop.md)。关键段落与既有 `.local/conversation-settings-evidence/claude-desktop-source.md` 相符。

## DeepSeek Harness：官网示意与实际源码分别核对

官网主界面确实展示：独立 `New Session`、`Workspace` 分区标题、分区工具图标、`Default workspace` 目录行，以及该目录下的会话列表。当前会话用低对比度行底色标记。路径、统计信息和会话管理按钮没有同时铺满每行。[官网](https://www.deepseek.com/en/harness/)

官网是渲染的产品示意，不能只凭图标推断添加、取消、折叠的完整交互。本轮继续核对官网链接的官方仓库，固定到 **`5badb15009ae1756c3afe0ae0cef1faafc290ccc`**，不把之后的未知版本算入兼容保证。

| 问题 | 当前官方实现 | 官方源码 |
| --- | --- | --- |
| 添加本地 workspace | 单一路径：选择已有或新建的 host directory；`createWorkspace({ path })` 成功后才通知 `onPick`。侧栏的 `onPick` 接着调用 `startSession(workspaceId)`。README 也明确写“register it and open a Session”。 | [WorkspacePicker.tsx](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/client/ui-workspace/src/client/WorkspacePicker.tsx#L130) · [WorkspaceBrowser.tsx](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/client/ui-workspace/src/client/rows/WorkspaceBrowser.tsx#L1306) · [README](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/client/ui-workspace/README.md#L42) |
| 桌面与 Web 目录选择 | 后端能力区分 native chooser 与 in-app browse。native `pick` 返回绝对路径，用户取消时返回 `null`；没有对应能力的操作会明确拒绝，不能伪装成功。 | [DirectoryPickerController](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/api/workspace-controller/src/directory-picker.ts#L49) · [picker composition](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/client/ui-workspace/README.md#L94) |
| 取消目录选择 | `onCancel` 只关闭选择流程，`createWorkspace` 位于 `onPicked` 分支；因此取消选择不会登记 workspace 或打开新会话。此结论不含此前主动执行的“创建文件夹”磁盘操作。 | [WorkspacePicker.tsx](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/client/ui-workspace/src/client/WorkspacePicker.tsx#L164) |
| 连点与未完成操作 | 目录选择或登记未完成时，picker 的其它选择操作禁用，避免晚到的结果与另一项选择竞争。登记失败有可重试错误界面。 | [WorkspacePicker.tsx](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/client/ui-workspace/src/client/WorkspacePicker.tsx#L84) |
| 项目行点击 | 项目行 `onClick={onToggle}`，维护 `aria-expanded`；只控制组展开、折叠。`onToggle` 不启动会话或切换工作目录。 | [Rows.tsx](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/client/ui-workspace/src/client/rows/Rows.tsx#L219) · [WorkspaceBrowser.tsx](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/client/ui-workspace/src/client/rows/WorkspaceBrowser.tsx#L502) |
| 项目内新建 | 独立按钮 `onCreate`，点击阻止事件冒泡；新建会展开该组并 `startSession`，不等同于组标题点击。 | [Rows.tsx](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/client/ui-workspace/src/client/rows/Rows.tsx#L297) · [WorkspaceBrowser.tsx](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/client/ui-workspace/src/client/rows/WorkspaceBrowser.tsx#L508) |
| 项目操作 | 项目行菜单提供 rename、delete；行内菜单按钮阻止事件冒泡。删除的是注册信息，官方 README 明确保留文件夹与会话日志，会话归入 Ungrouped。 | [Rows.tsx](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/client/ui-workspace/src/client/rows/Rows.tsx#L238) · [README](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/client/ui-workspace/README.md#L52) |
| 列表视觉层级 | 项目行是 folder + title，完整路径移入 hover；会话行是一行 title、相对时间或实际待处理状态，菜单/操作按 hover 显示。长标题默认省略；空白 New Session 不显示无意义时间或历史管理动作。 | [Rows.tsx](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/client/ui-workspace/src/client/rows/Rows.tsx#L160) · [session rows](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/client/ui-workspace/src/client/rows/Rows.tsx#L524) · [blank rows](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/client/ui-workspace/src/client/rows/Rows.tsx#L645) |
| 默认分组 | 默认为平级 workspace sections；嵌套 Workspace Tree 是可选项，展开状态持久化。注册路径不同即不同 workspace，不能仅按目录 basename 合并。 | [README](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/client/ui-workspace/README.md#L42) · [same basename regression](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/apps/web/tests/workspace-management.e2e.ts#L644) |

这些是源码阅读结论；没有声称已经运行或实测 DeepSeek 安装版。它的五条默认会话上限、拖拽重排、归档恢复、层级树、状态筛选、内容检索等机制只是来源背景，不作为本轮验收项。

## 本项目采用的有限适配

以下是 Pi Desktop 的设计决定，服务于用户已明确要求的侧栏范围。

1. **添加有效目录后登记并打开该目录的新会话。** 桌面使用系统目录选择；Web 预览使用能实际访问后端目录的明确选择/填写流程。通过选择器标题或确认文案说明后续会打开新会话；原会话及其草稿保留，成功后才进入新会话，避免无提示切走或把新目录写入原会话。已有 workspace 按真实路径去重，不出现第二个相同项目组。
2. **选择与提交有清楚边界。** 系统选择器取消和空路径不登记、不切换、不初始化 runtime，也不继续弹出另一个路径输入框；无效目录说明原因并允许重新选。选择操作未完成时禁止重复提交。只处理已出现的流程问题，不新增无限异步组合验收。
3. **展开分组只改变列表。** 点击 workspace 名称/箭头展开或收起；组内独立新建按钮携带该组目录；全局新建默认当前 workspace。点击已有会话才进入那条会话，不让组名承担初始化工作目录的隐藏动作。
4. **侧栏用紧凑行替换多层卡片。** 顶部保留新建、添加 workspace、搜索；之后是 workspace 标题和会话行。会话行突出标题与当前选中状态；完整路径作为 hover 信息，同名 workspace 保留路径辨识。次要会话操作使用统一菜单，仍能通过键盘 focus 到达。用户规定的设置入口继续保留在底部，不照搬官网的 Plugins/Automation 主导航。
5. **只移植已有功能。** 保留当前支持的搜索、固定和会话操作；不因参考产品拥有更多项目管理功能，就追加 rename workspace、拖拽重排、归档、worktree、云环境或新的运行隔离语义。

集中验收这类功能时，检查：添加有效目录打开该目录新会话、原会话与草稿可恢复；取消/失败无登记或 runtime 切换；重复路径不重复登记；组展开无新建或初始化；组内新建使用正确目录；同名目录仍可区分；菜单和选中状态在宽/窄布局可读。无需扩大为其它 Agent 或所有系统的完整兼容矩阵。

## 本轮原始证据

- Claude 官方完整 Markdown：`.local/workspace-claude-desktop-source.md`。
- DeepSeek 官网重新获取 HTML：`.local/workspace-harness-source.html`；既有官方渲染截图：`.local/design-evidence/harness-1440.png`。
- DeepSeek 官方仓库 metadata 与完整 tree：`.local/workspace-harness-repo.json`、`.local/workspace-harness-tree.json`。默认分支为 `master`；tree SHA 为上文固定 commit，`truncated=false`。
- 该 commit 的原始文件副本：`.local/workspace-harness-README.md`、`workspace-harness-WorkspacePicker.tsx`、`workspace-harness-WorkspaceBrowser.tsx`、`workspace-harness-Rows.tsx`、`workspace-harness-directory-picker.ts`、`workspace-harness-workspace-management.e2e.ts`。

以上文件来自本轮实际获取的第一方端点；测试源码用来交叉核对文档和实现，不把测试描述当成已在本机执行的产品结果。本轮没有重新研究 OpenAI，既有 Codex 资料仍见 [对话与设置参考](conversation-settings-layout-references.md)。

后续落实：工作区按真实文件夹末级目录命名；添加表单去掉重复的历史路径列表和冗长说明，桌面仍直接使用系统文件夹选择器，浏览器只保留路径输入与确认。实际命名、中文目录、取消、去重和原生验收见 [工作区名称与添加流程](workspace-picker-repair.md)。侧栏最新结构见 [侧边栏结构与设置布局修复](sidebar-settings-repair.md)。
