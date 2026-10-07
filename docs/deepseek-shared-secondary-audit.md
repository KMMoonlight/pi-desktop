# DeepSeek Harness 共有功能细节核对：设置、连接、扩展、文件与终端

> 本文件保留历史证据；单层文件导航和仅原始 JSON 配置端点的结论已修订。
> 当前实现与验收见 [全应用交互复核](ui-interaction-omissions.md)。

核对日期：2026-10-07。官方来源为 `deepseek-ai/deepseek-harness` 的当前 master，固定 commit `5badb15009ae1756c3afe0ae0cef1faafc290ccc`。本记录核对真实产品源码，补齐此前官网示意没有展示的设置和面板细节。官方源码副本在 `.local/harness-source/deepseek-harness-5badb15009ae1756c3afe0ae0cef1faafc290ccc`。此研究未修改应用代码、用户会话、草稿或设置。

本文件负责设置、模型与账号、MCP、扩展包、文件、更改、终端。基础 token、导航侧栏、会话正文、输入框和工具过程由主审计覆盖，最终完整清单应合并两份证据。下列“官方”是源码可直接证实的结构和 CSS 数值；未在本记录中运行 Harness 安装版，所以不把它们描述为真实认证、安装或文件写入流程的实测结果。

## 对应功能与语义边界

| 共有领域 | Harness 的实现 | Pi Desktop 对应能力 | 对齐决策 |
| --- | --- | --- | --- |
| 设置入口与分类 | 底部 launcher 打开设置 modal；section 由插件注册。[H1][H2] | `App.tsx` 切换 `view="settings"`，`Settings.tsx` 七种分类。 | 采用官方 modal 与导航尺寸，保留 Pi 分类和持久化语义。 |
| 外观、会话显示偏好 | 通用设置中 feature-owned preference rows，右侧 selector。[H3] | 外观与显示页，主题和思考开关；会话菜单 transcript preset。 | 对齐设置行和选择器材料，不将思考显示与模型推理等级合并。 |
| 模型连接与账号 | Models provider cards；DeepSeek Account 另有账号 section。[H4][H5][H6] | SDK 多 provider、OAuth/API Key、默认模型、轮换范围。 | 采用 provider card、添加区、状态层级；不新增仅 Harness 支持的充值、余额、官方账号平台。 |
| 插件/包管理 | 独立插件管理页面，Official / Installed 分组；设置内另有插件配置与运行 inventory。[H7][H8] | 包的安装/更新/移除在设置；资源页管理 SDK 扩展、技能、提示词、主题及扩展命令。 | 将现有 Pi 包管理按官方卡片语言整理；不虚构 Official 市场、Harness profile、插件 preset 或 Cordis inventory。 |
| MCP | 官方是每台服务器一个插件配置 entry，无默认服务器；没有发现独立 MCP 设置界面。[H9] | Pi MCP extension 的 `mcp.json`、启用/移除/重连/登录/退出和状态。 | 保留独立 MCP 页，使用官方通用表单/卡片语言。没有“照搬官方 MCP 页”的证据。 |
| 文件浏览与预览 | 右侧 files tree；点击文件通过公共 resource opener 打开独立 preview tab。[H10][H11] | 同一证据面板内的目录列表与预览，路径/行链接、图片、复制、添加到消息。 | 对齐右侧面板、路径 header、行密度、预览文字层级；保留当前导航和添加到消息能力。 |
| 更改审查 | 每轮有 durable seq 的 ChangedFiles 摘要，右侧 Review 显示该轮开始/结束对比。[H12][H13] | `git.changes` 展示工作区未提交改动，多个文件折叠 diff。 | 对齐列表摘要、统计色、diff chrome；明确标为工作区更改，不冒充逐轮快照。 |
| 交互终端 | xterm，主题跟随 app；保留于每会话的右侧 dock/floating tab 系统。[H14][H15] | xterm 在底部 dock，保留 shell、中文输入、剪贴板、扩展弹窗 terminal dock 与 ANSI fallback。 | 对齐 xterm 材料和标题栏控件；保留已确认的底部摆放及扩展 fallback，不扩展多终端/浮动布局业务。 |

## 修改清单

下表保留实施前的差异和决策依据。实际实现、保留边界及验收结果统一见 [主清单的最终实施状态](deepseek-shared-ui-audit.md#最终实施状态)，已逐组覆盖本文件全部 43 项。`直接对齐`表示现有共有功能的布局或样式调整；`保留`表示明确合理差异；`可借鉴`表示没有官方同业务页面，只应用已有共有组件语言。

### 设置壳与普通表单

| ID | Harness 细节与源码证据 | 当前 Pi 差异 | 具体调整与边界 |
| --- | --- | --- | --- |
| S01 | 设置是 portal 到 body 的居中 `role=dialog`，mask click、Escape、关闭按钮都关闭；modal layer 管焦点。[H1] | [Settings.tsx](/C:/Code/pi-agnet-desktop/src/Settings.tsx:175) / [structure.css](/C:/Code/pi-agnet-desktop/src/structure.css:136)：设置替换主工作区，返回按钮承担退出。 | **直接对齐**：在会话之上打开设置 modal，保持主会话可见，关闭回到原焦点。内部草稿生命周期不能因 modal 而丢失。 |
| S02 | panel width 800px；height=min(800px, viewport−2×max(24px, frame inset))；max-width=viewport−48px；整体圆角和 prominent shadow。[H2]（L85） | [Settings.tsx](/C:/Code/pi-agnet-desktop/src/Settings.tsx:175) / [structure.css](/C:/Code/pi-agnet-desktop/src/structure.css:136)：`.settings-view` max1120px；铺满主区，导航 border 可见。 | **直接对齐**：800px 宽、受 viewport 约束的固定高度 modal；不同分类不随内容改变外壳高度。窄窗口应适配，不能强制 188px rail 把内容挤为几十像素。 |
| S03 | nav width188px，padding22px 12px 0，gap18；标题16/500/24，nav cell40px、图标16px、label14/400/22、gap8，active/hover 填充，无 nav 分隔线。[H2]（L111） | [Settings.tsx](/C:/Code/pi-agnet-desktop/src/Settings.tsx:175) / [structure.css](/C:/Code/pi-agnet-desktop/src/structure.css:136)：170px文字导航；36px行；右侧border；缺分类glyph。 | **直接对齐**：增加语义图标，40px导航行、188px rail、低对比 active fill。保留 Pi 常规/外观/模型/项目/MCP/扩展/高级分类，不复制 Harness 账号/预设业务。 |
| S04 | 内容由54px空 chrome header（28px close）和 options padding 0 24px 24px组成；分类自己的标题位于 options 内。[H2]（L180） | [Settings.tsx](/C:/Code/pi-agnet-desktop/src/Settings.tsx:175) / [structure.css](/C:/Code/pi-agnet-desktop/src/structure.css:136)：上方大标题、说明、scope独立border header；content 28px inset。 | **直接对齐**：减少标题区重复、将内容标题和说明收进内容列；关闭按钮单独保留，不与首个表单挤在同一行。scope作为对应类别工具。 |
| S05 | options 与 navList 各自滚动，panel overflow hidden；surface统一，滚动 thumb随surface级别变化。[H2]（L85）[H2]（L131）[H2]（L228） | [Settings.tsx](/C:/Code/pi-agnet-desktop/src/Settings.tsx:175) / [structure.css](/C:/Code/pi-agnet-desktop/src/structure.css:136)：已有content独立滚动，但nav高度/窄屏横向tabs另定义。 | **直接对齐**：内容滚动保留，外壳不滚动；滚动条使用同主题中性颜色，不依赖 OS 原生对比。 |
| S06 | 普通偏好行：padding16px 0，0.5px divider，label14/22，desc12/18，两者gap4；末尾不画divider。[H3][H16] | [Settings.tsx](/C:/Code/pi-agnet-desktop/src/Settings.tsx:211) / [structure.css](/C:/Code/pi-agnet-desktop/src/structure.css:158)：label13；说明常作为表单后的孤立p；普通row固定55px。 | **直接对齐**：label与说明组成左侧文本组，控件右侧对齐；允许说明两行撑高，而不是固定成狭小高度。最后一项去分割线。 |
| S07 | preference selector36px高、padding0 14px、无border、module fill；hover interactive fill，label14px与12px chevron。[H3]（L34） | [Settings.tsx](/C:/Code/pi-agnet-desktop/src/Settings.tsx:211) / [structure.css](/C:/Code/pi-agnet-desktop/src/structure.css:158)：`.settings-view .select-trigger`一律transparent，只有hover背景；看起来像纯文字。 | **直接对齐**：常规/外观enum使用填充型selector；scope/menu工具保持embedded。不能把所有设置select全局变成透明或outlined。 |
| S08 | 插件设置结构化字段 label13/500，垂直gap6/padding12；text/secret输入34px、0.5px border-l4、module/layer背景；invalid自有error border。[H17] | [Settings.tsx](/C:/Code/pi-agnet-desktop/src/Settings.tsx:211) / [structure.css](/C:/Code/pi-agnet-desktop/src/structure.css:158)：Pi参数、数字、JSON编辑器混用统一field；数值与文本缺语义材料差别。 | **直接对齐**：可编辑text/number/path/secret保留细outline；enum pill去outline；JSON/code保留清晰editor surface；focus ring不等同默认outline。 |
| S09 | 默认按钮36px/14px；紧凑row按钮28px/12px；icon28px/15px；disabled降低opacity到0.4；focus ring可见。[H4]（L126）[H4]（L191） | [Settings.tsx](/C:/Code/pi-agnet-desktop/src/Settings.tsx:211) / [structure.css](/C:/Code/pi-agnet-desktop/src/structure.css:158)：Reshaped variants尺寸与自定义按钮混合。 | **直接对齐**：统一管理页compact操作尺寸、box-sizing与focus ring，危险操作保持明确错误色；不要把所有次要操作变为primary。 |
| S10 | schema字段可见override badge与reset to inheritance，草稿stage clear。[H17][H18]（L49） | [Settings.tsx](/C:/Code/pi-agnet-desktop/src/Settings.tsx:211) / [structure.css](/C:/Code/pi-agnet-desktop/src/structure.css:158)：Pi全局/项目scope选择，说明继承，真实配置覆盖存储；无逐字段reset。 | **保留/可借鉴**：保留真实scope入口与继承说明；可整理scope为小工具，不为视觉对齐假造SDK不支持的层级/覆盖指标。 |
| S11 | 结构化设置form有自己的save footer；provider编辑有取消与apply；普通偏好拥有各自更新行为。[H19][H20] | [Settings.tsx](/C:/Code/pi-agnet-desktop/src/Settings.tsx:211) / [structure.css](/C:/Code/pi-agnet-desktop/src/structure.css:158)：general/models/advanced共享sticky save，MCP/包/信任/外观即时生效。 | **保留**：先保持已有持久化语义，明确“保存修改”与“立即生效”。只对footer尺寸和状态色对齐，不将草稿保存改成每按键写配置。 |

### 模型、账号、MCP与扩展包

| ID | Harness 细节与源码证据 | 当前 Pi 差异 | 具体调整与边界 |
| --- | --- | --- | --- |
| M01 | Models section gap12，title16/500/24，intro14/22 tertiary；已配置provider rows额外12px上间距、8px卡片gap。[H4]（L7） | [Settings.tsx](/C:/Code/pi-agnet-desktop/src/Settings.tsx:433)：page heading19/600；provider段落同settings list row。 | **直接对齐**：连接段标题与卡片gap改为official层级，默认模型与轮换范围作为Pi次级group。 |
| M02 | provider card padding12px 14px、0.5px stroke、settings fill、xl radius；rowHead gap10，名称14/500/22，状态dot8px在名称旁。[H4]（L54） | [Settings.tsx](/C:/Code/pi-agnet-desktop/src/Settings.tsx:433)：dot放列表首栏，行底border；状态是第二行文字。 | **直接对齐**：provider card名称旁小dot，次级连接来源/状态保留；只显示真实SDK configured状态，不用绿色宣称实时联通。 |
| M03 | 只展开一个provider editor；打开添加卡收起编辑，已配置/缺credential提示有明确来源。[H5]（L429） | [Settings.tsx](/C:/Code/pi-agnet-desktop/src/Settings.tsx:433)：Pi所有provider方法按钮常驻；addProvider切换显示所有未配置provider。 | **直接对齐**：卡片首层显示已有提供商和紧凑“连接/管理”，展开后显示该provider SDK已有OAuth/API Key方法；未连接provider通过明确添加区选择。仍用原 `auth.login` 回调。 |
| M04 | 添加provider的collapsed入口是全宽44px虚线框，与provider卡同corner，addCard是inset module fill。[H4]（L313）[H5]（L521） | [Settings.tsx](/C:/Code/pi-agnet-desktop/src/Settings.tsx:433)：添加提供商按钮在section heading右边，仅切换列表。 | **直接对齐**：列表末尾添加位，展开catalog/可连接provider，取消明确；不实现Harness协议适配器、LLM config schema或新认证服务。 |
| M05 | editor填充module、不再内套border；padding14px 16px，label12px、text input32px；enum select max-width240px；footer右对齐cancel/apply。[H4]（L224）[H4]（L575）[H20] | [Settings.tsx](/C:/Code/pi-agnet-desktop/src/Settings.tsx:433)：OAuth/API Key现走SDK host request，advanced模型JSON独立。 | **可借鉴**：保持SDK请求弹窗流程，使用相同材料；若只重排现有操作，不需要为对齐另造credentials store。 |
| M06 | Account是DeepSeek专属section，有32px头像、身份卡、余额/赠额、Usage/Top up平台link。[H6]（L155） | [Settings.tsx](/C:/Code/pi-agnet-desktop/src/Settings.tsx:433)：Pi多个SDK账号，不存在一个产品主账号。 | **保留**：账号与模型仍放同页，provider卡体现连接；不复制余额、头像、充值、官方平台overlay。 |
| M07 | Harness按adapter已有models提供输入/容量/高级字段，模型selector是另一composer业务。[H21] | [Settings.tsx](/C:/Code/pi-agnet-desktop/src/Settings.tsx:433)：Pi默认model selector、默认thinking、轮换checklist均实际SDK能力。 | **保留/对齐**：保留默认model和thinking、模型轮换，降低它们视觉优先级并解释轮换；别把轮换checkbox误绘成“启用提供商模型”。 |
| C01 | 官方MCP无独立client page；通过plugin config entry配置 transport/serverName/command/url。[H9] | [Settings.tsx](/C:/Code/pi-agnet-desktop/src/Settings.tsx:571)：Pi `mcp.json`独立MCP页，有enable/reconnect/login/logout/remove。 | **可借鉴**：MCP页按已配置列表→添加→高级组织，用官方card和form chrome；所有Pi现有操作保留。无需新增官方server discovery或更换配置格式。 |
| C02 | 可编辑集成配置用settings form labels/hints/errors；控件使用清晰input outline。[H17][H19] | [Settings.tsx](/C:/Code/pi-agnet-desktop/src/Settings.tsx:571)：添加MCP inline inset；JSON args现直接技术label，错误在整页顶部。 | **可借鉴**：添加表单采用14/16px inset，字段label12/13px；帮助紧贴field，新增错误紧贴表单，取消恢复触发按钮焦点。保留JSON args格式与验证。 |
| C03 | 官方plugin管理的卡片head14px gap，图标48px、名称14/500/20、描述13/18；secondary metadata不竞争主名称。[H7]（L225） | [Settings.tsx](/C:/Code/pi-agnet-desktop/src/Settings.tsx:571)：Pi MCP/server和package图标18px、technical source占strong主标题。 | **可借鉴**：服务器名称仍是主标题，类型/地址次级；扩展包显示简短包名作标题、完整source作次级可复制路径，不编造package metadata。 |
| P01 | Plugins manager居中列max960，page head28px top、title20/500/28、intro13/20；toolbar icon28、Add32/13。[H7]（L3）[H7]（L33）[H7]（L382） | [Settings.tsx](/C:/Code/pi-agnet-desktop/src/Settings.tsx:759)：Pi包管理在settings列，toolbar全部outline文本按钮。 | **直接对齐材料**：settings列保持800modal尺寸，包管理内部header简洁；Add作为主要动作，update-all为轻量次要动作。独立插件manager业务不是本轮必加导航。 |
| P02 | package rows gap2；hover surface左右−8px伸出，head padding8；不加每行常驻粗border。[H7]（L206） | [Settings.tsx](/C:/Code/pi-agnet-desktop/src/Settings.tsx:759)：Pi package是通用server/provider border-bottom行。 | **直接对齐**：包row以柔和hover surface区分；短名称/全局或项目scope次级；update/remove icon紧凑、danger状态明确。 |
| P03 | 官方区分Official bundles与Installed；group title14/500/22、countcaption，空group不占位置。[H7]（L150）[H8]（L1396） | [Settings.tsx](/C:/Code/pi-agnet-desktop/src/Settings.tsx:759)：Pi没有官方market，仅installed SDK包与资源。 | **保留**：只展示真实安装包，scope可分组；不要加空Official标签，不把Pi自带工具伪装成可卸载包。 |
| P04 | install独立modal，检查/安装/结果逐阶段；错误和失败包保留实际主体，不用成功假metadata。[H8]（L845） | [Settings.tsx](/C:/Code/pi-agnet-desktop/src/Settings.tsx:759)：Pi输入包source inline，pending/install关闭由后端结果决定。 | **直接对齐已有状态**：添加表单独立视觉区，空值禁用、pending清楚、失败不清空draft、成功收起；不用新增pnpm registry/build approval业务。 |
| P05 | Settings Plugins还有configurable/inventory tabs，访问过的panel保持mounted hidden，保留草稿和search。[H22]（L58） | [Settings.tsx](/C:/Code/pi-agnet-desktop/src/Settings.tsx:759)：Pi settings tab切换仍同一个component state；资源页扩展命令/原扩展renderers独立。 | **保留**：resources/tree/SDK扩展交互保留在会话工作区。设置分类不强制复制Harness两个tab，不丢既有表单draft。 |

### 文件、更改、预览与终端

| ID | Harness 细节与源码证据 | 当前 Pi 差异 | 具体调整与边界 |
| --- | --- | --- | --- |
| F01 | 右侧page column使用conversation ground，pane tab strip38px，provider path header38px；隐藏右栏不保留rail宽度。[H10][H11][H23]（L50） | [Workspace.tsx](/C:/Code/pi-agnet-desktop/src/Workspace.tsx:86) / [workspace-layout.css](/C:/Code/pi-agnet-desktop/src/workspace-layout.css:21)：evidence pane header46px + files toolbar + preview header，可能出现三个标题层。 | **直接对齐**：一个pane标题层/切换层；路径工具row38px；去掉重复“文件与更改”标题所占空间；唯一会话文件入口保留。 |
| F02 | files是tree，folder展开保留父目录，nested indent18px；glyph16，foldertertiary，filetypeicon独立色；row padding5px10、gap6、radius-md。[H10]（L70）[H11]（L68） | [Workspace.tsx](/C:/Code/pi-agnet-desktop/src/Workspace.tsx:86) / [workspace-layout.css](/C:/Code/pi-agnet-desktop/src/workspace-layout.css:21)：Pi目录点击替换当前level，up一级按钮；统一File图标，row8px/12px。 | **直接对齐样式**：row密度13px、5px10、16px图标、ellipsis与hover；**保留**当前level navigation，若改tree须明确为功能组织调整，不可删up/路径和file-link跳转。 |
| F03 | root path始终可见，reload28px icon，path右margin12；只tree body滚动，scrollbar稳定gutter距边2px。[H10]（L19）[H10]（L35）[H10]（L143） | [Workspace.tsx](/C:/Code/pi-agnet-desktop/src/Workspace.tsx:86) / [workspace-layout.css](/C:/Code/pi-agnet-desktop/src/workspace-layout.css:21)：文件列表和preview各滚动；root有back与path；toolbar另有refresh。 | **直接对齐**：path/reload压成38pxrow，保留back适配Pi目录导航；不重复refresh，不把预览scroll与目录scroll合并。 |
| F04 | 文件预览header38px/padding16start/6end，path+紧凑controls；body13pxmono/line-height1.6/8pxdocument inset。[H24]（L20）[H24]（L47） | [Workspace.tsx](/C:/Code/pi-agnet-desktop/src/Workspace.tsx:86) / [workspace-layout.css](/C:/Code/pi-agnet-desktop/src/workspace-layout.css:21)：Pi preview仅basename、font12、代码有line numbers。 | **直接对齐**：展示短路径/hover全路径，38pxheader与13pxmono；保留Pi行号、复制、attach/image/truncation。 |
| F05 | lineTarget是hover-tonebackground；plain source不中途重新渲染全界面。[H24]（L115）[H25]（L11） | [Workspace.tsx](/C:/Code/pi-agnet-desktop/src/Workspace.tsx:86) / [workspace-layout.css](/C:/Code/pi-agnet-desktop/src/workspace-layout.css:21)：Pi selected file line已background与outline。 | **直接对齐**：行目标改低对比fill，不让outline挤字；保留data-file-line和滚到指定行。 |
| F06 | official空态13pxsecondary，icon低饱和、文本居中略上抬、retry32px；errors有具体缺文件/非目录/边界分类。[H24]（L124）[H11]（L47） | [Workspace.tsx](/C:/Code/pi-agnet-desktop/src/Workspace.tsx:86) / [workspace-layout.css](/C:/Code/pi-agnet-desktop/src/workspace-layout.css:21)：Pi统一Empty，文件空目录文字；run整体toast。 | **直接对齐已有状态**：没有文件/选文件/读取失败区分；不能将真实失败当空目录；不新增不相关preview格式。 |
| D01 | ChangedFiles 60pxfilledheader，40pxtile，title13/500/20，stats10/16，file row12pxtext/11pxcodecounts；只4行collapsed。[H12]（L2）[H26]（L19） | [Workspace.tsx](/C:/Code/pi-agnet-desktop/src/Workspace.tsx:230)：Pi工作区diff全部文件默认open，没有轻量摘要。 | **直接对齐已有Git数据**：先显示工作区更改files/countsummary，然后逐filedetails；统计仅来自当前git.diff；不要带“turn N”或声称是历史结果。 |
| D02 | 增删数分别success/error，间隔6；路径ellipsis，counts不收缩；binary/oversized用明确文字。[H12]（L21）[H13]（L9） | [Workspace.tsx](/C:/Code/pi-agnet-desktop/src/Workspace.tsx:230)：Pi已增删色，但path和统计可能争宽，未明确binary。 | **直接对齐**：路径flex min-width0、countsflex-none、6pxgap；binary从现有diff metadata判断，不用文本行统计当二进制改动数。 |
| D03 | Review topheader38px；file selector28px，与counts/compare/wrap/open-file controls同行，icons28/15。[H13][H27]（L113） | [Workspace.tsx](/C:/Code/pi-agnet-desktop/src/Workspace.tsx:230)：Pi每file summary外加copy行，浪费纵向。 | **直接对齐**：copy并入file summary旁独立按钮，不嵌套interactive；路径与+/-跟summary同row。比对/换行是可借鉴操作，不是已有共有业务必须扩张。 |
| D04 | unified diff grid3.5em old +3.5em new +1.2em sign；22pxrow，gutter不选择，contextsecondary，新增/删除的gutter和body不同fill。[H28]（L10） | [Workspace.tsx](/C:/Code/pi-agnet-desktop/src/Workspace.tsx:230)：Pi有旧/新行号，code字符串还带+/−；lineheight继承，颜色较粗。 | **直接对齐**：22pxline、右对齐mutedline numbers、只正文可选、sign独立对齐、细浅色fill。保持现有hunk和复制整段原diff。 |
| D05 | code宽内容由内部scroll承载，background至少覆盖scrollablewidth；wrap时pre-wrap anywhere。[H28]（L7） | [Workspace.tsx](/C:/Code/pi-agnet-desktop/src/Workspace.tsx:230)：Pi.diff-code若长行可能fill截止可视width。 | **直接对齐**：每行paint覆盖内容宽度，横向滚动在codebody，不让整个application溢出；保留较长source/diff。 |
| D06 | PresentedFileCard是显式presented元数据，60pxfilecards、40pxtile，2列>620、否则1列，独立previewbutton不嵌套actionbutton。[H29][H30] | [Workspace.tsx](/C:/Code/pi-agnet-desktop/src/Workspace.tsx:230)：Pi只有真实file links与attachment，SDK输出未提供同等presentedfilelist。 | **保留**：不能解析任意字符自动猜“成果卡”；可对已有真实attachments/filetargets按此材料绘制，原SDK正文和链接行为保留。 |
| T01 | interactive terminalcolors跟随application/systemtheme，theme更新保持shell/output/OSC overrides；xterm defaultfont13/mono、minimumContrast4.5。[H14]（L38）[H15]（L90） | [TerminalPanel.tsx](/C:/Code/pi-agnet-desktop/src/TerminalPanel.tsx:64) / [terminal.css](/C:/Code/pi-agnet-desktop/src/terminal.css:1)：PiTerminalPanel theme硬编码深色#13161c/#e4e7ed，light mode仍黑块。 | **直接对齐**：hostshellterminal外壳/header和xterm默认theme跟app，监听theme但不重建instance；保留ANSI/OSC已有语义。ComponentTerminal是原扩展ANSIfallback，不应任意改原renderer palette。 |
| T02 | screen padding8，root13px，status/error是应用layer fill，状态role=status；异常状态出现才展示。[H31][H15]（L47） | [TerminalPanel.tsx](/C:/Code/pi-agnet-desktop/src/TerminalPanel.tsx:64) / [terminal.css](/C:/Code/pi-agnet-desktop/src/terminal.css:1)：Pi终端status在header，error红p，外壳深色border。 | **直接对齐**：紧凑38pxheader、28pxiconbuttons、中性色line，退出/异常保持可见；idle不显示无意义“就绪”。 |
| T03 | TerminalTitle最小宽0/ellipsis，doubleclick可rename，输入120px/0.5pxoutline。[H32] | [TerminalPanel.tsx](/C:/Code/pi-agnet-desktop/src/TerminalPanel.tsx:64) / [terminal.css](/C:/Code/pi-agnet-desktop/src/terminal.css:1)：Pi单终端固定label，没有多terminal身份。 | **保留**：单terminal不需要rename；terminal标题ellipsis、icon16与按钮尺寸可对齐。不要为样式复制多terminal管理。 |
| T04 | Harnessterminal在右侧dock/floating系统；Pi明确保持独立desktop和xterm，现底部有高度resize。[H14]（L28）[H23] | [TerminalPanel.tsx](/C:/Code/pi-agnet-desktop/src/TerminalPanel.tsx:64) / [terminal.css](/C:/Code/pi-agnet-desktop/src/terminal.css:1)：Pi底部dock、外部扩展modal重新挂载同xterm容器。 | **保留**：底部位置和resize既有能力；使用官方通用面板材料。不要为“像Harness”破坏扩展modal焦点、shell lifecycle或加入split/floating。 |
| T05 | shell工具输出是TerminalBlock，与interactive terminal不同，22pxline、codeblocksurface、30pxstatusgutter、复制位在首行。[H33] | [TerminalPanel.tsx](/C:/Code/pi-agnet-desktop/src/TerminalPanel.tsx:64) / [terminal.css](/C:/Code/pi-agnet-desktop/src/terminal.css:1)：Pi工具输出来自原SDKrenderer，hostshell命令也是SDK能力。 | **直接对齐外层**：工具details和interactive terminal层级分开；可以整理host shell说明与标题，不能重写第三方renderer字符串和回调。 |

## 实施验收建议

按大类整体检查，符合用户要求：设置/连接/扩展完成后核对一次；文件/更改/终端完成后核对一次；最后与主审计中的会话、导航、输入框整体复核。检查的是上述真实UI变化和现有操作，不启动新认证服务、不新增扩展兼容矩阵。

需要对照真实截图的是：设置弹窗形状与navigation40px、普通selectorfilled材料、providercard状态、MCP/包列表、右侧pane单入口与标题层、长路径/代码diff、light/dark terminal。交互检查应覆盖modalEscape/focus、scope不会误写、已有login回调、包添加取消和失败保留draft、file-link指定行、clipboard/attach、shell在theme切换前后持续。使用同一预览保存用户当前会话与草稿，勿因研究或截图提交消息。

## 官方来源索引

所有链接固定到同一官方commit；`L`标记为源码起点，表中更细的`:Lnn`是同一文件相应行。Pi对应文件为 `src/Settings.tsx`、`src/Workspace.tsx`、`src/TerminalPanel.tsx`、`src/structure.css`、`src/workspace-layout.css`、`src/terminal.css`。

[H1]: https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/client/ui-settings-general/src/client/SettingsRoot.tsx#L52
[H2]: https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/client/ui-settings-general/src/client/SettingsRoot.module.css#L85
[H3]: https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/client/ui-chat/src/client/settings/PreferenceRow.module.css#L3
[H4]: https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/client/ui-settings-models/src/client/ModelsSection.module.css#L7
[H5]: https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/client/ui-settings-models/src/client/ModelsSection.tsx#L386
[H6]: https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/client/ui-settings-account/src/client/AccountSection.tsx#L141
[H7]: https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/client/ui-plugin-manager/src/client/PluginManagerPage.module.css#L3
[H8]: https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/client/ui-plugin-manager/src/client/PluginManagerPage.tsx#L1336
[H9]: https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/mcp/mcp-client/README.md#L12
[H10]: https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/client/ui-sidebar-files/src/client/FilesBody.module.css#L4
[H11]: https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/client/ui-sidebar-files/src/client/FilesBody.tsx#L68
[H12]: https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/client/ui-deliverables/src/client/ChangedFiles.module.css#L2
[H13]: https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/client/ui-deliverables/src/client/ReviewTab.module.css#L2
[H14]: https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/client/ui-sidebar-terminal/README.md#L28
[H15]: https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/client/ui-sidebar-terminal/src/client/terminal.tsx#L20
[H16]: https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/client/ui-settings-general/src/client/GeneralSection.module.css#L9
[H17]: https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/client/ui-primitives/src/settings-form/fields.module.css#L3
[H18]: https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/client/ui-primitives/src/settings-form/fields.tsx#L49
[H19]: https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/client/ui-primitives/src/settings-form/SettingsForm.module.css#L20
[H20]: https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/client/ui-settings-models/src/client/EditorFooter.tsx#L49
[H21]: https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/client/ui-settings-models/src/client/ModelRow.tsx#L45
[H22]: https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/client/ui-settings-plugins/src/client/PluginsSettingsSection.tsx#L58
[H23]: https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/client/ui-sidebar-right/README.md#L39
[H24]: https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/client/ui-sidebar-documentpreview/src/client/TextPreview.module.css#L20
[H25]: https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/client/ui-sidebar-documentpreview/src/client/text/TextBody.tsx#L11
[H26]: https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/client/ui-deliverables/src/client/ChangedFiles.tsx#L19
[H27]: https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/client/ui-deliverables/src/client/ReviewTab.tsx#L113
[H28]: https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/client/ui-deliverables/src/client/FileDiff.module.css#L2
[H29]: https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/client/ui-deliverables/src/client/Deliverables.module.css#L2
[H30]: https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/client/ui-deliverables/src/client/PresentedFileCard.tsx#L31
[H31]: https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/client/ui-sidebar-terminal/src/client/terminal.module.css#L1
[H32]: https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/client/ui-sidebar-terminal/src/client/TerminalTitle.tsx#L19
[H33]: https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/client/ui-primitives/src/TerminalBlock.module.css#L1

