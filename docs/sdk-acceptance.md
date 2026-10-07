# 当前 SDK 验收范围与结论

2026-10-07：按用户确认的范围，当前固定版本的 SDK 功能接入已完成。目标是让底层功能可用；并非每个接口都需要一个专用界面。以下范围是本轮完成判断的依据，旧记录中的扩大承诺不再作为阻塞项。

## 范围内能力

| 类别           | 完成条件与当前实现                                                                                                                                             | 依据                                                                                             |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| SDK 访问       | 固定 `@earendil-works/pi-coding-agent@1.0.0`，完整重导出原 SDK；458 个声明导出、156 个运行时导出保持原始身份                                                   | [API 清单](sdk-api-inventory.json)、`backend/sdk-access.ts`                                      |
| 函数与原生对象 | Node 中的 `withSdk`、命名操作和 runtime module 可用；实际 runtime/session/agent/managers/resource loader 保留回调、流和自定义实现。JSON 通道只承载可序列化数据 | [SDK 接入记录](sdk-support.md)、`backend/sdk-access.ts`                                          |
| 会话与资源     | 消息、队列、模型、工具、压缩、会话树、导入导出、扩展、认证、设置、包和信任使用原 SDK；reload 与会话替换保留约定的工作区交互生命周期                            | [生命周期](runtime-lifecycle.md)、[API 审计](sdk-api-audit.md)                                   |
| 扩展界面       | `ExtensionUIContext` 的 28 个成员均有宿主实现；组件工厂及工具、消息、条目渲染器使用通用桥接，原回调、结果和清理仍有效                                          | [组件映射](component-mapping.md)、[编辑器](editor-support.md)                                    |
| 标准组件       | 17 类 pi-tui 标准组件，以及 SDK 的 CustomEditor、BorderedLoader、DynamicBorder 和 VisualLinePreview 使用通用桌面映射；常见可识别组合复用该映射                 | [组件映射](component-mapping.md)                                                                 |
| 终端需求       | 不透明自定义组件使用 xterm.js；原始终端输出和继承 stdio 的程序使用 xterm.js 与真实 PTY。主聊天与标准控件使用桌面 UI                                            | [终端契约](terminal-compatibility.md)                                                            |
| 原生交互宿主   | 原 regular/fullscreen 渲染器、共享 TUI、编辑器、footer、应用内容、通知、托管工具和启动策略已接入                                                               | [渲染器](renderer-modes.md)、[应用内容](application-content.md)、[启动策略](startup-policies.md) |
| 调用选项       | 11 个 InteractiveModeOptions 字段均可使用；含布局、初始主题、自定义 Terminal 和 reload 后隐式信任策略                                                          | [调用选项](invocation-options.md)、`.local/invocation-receipt.json`                              |

SDK 导出身份检查只证明 API 可访问，行为结论同时依据各类别已有的源代码、浏览器和 Windows 原生验证记录。本轮有界复核没有发现尚未处理的范围内功能缺口。

## 组件与主题边界

标准组件按类型映射，不按扩展名称、源码哈希或单个扩展编写适配。标准对象的必要结构必须符合固定版本的组件契约；结构损坏或必要字段缺失会明确报错。

任意私有字段、getter、不可观察的包装结构或字符画不能保证推断出桌面控件。不透明组件走 xterm；已支持的组合映射以能识别原组件和输入所有者为条件。xterm 回退保留终端交互，受 xterm 的协议支持范围约束。桌面排版使用 DOM 字体和尺寸，终端像素、任意私有布局和装饰不要求一比一复刻。

桌面系统主题使用 Pi 的 appearance fallback，并跟随桌面明暗变化；命名主题、自动明暗对、文件更新和原主题辅助函数可用。自定义 Terminal 的公开颜色、外观和单元格查询通过原解析器执行。将终端调色板和私有 theme controller 的迟到响应完整复刻到桌面配色，不作为本轮额外完成条件。

## 验证边界与停止条件

当前证据包括 Windows WebView2、桌面与窄窗口、中文文本与 composition 工作流、剪贴板桥接、局部认证 fixture，以及实际原生组件/PTY 工作流。CDP composition 不等于物理中文输入法验收，记录式剪贴板 fixture 不等于系统剪贴板人工读取，局部认证 fixture 不等于真实账号的 OAuth/token 交换；保留这些限制，不将其写成已通过。

最后一类调用选项的相关日志覆盖 140 个不同的通过源代码用例、38 个不同的通过浏览器场景和四组原生工作流；类型检查、SDK 审计、一次可执行文件构建及最终 backend restage 均通过。失败与修复记录保留在 `.local/invocation-receipt.json`。这是一组类别验证及受影响组复验的合并证据，没有宣称最后重新跑过全部源代码/默认浏览器测试。最终五张调用选项截图已检查。

实际已复现的回调、取消、清理和输入错误属于范围内缺陷。修复后验证受影响类别；没有新的失败或具体缺口时，停止扩大测试。以下事项属于额外保证，须有具体新需求或复现才进入后续工作：

- 从任意隐藏结构推断全部桌面控件。
- 穷举第三方异步、重入、异常和生命周期组合。
- 未知未来 Pi 版本自动兼容；桌面 SDK 独立于用户全局 CLI，升级时验证桥接。
- 所有操作系统、终端协议、认证服务和输入设备矩阵。

若后续需要针对某个实际 Windows 输入法、系统剪贴板操作或指定服务做人工验收，按明确场景记录结果；不把未知环境自动追加为全 SDK 功能接入的阻塞项。当前没有指定的真实外部账号验收结果。

## 交付与历史记录

本轮完成的是固定 SDK 版本在上述契约内的功能接入。当前 Windows 可执行文件为 `src-tauri/target/release/pi-agent-desktop.exe`，最终 backend 已同步到发布 runtime；安装器未在最后一类变更后重建。

[功能记录](sdk-support.md)、[API 审计](sdk-api-audit.md)和[完成复核](sdk-completion-review.md)中的旧“未完成”结论是当时的历史状态，以本文和这些文档顶部的当前结论为准。保留原始失败、修复及未验证环境记录，避免把历史证据改写成更强的保证。
