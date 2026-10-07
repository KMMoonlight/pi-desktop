# Pi Desktop 与 DeepSeek Harness 共有界面差异清单

> 历史样式审计。其“80 项已覆盖”不代表全部交互完成；文件单层导航、
> 路径表单等旧“产品适配”结论已被本次修复替代。
> 当前交互清单和验收以 [全应用交互复核](ui-interaction-omissions.md) 为准。

2026-10-07。官方源码固定到 `5badb15009ae1756c3afe0ae0cef1faafc290ccc`。官网示意、真实源码与本机 Pi 渲染分开记录；没有声称运行了 Harness 安装版。

本清单包括 **37 项主界面细节 + 43 项辅助界面细节，共 80 项**。辅助项逐条见 [secondary audit](deepseek-shared-secondary-audit.md)，其 S01–S11、M01–M07、C01–C03、P01–P05、F01–F06、D01–D06、T01–T05 是本清单的组成部分。来源产品独有业务、已对齐行为及合理的 Pi 差异也明确列出，不将它们当作缺失功能。

## 依据与验收边界

Pi 基线：`.local/harness-audit/before-*.png`、`target-baseline.json`；保留预览在 1451。官方完整源码副本在 `.local/harness-source/`，官网当前截图为 `official-current.png`。

- [A1 主题角色](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/client/ui-theme/src/styles/design-platform.css)
- [A2 基础字体与尺寸](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/client/ui-theme/src/styles/base.css)
- [A3 列宽和收起阈值](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/client/ui-layout/src/client/columns.ts)
- [A4 工作区/会话行](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/client/ui-workspace/src/client/rows/Rows.module.css)
- [A5 会话标题、标签和内容宽度](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/client/ui-conversation/src/client/skeleton/ConversationRoot.module.css)
- [A6 输入框](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/client/ui-conversation/src/client/skeleton/InputBar.module.css)
- [A7 模型选择](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/client/ui-model-selection/src/client/ModelSelect.module.css)
- [A8 菜单](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/client/ui-primitives/src/Menu.module.css)
- [A9 上下文用量](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/client/ui-conversation/src/client/skeleton/ContextMeter.module.css)
- [A10 消息](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/client/ui-chat/src/client/chat/MessageItem.module.css)
- [A11 对话流](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/client/ui-chat/src/client/chat/ChatView.module.css)
- [A12 工具摘要](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/client/ui-tool/src/client/tool/components/ToolRow.module.css)

只验证当前 Windows、1440/1024/768/390/375px 与深色代表状态。保留 SDK、扩展组件映射和原 renderer/回调、xterm.js。每个大类完成后集中验证，再修真实失败。用户会话、草稿与配置不得因验收改变。

## 主界面逐项清单

| ID | 共有功能 / 官方机制 | Pi 基线差异 | 实施决定 / 验收 |
| --- | --- | --- | --- |
| U01 | Light canvas #fff、sidebar #f9fafb；dark #151517/#1b1b1c [A1] | #fafaf9/#f1f2f4，dark偏蓝 | 对齐角色，默认保留用户 light 偏好；深色单独核验 |
| U02 | 主/次/弱文本分层，business blue #4176e6/#7aaaff [A1] | 多处使用同一个弱灰，accent估计值 | 主标题/描述/元信息分别映射，Pi 扩展主题独立 |
| U03 | 系统字体含 Segoe UI 与 CJK fallback [A2] | Reshaped root覆盖宿主字体 | 宿主/portal明确字体；正文保留 SDK 原主题 |
| U04 | 4/8/12/16/20/28 圆角；短过渡 [A2] | 7/9/10/19px混用 | 导航12、bubble20、composer28、菜单12；保留功能特定尺寸 |
| U05 | 默认侧栏280，1024附近自动收起 [A3] | 252px，800阈值 | 280px列，1024以下抽屉；手动打开仍有效 |
| U06 | 项目34px、会话32px，14/20文本 [A4] | 12px项目名、34px会话且图标/日期争夺宽度 | 项目/会话紧凑行与14px标题，日期更弱 |
| U07 | folder 默认，hover出现disclosure；独立新建 [A4] | folder与箭头同时常驻 | 使用同一16px槽，hover/focus显示箭头；组+仍独立 |
| U08 | 低对比selected/hover，次要actions hover/focus [A4] | 重active填充，日期与pin同等显眼 | tonal selection，pin保持可达；不新增归档等业务 |
| U09 | 长标题省略/hover，全路径可辨 [A4] | 已有省略和路径tooltip | 保留；不新增marquee或同名目录合并 |
| U10 | 展开状态与会话选择独立 [A4] | 原生details状态可被rerender覆盖 | 显式保存折叠偏好；搜索时展开，退出恢复 |
| U11 | 注册有效路径成功后打开新会话 | 当前已经对齐 | 保留目录选择、取消无副作用、去重及草稿恢复，复用已有验收 |
| U12 | 新建/搜索/工作区分类，设置在底部 | 新建outline，添加按钮被Hint包裹导致样式遗漏 | 顶部动作统一透明hover行，补齐包装后选择器 |
| U13 | 标题+tabs总76px，30px title、下划线tabs [A5] | 56+43px，pill tabs | 连续标题50px+26px tabs，13px、2px active underline |
| U14 | 空会话隐藏重复标题/复杂tabs [A5] | 空会话仍全部显示 | 保留用户要求的会话目的地入口，标题减噪；这是明确产品适配 |
| U15 | chat clamp(680,column*.64,920)，composer宽+32 [A5] | 固定820，共享内边距但avatar造成轴错位 | 用容器宽度适配中心measure与+32；窄列留16px正文/8pxcomposer |
| U16 | headline26/32、短文本、hero输入最小52 [A5][A6] | headline最高32、固定112px textarea | 26px主标题，空态两行输入最小值；保留Pi标识和任务starter |
| U17 | docked输入一行起、自动增长到14行 [A6] | 固定112px、min90浪费正文空间 | 自适应textarea；CJK/换行/粘贴/清空/resize统一验收 |
| U18 | composer28圆角、柔和stroke/shadow [A6] | 19px outline与focus额外套边 | 单一carrier、28px、轻stroke与清楚focus ring |
| U19 | 左attachment/modes、右model/effort/send [A6][A7] | model/thinking左，metrics右 | 移模型组到右侧；Pi context仍在输入框内；窄屏有序换行 |
| U20 | model trigger28px、13/20、transparent [A7] | 36px通用field，provider长名 | composer专用compact variant，菜单仍显示完整provider label |
| U21 | menu min240/max420，内部滚动、4pxpadding [A7] | 根据trigger宽度无限增宽，6pxpad，12px字 | 最大420、34px rows、13px字，测量实际高度避免长label越界 |
| U22 | 菜单portal、viewport12px，Escape/focus [A8] | select已portal；sessionmenu Escape实测不关闭 | 共用轻材料、Escape关闭sessionmenu并恢复trigger焦点 |
| U23 | settings enums36px填充，无outline [A1] | 所有settings select transparent，像无控件文字 | 设置枚举filled，scope嵌入式，text/path/key仍outline |
| U24 | 圆形context progress + percent，轻量popup [A9] | Gauge图标；点击打开大检查器 | 输入内小圆进度及264px用量弹层；完整检查器保留显式按钮 |
| U25 | 生成反馈不挤主操作 | 已有 SDK count与host timing，历史无tok/s | 保留真实速率、compact反馈；不伪造旧会话速率 |
| U26 | send为圆形，明确disabled态 [A6] | 34px圆角方块 | 圆形32px，发送/停止可辨；不改发送/队列语义 |
| U27 | attachments右对齐、与text分开 [A10] | 图片/文件在正文块、composer附件pill | 保留已有附件语义，调整gap和thumbnail材料，无新deliverables业务 |
| U28 | user bubble20px、pad10 16、14/22、lightblue [A10] | 16px、12 16、gray，metadata在bubble内 | 独立bubble+actions行、fit短内容、限定长内容及code |
| U29 | user cap min(chat*.702,82%) [A10] | 85%/680px，窄屏95% | 70.2%/82%上限；窄列允许92%；更新SDK layout probe保持准确 |
| U30 | actions在bubble外，hover/focus可达 [A10] | actions占内部bubble和height | move metadata到独立行；copy/fork/time不丢，键盘/touch可达 |
| U31 | assistant是无avatar主文档 [A11] | avatar占37px，response与composer轴偏移 | assistant正文齐中心轴，保留作者语义与可选正文 |
| U32 | process gap6、response gap12 [A11] | 每message 14+22padding，turn32gap | 降低过程空洞，user到response仍有明显节奏 |
| U33 | 工具24px摘要、13/24，展开细节 [A12] | 摘要框较宽、state10px | 紧凑单行摘要，original custom renderer/展开回调仍工作 |
| U34 | 思考紧凑disclosure，详细trace独立 | 已有normal/thinking/detailed | 保留视图语义，只调disclosure和text材料 |
| U35 | 代码13pxmono、轻header、独立scroll | mono缺CJK fallback，一些largepadding | 系统code stack含CJK，header/scroll材料对齐，SDK字体不改 |
| U36 | 文件/审查作为辅助pane，body measure相应缩窄 [A3] | 已有右pane+唯一files导航 | 对齐38px chrome与line密度；保留单入口与源码line跳转 |
| U37 | labels/gutters不选，正文与input可选 | 基本已实现，部分header/description继承不清 | 控件labels和gutter明确none，正文/code/path/输入可选 |

## 实施类别与证据

1. **基础、导航及下拉框**：U01–U14、U20–U23。集中验证 workspace/disclosure/search/取消/菜单键盘和五宽。
2. **会话与输入**：U15–U19、U24–U35、U37。集中验证布局、实际SDK Markdown宽度、内容选择、copy/fork、生成速率、editor/附件和扩展renderer。
3. **设置及管理页面**：secondary S/M/C/P。集中验证modal/focus/关闭、未保存草稿、scope、主题、账号连接、MCP/包表单和回调。
4. **文件/更改/资源及终端**：U36、secondary F/D/T。集中验证源码、diff、资源命令、终端theme/resize/输入和native xterm；Windows release构建。

下表记录最终实施状态；“保留”是已有行为或明确的 Pi 产品适配，不计为新功能。

## 最终实施状态

| 项目 | 状态 | 最终结果 |
| --- | --- | --- |
| U01–U08 | 已实施 | 官方运行时中性主题、系统/CJK 字体、280px 侧栏、34/32px 项目和会话行、共享 folder/disclosure 槽、轻量选中态 |
| U09、U11 | 已对齐并保留 | 长标题省略及完整路径提示；目录注册成功才创建会话，取消不改变会话/草稿，工作区去重 |
| U10、U12–U13 | 已实施 | 折叠偏好持久化，搜索临时展开；顶部轻量动作、底部设置；标题和下划线 tabs 共 76px |
| U14 | Pi 产品适配 | 空会话仍保留用户要求的四个会话目的地，不套用 Harness 隐藏 tabs 的规则 |
| U15–U24、U26 | 已实施 | 正文/输入中心轴、28px 自增高 composer、右侧模型/思考、圆形发送、边界内菜单、设置枚举填充、context 圆环和轻量弹层 |
| U25 | 已有能力整理 | 展示实际 SDK output tokens 和本次生成计时所得 tok/s；无历史计时的会话只显示 tokens |
| U27 | Pi 产品适配 | 保留 SDK 附件语义和真实图片/文件，调整间距，不从任意输出推断成果列表 |
| U28–U33、U35–U37 | 已实施 | 20px 短内容气泡、气泡外动作、无 avatar 的助手文档、紧凑过程、CJK 代码字体、单文件入口和可选正文/不可选 label 与行号 |
| U34 | 已有能力整理 | 保留 normal/thinking/detailed 及原 SDK renderer，只整理 disclosure 的外层样式 |
| S01–S09 | 已实施 | 设置改为 800px modal、188px 图标导航、独立滚动、明确关闭/焦点、字段说明和按用途区分的输入材料 |
| S10–S11 | Pi 产品适配 | 保留全局/项目真实覆盖及保存/立即生效语义，不新增虚构的逐字段继承状态 |
| M01–M04 | 已实施 | 提供商卡片、明确凭证状态、单卡连接/管理展开和列表末尾添加入口 |
| M05–M07 | Pi 产品适配 | 原 SDK OAuth/API Key 请求继续工作；模型轮换保持原语义；不引入 DeepSeek 主账号、余额或充值 |
| C01–C03 | 已实施通用样式适配 | 官方无独立 MCP 页；Pi 页使用同一表单/卡片材料，错误紧邻表单，取消恢复焦点，包 source 保留完整路径 |
| P01–P02 | 已实施 | 包页简洁标题、轻量操作、短包名与可复制 source、hover 行 |
| P03–P05 | Pi 产品适配并保留 | 仅展示真实安装包；已有添加/等待/失败草稿保留；资源、树和 SDK 扩展交互仍在会话工作区 |
| F01、F03–F06 | 已实施 | 去掉重复面板标题；38px 工具栏/路径、13px 源码、低对比目标行，空状态与读取失败明确区分 |
| F02 | 已实施样式，保留导航模型 | 紧凑文件行；Pi 仍为逐级目录导航，保留返回、路径和文件链接跳转 |
| D01–D05 | 已实施 | 当前 Git 更改摘要、独立统计/复制、22px diff、独立符号和不可选行号、内容内横向滚动 |
| D06 | Pi 产品适配 | 只有真实附件与文件链接，不猜测 SDK 未提供的 presented-file 元数据 |
| T01–T02 | 已实施 | xterm 默认色跟随主题，保持实例/PTY/输出及 OSC 覆盖；38px 中性工具栏与明确异常状态 |
| T03–T05 | 已整理外层并保留 | 单终端无新增改名业务，仍在底部可调高度 dock；扩展 modal 焦点与原 shell renderer 保留 |

以上逐组覆盖全部 **80 项**，没有把已对齐项、合理差异或参考产品独有业务算作新增实现。

## 实际验收证据

实现按四个大类集中验收；发现的问题修复后只重跑受影响的检查。

| 大类 | 已通过的范围 | 日志 / 渲染证据 |
| --- | --- | --- |
| 导航、workspace、下拉框 | 注册/取消/无效目录/去重、独立新建、分组和固定、搜索/折叠恢复、键盘/Escape、边界定位、五种宽度 | `.local/harness-audit/navigation-repaired.log`、`settings-repaired.log`、`evidence-final.log`；`.local/workspace-polish-evidence/` |
| 会话和输入 | 默认 SDK editor 的增长/清空/输入、短/长气泡、动作、原 Markdown 宽度/transformer/renderer、实际 tokens/tok/s、context 弹层和菜单 | `conversation-tests.log`、`conversation-repaired.log`、`conversation-final.log`；`after/conversation-*.png` |
| 设置、认证和资源 | 七个分类、关闭/恢复焦点、未保存草稿、scope/保存、深色下拉框、原 SDK 认证和资源操作、MCP/包添加取消 | `settings-tests.log`、`settings-repaired.log`、`settings-final.log`、`evidence-tests.log`；`after/settings-*.png` |
| 文件、更改和终端 | 五宽文件面板/草稿/dock、编码路径与指定行、复制/附件/diff、原组件 pointer/focus、延迟色彩请求、主题切换保留同一 screen/PTY 和 OSC 自定义色 | `evidence-tests.log`、`evidence-final.log`、`terminal-final.log`；`.local/workspace-evidence/`、`after/terminal-dark.png` |

初轮发现的实际缺陷为：默认 SDK 映射编辑器未自动增高、Ctrl+, 被更早的 SDK 捕获监听拦截。均已修复并通过对应集中复验。其余失败来自旧验收流程：在设置 modal 外点击背景、账号连接方式未先展开、发出 prompt 后未等待 busy 结束、粘贴被 SDK 转为 paste marker、旧固定深色断言。脚本同步了当前产品行为；原输入/回调与 OSC 检查仍保留。

保留预览 **http://127.0.0.1:1451/** 的只读复核覆盖对话、模型、context、菜单、文件、资源、树和全部设置页。`target-final.json` 与 `preview-final.log` 确认会话、消息内容、草稿、全局/项目设置一致，无 pageerror 或页面横向溢出。计算值确认 sidebar280、header50+tabs26、composer28、settings800/rail188、files toolbar38，light 角色值与官方运行时对应。未添加 in-app 浏览器 tab。

Windows release 构建通过，产物为 `src-tauri/target/release/pi-agent-desktop.exe`，日志 `release-build.log`；本轮未构建安装包。原生 workspace 检查通过（`native-workspace.log`），原生终端 PTY/输入/resize/原组件回调及主题/OSC 检查通过（`native-terminal-final.log`）。初次原生终端复验遇到 tsx 序列化测试回调的 `__name` helper；移除测试回调内的命名函数后通过，应用代码没有因此改变。最终 `npm run check` 通过（`final-check.log`），应用设计合同验证通过，0 warning。构建只有既有 Vite 大 chunk 提示，无编译错误。

临时测试端口 1540、4331、9225 已关闭；仅保留原预览 1451 与其 backend 4351。测试浏览器和原生窗口已退出。

验收终点仍是当前 Windows、1440/1024/768/390/375px 和深色代表状态。保留 SDK/扩展通用映射/xterm，不新增未知版本、任意私有组件或全平台兼容矩阵。

2026-10-07 后续反馈修复：侧边栏进一步落实官方独立 New Session 与工作区分区标题的结构；设置消除 flex 压缩和嵌套列表滚动，并修复提示与遮罩背后的通知。新的基线、集中交互和原生验收记录见 [侧边栏结构与设置布局修复](sidebar-settings-repair.md)，以上旧截图/报告不是这两类的最新状态。本次没有重新扩大 80 项审计范围。
