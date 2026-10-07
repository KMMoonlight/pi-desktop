# 工作区名称与添加流程

> 历史记录：路径表单不再是当前浏览器添加流程，也不再排除目录浏览器。
> 新会话工作区选择与可浏览目录已在 [全应用交互复核](ui-interaction-omissions.md) 中实现。

2026-10-07。范围限定为用户反馈的文件夹命名与添加弹窗，不增加工作区改名、移动文件夹或完整 Web 文件浏览器。

工作区名称来自真实路径的末级目录，既有 `SessionRail` 已使用 `baseName(group.cwd)`。当前 1451 预览的两个注册路径分别在测试临时目录中，末级目录都实际叫 `workspace`；没有硬编码显示名称。此次未把测试目录伪装成用户项目，也未切换用户的当前会话。集中验收实际创建 `桌面项目 pi-agent` 文件夹，确认登记后显示该完整名称，并在这个文件夹新建会话；同名目录仍通过父目录和完整路径区分。

继续采用已有的 [官方参考](workspace-sidebar-references.md)：DeepSeek 官方 `WorkspacePicker` 的 add-only 入口直接进入目录选择流程，注册后打开会话；Claude 的 Project folder 选择本地任务目录。已登记的工作区由侧栏负责导航，无需在添加表单中重复列出历史目录。

桌面端直接打开系统文件夹选择器，标题改为“选择文件夹并新建会话”。浏览器预览保留必要的路径输入，弹窗现只有“文件夹路径”、取消和“添加并新建会话”，删除冗长说明与历史路径列表。标题统一为“添加工作区”，输入框打开时自动聚焦；空输入禁用提交，错误直接显示在字段下方，编辑路径后清除错误。正常布局的弹窗从约 357px 高缩至 203px，五种宽度下没有页面横向溢出。

添加接口返回当前会话快照，不能把其中的 `cwd` 当作用户新选择的目录。创建新会话继续使用输入或选择的路径，由 SDK 解析；复验发现并修正了本次调整中错误使用返回值的问题。初轮还发现字段没有自动聚焦；通过字段自身的 `autoFocus` 修复，不依赖 overlay 动画结束回调。其它调用的错误仍沿用原有通知行为。

集中浏览器验收中，工作区分区、同名目录、组内新建、设置滚动/提示、会话和输入等六项通过（`.local/workspace-picker/interactions.log`）。修复后仅重跑受影响的添加流程，通过取消、无效路径且不登记、字段内错误/清除、中文和空格目录的名称与实际 cwd、重复路径/尾部斜杠去重、组内新建以及原会话草稿恢复（`workspace-final.log`）。

保留预览的只读检查通过 1440/1024/768/390/375px 下的添加弹窗和取消；会话 ID、文件、cwd、消息、草稿、工作区列表、全局/项目设置均保持一致，无 pageerror。证据为 `.local/workspace-picker/before/`、`after/report.json` 和 `preview-final.log`；集中验收截图在 `.local/workspace-polish-evidence/add-workspace-*.png` 与 `sidebar-projects.png`。

最终 Windows release 构建通过，包括 TypeScript、前端/后端及 Rust 编译（`release-build-final.log`）；产物为 `src-tauri/target/release/pi-agent-desktop.exe`，未构建安装包。原生 WebView2 验收使用真实系统目录选择器，确认新标题和取消不登记/不切换；原工作区、文件、上下文、固定、设置保存和终端布局检查也通过（`native-workspace.log`）。没有替换 Tauri invoke。临时 1540/4331/9225 已关闭，原预览 1451 和后端 4351 保留。应用设计合同验证通过，零 warning。
