# 安安素材管理器 — 产品与验收

## 0.3.10 独立副本、分类选择器与 AN 入库设置（2026-11-09）

- 「复制并加入素材库」必须二次确认；取消不修改索引、管理路径、预览或磁盘，也不打开资源管理器。
- 确认后只新增一个库内 FLA／音频管理文件及独立素材记录，自动显示并选中新卡片，不需要手动导入；名称中文递增，不覆盖任何现有文件。不先向外部原文件夹复制后再次导入。
- 副本继承全部分类归属、素材类型、标签和预览设置，收藏／点赞清空；预览缓存独立。新旧素材可分别编辑、更新预览、分类和移除；即使初始内容相同，重开和撤销也不得合并。数据或索引写入失败清理此次新文件，保留原素材。
- 普通导入仍默认内容去重。显式独立副本以独立身份或已登记路径识别；未知外部文件不得随机附着到某个副本。普通打开、分类、编辑和粘贴不额外创建工作副本。
- 主程序全部五处 select（导入分类、预览分辨率、上级分类、素材类型、详情移动分类）统一暗色／暖色主题。三处分类菜单支持分类名及父级路径搜索、层级提示、键盘选择和无结果状态；分辨率、素材类型使用按原顺序展示的紧凑菜单。禁用状态和值与底层 select 同步，沿用类型兼容校验；关闭弹层或切换操作后释放事件与界面，不增加空闲轮询。
- AN「加入素材库」的保存前主题确认可选普通／特效、兼容分类、默认／256／512／1024／2048（2K）预览，以及已有同名图复用；分类和分辨率两处均采用紫色主题菜单，分类继续支持搜索。点击「保存并加入」才保存当前文档并提交选项；取消、Esc、取消原生另存为和确认期间切文档均不保存错误文档或提交入库。
- 选项由接收器和核心再次校验；无效类型、分辨率、分类或跨类型目标必须给出中文失败。已登记文档原位更新，不创建额外 FLA。选择分类保留已有其他归属；不指定分类保留原归属，未携带选项时沿用旧默认行为。
- 窄浮窗尝试临时展开入库设置并在结束后恢复；原生停靠面板不能展开时沿用旧原生确认及默认入库方式，不声称原生确认拥有新设置。可提示用户改用浮窗或管理器导入。
- 主程序和随附 AN 插件均为 0.3.10。需要在软件内安装／更新插件并重新打开 AN 面板；不得自动保存、关闭或重启 AN。测试、签名与交付证据以 PROJECT_STATE.md 的本版记录为准；新版实际宿主流程需独立验收，不继承历史版本的通过状态。
- 以下历史规则与本节冲突时以本节为准；授权条款本轮不变。

2026-10-13，Windows 本地单用户应用。用户授权规划、实现、本地测试及打包。实际宿主为 Animate 2023 23.0.0.407 / CEP 11.5.3；清单同时支持 2024，后者待实测。

2026-10-15：用户明确授权完成修复后自动提交、推送并发布新版到现有 GitHub 仓库 `anyv-DH/anshelf`，随后更新桌面快捷方式。素材库和备份不进入公开仓库。

## 0.3.9 分类可靠性、紧凑面板与软件内更新

- 多分类仅共享一条素材和一份管理文件。旧撤销记录只恢复用户元数据，不回退已保存内容的哈希、路径和预览；移除、重导入再撤销时合并重复记录及分类，不产生两个可争用同一文件的 ID。
- Windows 路径分隔符、大小写或 8.3 别名不同但指向同一物理 FLA 时，只规范路径记录，不重命名、不删除。缺失路径的恢复只查当前素材自己的目录，候选有不同内容时要求人工确认，不覆盖文件或创建 FLA 副本。
- 真实分类中的默认移除只取消当前分类树（包含子分类）的归属，保留其他分类与素材；无其他归属则归入未分类。独立「从素材库移除」取消全库记录，确认清楚说明范围；两个操作均可撤销。复制、移除、删除分类使用主题确认，取消不修改文件或索引。
- AN 面板默认 48×88、最低 40×80，两图标上下排列。加入素材库使用主题确认，窄浮窗临时放大后恢复，不能放大的停靠栏回退原生确认。确认绑定 Document.id，切换文档不能误保存；未命名文件沿用原生保存窗。
- 在更新窗口和连接窗口提供软件随附签名插件的一键安装／更新，显示随附与已安装版本。安装校验、暂存与回退沿用既有插件安装契约；完成提示关闭再打开面板，必要时保存后重启 AN。不得自动保存、关闭或重启 AN。
- 启动仅检查版本，不自动下载。用户主动下载时，按安装版／免安装版选择官方附件，显示进度，核对大小和 SHA256；再次主动启动更新才退出当前管理器。安装版进入向导，免安装版运行 `%APPDATA%\AnShelfUpdates` 内新版，不覆盖旧入口；提供定位已下载文件。素材库身份仍为 `%APPDATA%\AnShelf`，退出取消未完成下载。
- 新版完整 AN 宿主流程、任务栏切换与 Animate 2024 需独立实测，不以浏览器／VM 自动测试代替。

## Core requirements

以下保留各版本的既有需求；与 0.3.10 增量冲突的复制、分类选择、AN 入库设置，以及前述面板布局、移除范围和更新方式，以最新规则为准。

- 0.3.7：点击「用 AN 打开」直接打开素材库内该素材唯一的受管理 FLA，不创建逐次工作副本。首次打开将现有文件原位改名为安全、可读的素材名；保存后在下次打开或发送到舞台时重算哈希、更新素材记录并重生成预览。舞台粘贴也直接校验并打开这份唯一文件，不整体读入内存或写入临时 FLA；若该文件已在 AN 打开则提示先关闭，避免改动正在编辑的素材。外部最初导入文件保持不变。CEP 请求升级至版本 2，旧面板必须更新后才能粘贴。
- 0.3.6：重复启动便携版只唤起已有窗口，不得破坏正在运行的程序文件；随后导入或重试 FLA 仍能生成并显示预览。每次启动使用独立解压目录，素材库继续使用原位置。
- 0.3.4（由 0.3.7 替代）：“用 AN 打开”曾创建独立工作目录；不再适用于当前行为。
- 0.3.4：选中素材后，“选择分类”替换原分类；“加入其他分类”保留已有分类，把同一素材加入其他兼容文件夹。多个分类共享一个素材和预览，计数/搜索/收藏/子文件夹过滤识别全部归属；详情中点击分类 × 只取消该分类，支持撤销和重开。
- 0.3.5：导入、生成/重试预览均完全离线，不检查、不启动 Animate，避免小文件导入完成后又弹出 AN。只有用户明确「用 AN 打开」才启动 Animate；舞台粘贴继续由已打开的 AN 接收面板处理。预览排队后导入立即返回，失败不阻断其他素材。
- 0.3.5：经典旋转补间按元件变换中心插值位置，修复偏离注册原点的原地旋转变成绕圈漂移；保留素材原本的位移、缩放和旋转，不逐帧强制居中。
- Import .fla files and folders, preserve originals, deduplicate identical bytes, and retain source paths.
- Import dialog has “优先使用同名预览图” enabled by default. Matching same-stem PNG/JPG/JPEG/WebP is reused; otherwise previews are automatically generated and cached. Disable to force regeneration. Failed previews can retry.
- Categories, favorites, tags, search, multi-select, instant category assignment and undo. Categories are metadata; originals are never moved.
- Each FLA is one material unit. Insert the complete source scenes/timelines into the current AN document, preserving editable objects where native Animate supports them. Duplicate library symbols are folded into one hash-namespaced group; same name with different content remains separate.
- “发送到 AN” queues the current managed FLA; AN CEP panel confirms and “粘贴到舞台” inserts it into the current target. No external source overwrite or target auto-save.
- 插入舞台中央、目标当前图层、播放头准确所在帧。延续帧转普通关键帧，继承原内容后追加；已有关键帧直接追加。不新增目标层，不打空白关键帧，不自动保存目标。素材库源文档不保存并关闭，目标保持打开。
- 0.2：暗色/暖色主题保存本机偏好；自定义标题栏与主题一致，排序采用主题菜单。常规与 930×700 置顶小窗均可使用。
- 详情默认隐藏，按需打开/关闭。点击预览图放大查看；每卡片有“用 AN 打开”（素材库唯一管理文件）和“粘贴到舞台”（排队到 AN 面板确认）。
- 层级分类，例如人物→男、女；父类视图包含后代。拒绝不存在父级、循环和同父级重名。删除保留素材，直接素材未分类，子类提升到原父级（重名加序号），可撤销。
- 收藏永久保留；收藏视图按素材已有的原分类路径自动提供筛选按钮，不另建收藏分类；没有原分类的素材进入“未分类”。点赞从点击起保留 24 小时，到期退出点赞视图，保留素材，且不显示收藏分类栏。分类操作随选中/操作状态出现，不常驻宽操作区。
- 重命名继续沿用 AppData/AnShelf 和 appId，兼容既有素材库。AN 编辑只改素材库受管理文件；sourcePaths 中记录的外部原始文件不修改。
- 左上角“安安”采用为本项目原创绘制的矢量字标，不嵌入第三方字体；暗色与暖色主题分别提供协调的双色渐变，保持产品名称可读与导航可用。
- AN 内的 CEP 面板也命名为“安安素材管理器”，默认约 48×48、最低 40×40 内容区，仅保留一个粘贴按钮。窄面板显示图标，放大后显示状态文字；素材名称和错误详情由悬停提示提供，不常驻标志、路径或说明区。
- 素材页顶部标题、导入、搜索与排序压紧上移，提高首屏素材数量。提供自动 / 每行 4、5、6 个的显示选择并保存本机偏好；正常主窗实际按所选列数展示，小窗或详情展开空间不足时减少列数，保证按钮可用且不横向滚动。
- 素材卡片提供“打开文件所在位置”，在资源管理器选中仍存在的原始 FLA；多个原始来源时选择可用者，原位置不可用则定位素材库文件并说明。桌面端只接收已知素材 ID，不接收任意路径，外部原件不修改。
- All processing local; no accounts, cloud, telemetry or semantic AI search.

### Import destinations and child-folder filtering

- The import dialog may select an existing compatible category, create a new top-level folder, or create a child folder under the category currently selected in the dialog. Creation is metadata-only and does not move or rewrite the original file. A selected destination is validated for existence and media scope in the core before the batch mutates; omitted destinations leave new assets unclassified and preserve the existing category of duplicate assets.
- The top filter menu includes “隐藏已归入子文件夹”. In a normal category view it hides assets assigned to descendants and keeps assets assigned directly to the current category. In an ordinary/effect/audio virtual root it keeps only unclassified assets. All assets, favorites, and daily likes deliberately ignore this view-only filter.

## 0.3.2 compact panel, scoped categories and preview controls

- The CEP receiver remains a single-action panel named “安安素材管理器”. Its content area is compact by default (about 48×48 CSS pixels, minimum 40×40); the one button uses an icon at narrow widths and may show status text when the user enlarges it. The host window frame and final docking size remain controlled by Animate, and the user may resize or dock the panel.
- The desktop manager's temporary always-on-top mode applies only while the small-window mode is active. Losing focus, maximizing, entering fullscreen, or minimizing clears the topmost flag and restores the previous bounds when the small-window mode is left. This prevents the manager from covering another application after the user clicks Animate or another window.
- The left sidebar remains the top-level entry. When a typed root such as ordinary, effect, or audio is selected, the top category bar shows only that root's direct child folders. Selecting a child drills one level deeper; a parent control returns to the previous level. Categories do not flatten unrelated top-level folders, and a new child inherits its parent's type scope. Category metadata never changes an asset's ordinary/effect/audio type.
- Import can opt into a custom preview longest-edge cap of 256, 512, 1024, or 2048 (2K) pixels. The setting affects newly generated previews only; an existing same-stem preview remains eligible for direct reuse when “优先使用同名预览图” is enabled. Large effect GIFs remain bounded by frame, pixel, and time budgets and may fall back to a static cover.
- Import destinations are optional typed category IDs. The host forwards the ID, and core validates that it exists and is compatible with the selected import mode before changing metadata. Creating a top-level folder or a child folder is completed before the import resumes, preserving the preview checkbox and resolution choice. If a duplicate source has no explicit destination, its prior category remains unchanged; an explicit destination reclassifies it atomically with the import.
- “隐藏已归入子文件夹” is a renderer-side visibility option passed to the model. It never changes category metadata, undo history, or the complete search result set; toggling it clears the current card selection and anchor so hidden items cannot be operated on accidentally.
- Dragging an FLA card toward the Animate taskbar button may hand off focus during the same pointer gesture. The native helper first verifies the taskbar button and target Animate process, then the renderer revalidates pointer position, receiver capability, and document identity before creating the short-lived stage request. It never sends an FLA or marker file through Animate's native file importer.

## Acceptance
Two byte-identical FLAs yield one asset; same-name distinct files yield two. Two selected items assigned to a category immediately and undo persists. Existing same-stem preview is used only when option is on; off renders a new image. Bad FLA fails one card but other imports continue. AN unavailable keeps library usable and reports pending transfer. 实际 AN 2023 已完成基本插入；用户已实机确认普通跨窗口拖到 AN 舞台的粘贴链路可用。任务栏悬停切换、复杂声音/相机/骨骼/脚本和 Animate 2024 仍是独立验收边界。

持久化行为以集成测试覆盖失败、重开、24 小时边界和撤销；真实 Electron UI 验证隐藏详情、灯箱、卡片按钮、主题持久化、分类树、菜单、小窗。原生隔离目标文档检查帧/层/居中/复用与恢复目标。打包后核对源码一致性、插件、归档 CRC32 和 SHA256。

用户补充：素材看起来大致位于舞台中央即可，不以亚像素精度作为产品验收门槛；沿用已有居中逻辑，不为精密定位扩展功能。

## 0.3 导入、音频与分类增量（已授权）

- 三个独立导入入口：普通素材、特效素材、音频。普通是默认，模式在导入前明确显示；移动分类不会触发动图生成。混合文件夹只扫描该入口支持的文件。
- 特效优先复用同名 GIF；关闭复用则自动生成。只有特效 FLA 进入动图流程。最多60帧、6秒、10fps、640px；大于32MB或动画预算耗尽时保留静态预览并提示。队列单任务运行，不同时启动多个编码器。
- 音频库独立导航，支持 MP3/WAV/OGG/FLAC 导入、去重、试听、搜索、分类、收藏、点赞和原文件定位。一次播放一份，快照刷新不打断试听；不进入FLA预览队列。格式无法解码时显示明确失败，原件仍可定位和拖出。
- 图片灯箱支持鼠标滚轮缩放（25%至800%）、拖动平移、重置；缩放围绕鼠标位置。GIF卡片悬停播放，灯箱播放，避免所有卡片同时循环。
- 分类区域独立滚动、子类折叠、本机记忆展开状态、快速筛选；支持分类置顶、取消置顶、重开持久化与撤销。同级置顶优先排列，保留父子关系。
- 音频通过原生文件拖拽导入剪映/AN；FLA使用舞台拖动通道，不把标记或FLA交给原生导入器。一次手势的只读监视器确认释放到Animate工作区，再创建5秒内有效、绑定目标文档ID的自动插入请求。取消、错误目标、多AN进程、目标文档切换不会自动插入；旧面板明确提示重新打开新版。
- 大库每页最多60个卡片，搜索和分类覆盖全库；翻页清除选择，Ctrl+A只选当前页。空闲同步只传变化令牌，不反复复制完整库；隐藏窗口降低检查频率，生成预览/传递期间及时更新。
- 音频正常导入、重复/错误文件、取消、试听跳转、重开、类别大量增长、缩放边界、动图与静态隔离均需自动验证；AN/剪映实机拖放另行记录观察结果，不能用发起拖拽代替成功导入证据。

## 0.3.8 主动复制与 AN 当前文档入库

- 素材卡片、放大预览、详情提供复制入口；必须二次确认目标文件夹后才创建一份可读中文名副本，重名递增，不覆盖、不自动入库。只在用户主动操作时复制；原始文件夹失效时选择位置。音频同样可复制。取消确认不写文件、不打开资源管理器。
- AN 小面板新增当前文档入库图标，与原粘贴按钮并排，约88×48。读取当前文档后先原生二次确认，再保存；未命名文档用AN自带保存窗口，任一取消均不入库。库内文档更新原记录与预览，不复制；外部新FLA沿用普通导入与去重。同字节重复不重置分辨率/分类/类型，不重新生成预览。管理器需运行，超时可重试。
- 新收件桥接仅传小JSON描述，事件驱动、串行处理、限大小与路径、原子回执；退出关闭watcher，不新增空闲全库轮询。
- 更新提醒：启动约3秒后仅检查一次GitHub官方最新正式发布，有新版时显示入口标记，不自动弹模态或下载安装。手动入口展示中文下载更新方法，可关闭启动检查；网络不可用不影响本地素材。只查询版本信息，不发送素材或路径，退出不保留更新后台进程。旧版本首次需手动升级。
- 自定义皮肤：本地PNG/JPG/JPEG/WebP、GIF、MP4/WebM底图，静音视频循环，可调遮罩深浅、暂停动态和恢复默认；记忆选择但不复制底图。窗口后台或最小化暂停动态。图片40MB、视频300MB上限；原文件丢失提示重选。原暗色/暖色仍可切换，素材卡片保持可读。
