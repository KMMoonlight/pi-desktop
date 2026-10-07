# 侧边栏结构与设置布局修复

2026-10-07。范围为用户反馈的侧边栏组织、设置滚动、重叠和提示。

侧边栏采用明确的结构：独立“新建会话” → “工作区”分区标题（搜索、添加） → 按目录分组的会话 → 底部设置。参考官方 Harness 的 [WorkspaceBrowser](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/client/ui-workspace/src/client/rows/WorkspaceBrowser.tsx#L1207) 和 [分区样式](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/client/ui-workspace/src/client/rows/WorkspaceBrowser.module.css#L56)，并保留已有 Claude 官方目录/会话研究的语义边界。不是只修改圆角、颜色或行高。

设置基线复现命令为 `node .local/sidebar-settings-probe.mjs before`。它驱动当前界面的七个分类和五种窗口宽度，直接检查可见子容器压缩及控件重叠。实施前报告九处失败：工具栏只有 24px 内容高度，但实际子项需要 48px；模型列表也被压入内层滚动区，轮换项会消失。基线保存在 `.local/sidebar-settings/before/`。

主要根因和处理：

- 内容区使用 flex 纵列，未声明固定尺寸的子项会缩小；只有部分设置组防止了缩小。改为自然 block 流，让唯一的设置内容区承担滚动。模型列表取消自己的滚动和高度上限，标题/保存区仍固定。
- 提供商操作区被旧 `.provider-row > div:nth-child(2)` 的较高优先级规则赋予 `flex: 1`，操作错在中间。使用设置内的明确身份/操作布局，MCP 与包操作也分成独立组。
- 旧 tooltip 仍使用 Inter，并把路径说明仅藏在 hover 中。tooltip 使用宿主系统/CJK 字体与 320px/视口约束；项目和 Pi 配置路径直接显示并可复制。
- 通知原来在设置遮罩背后的会话区。设置打开时，将同一通知列表放到弹窗内的独立反馈区；不复制通知或修改 SDK 错误来源。
- 下拉触发器被设置滚动区滚出视野时关闭菜单；切换分类/配置范围重置内容滚动。输入字段和 SDK 回调仍使用原有实现。

同名工作区增加父目录标识，完整路径仍在组标题提示中；空会话没有无意义时间。会话相对时间与固定操作共享尾部区域，取消重复固定图标。组内新建显式展开该组。

验收仍限定当前 Windows、1440/1024/768/390/375px；中等窗口加上 600px 高度，覆盖这次实际的短窗口问题。采用先完成两类修改、再集中复验的方式。保留用户当前会话、消息、输入草稿、全局/项目配置以及 1451 预览，不增加 in-app 浏览器 tab。

已完成的只读复核：`node .local/sidebar-settings-probe.mjs after` 对 35 个分类/宽度状态检查通过，九处失败归零，无 pageerror；会话、消息、草稿和设置保持一致。证据为 `.local/sidebar-settings/after/report.json` 与 `preview-after.log`。

集中交互验收覆盖独立新建/工作区分区、同名目录识别、组内新建自动展开、搜索清除与草稿恢复；七分类/五宽/短窗口、密集提供商列表、固定保存栏、切换分类滚动重置、下拉触发器滚出后关闭、可复制路径、tooltip 字体和视口边界、设置内错误通知与关闭。原有工作区注册/取消、设置草稿/范围、SDK 认证/资源、输入框/用量菜单和 xterm 主题保留检查也通过。日志分别为 `grouped-tests.log` 中先通过的五项、`interaction-final.log` 中通过的八项，以及修复提示后 `settings-final.log` 通过的一项；截图在 `.local/sidebar-settings/tests/`。

初轮集中验收中，SDK 资源测试修改测试项目并触发下一项的项目信任弹窗，导致共享 fixture 忙碌和后续七项连锁失败。把资源检查和 UI 检查分开运行，使用新 fixture 后恢复；未修改或绕过应用的信任机制。另一个真实失败是 tooltip 实际仍使用 Inter：Reshaped 覆盖了传入的 `contentClassName`。改为通过 `contentAttributes.className` 绑定样式后，受影响检查通过，包括此前未执行到的配置错误通知断言。未因这些失败增加新的平台或扩展验收矩阵。

最终 Windows release 构建通过，包含 `npm run check`、前端/后端构建和 Rust 编译；日志为 `.local/sidebar-settings/release-build-final.log`，产物为 `src-tauri/target/release/pi-agent-desktop.exe`，未构建安装包。仅有既有的 Vite 大 chunk 提示。使用该产物执行 `node --import tsx tests/native.ts --desktop-workspace` 通过，覆盖真实目录选择器取消、工作区/文件/上下文/固定、设置分类和保存，以及本轮新增的设置滚动重置、无子项压缩和底部保存栏可见断言；没有替换 Tauri invoke。日志为 `native-workspace.log`，截图为 `native-settings-scroll.png`。

原生窗口与临时 fixture 已退出，1540/4331/9225 没有监听；原预览 1451 和其后端 4351 保留。应用设计合同验证通过，零 warning。

实现和可观察验收约定见 [DESIGN.application.md](../DESIGN.application.md#sidebar-structure-and-settings-flow-repair--2026-10-07)。本轮不新增归档、工作区改名、拖拽排序、云环境或新的扩展兼容矩阵。
