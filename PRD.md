# 安安素材管理器 — 产品与验收
2026-10-13，Windows 本地单用户应用。用户授权规划、实现、本地测试及打包。实际宿主为 Animate 2023 23.0.0.407 / CEP 11.5.3；清单同时支持 2024，后者待实测。

2026-10-15：用户明确授权完成修复后自动提交、推送并发布新版到现有 GitHub 仓库 `anyv-DH/anshelf`，随后更新桌面快捷方式。素材库和备份不进入公开仓库。

## Core requirements
- 0.3.4：“用 AN 打开”创建独立工作目录，文件仍用素材名称，例如“都市人物_女主角.fla”；同名素材、重复或并发打开各自隔离，不覆盖先前工作副本。
- 0.3.4：选中素材后，“选择分类”替换原分类；“加入其他分类”保留已有分类，把同一素材加入其他兼容文件夹。多个分类共享一个素材和预览，计数/搜索/收藏/子文件夹过滤识别全部归属；详情中点击分类 × 只取消该分类，支持撤销和重开。
- 0.3.4：导入 FLA 后若需要自动预览，检查并启动已安装的 Animate；已有 AN 进程时不重复启动。同名预览可用和音频导入不启动 AN。启动失败明确提示，离线预览和成功导入继续完成，不把素材交给 AN 文件导入器。
- Import .fla files and folders, preserve originals, deduplicate identical bytes, and retain source paths.
- Import dialog has “优先使用同名预览图” enabled by default. Matching same-stem PNG/JPG/JPEG/WebP is reused; otherwise previews are automatically generated and cached. Disable to force regeneration. Failed previews can retry.
- Categories, favorites, tags, search, multi-select, instant category assignment and undo. Categories are metadata; originals are never moved.
- Each FLA is one material unit. Insert the complete source scenes/timelines into the current AN document, preserving editable objects where native Animate supports them. Duplicate library symbols are folded into one hash-namespaced group; same name with different content remains separate.
- “发送到 AN” queues selected asset; AN CEP panel confirms and “粘贴到舞台” inserts it into the current target. No source overwrite or target auto-save.
- 插入舞台中央、目标当前图层、播放头准确所在帧。延续帧转普通关键帧，继承原内容后追加；已有关键帧直接追加。不新增目标层，不打空白关键帧，不自动保存目标。临时源副本关闭，目标保持打开。
- 0.2：暗色/暖色主题保存本机偏好；自定义标题栏与主题一致，排序采用主题菜单。常规与 930×700 置顶小窗均可使用。
- 详情默认隐藏，按需打开/关闭。点击预览图放大查看；每卡片有“用 AN 打开”（管理器副本）和“粘贴到舞台”（排队到 AN 面板确认）。
- 层级分类，例如人物→男、女；父类视图包含后代。拒绝不存在父级、循环和同父级重名。删除保留素材，直接素材未分类，子类提升到原父级（重名加序号），可撤销。
- 收藏永久保留；收藏视图按素材已有的原分类路径自动提供筛选按钮，不另建收藏分类；没有原分类的素材进入“未分类”。点赞从点击起保留 24 小时，到期退出点赞视图，保留素材，且不显示收藏分类栏。分类操作随选中/操作状态出现，不常驻宽操作区。
- 重命名继续沿用 AppData/AnShelf 和 appId，兼容既有 65 份素材。
- 左上角“安安”采用为本项目原创绘制的矢量字标，不嵌入第三方字体；暗色与暖色主题分别提供协调的双色渐变，保持产品名称可读与导航可用。
- AN 内的 CEP 面板也命名为“安安素材管理器”，默认约 48×48、最低 40×40 内容区，仅保留一个粘贴按钮。窄面板显示图标，放大后显示状态文字；素材名称和错误详情由悬停提示提供，不常驻标志、路径或说明区。
- 素材页顶部标题、导入、搜索与排序压紧上移，提高首屏素材数量。提供自动 / 每行 4、5、6 个的显示选择并保存本机偏好；正常主窗实际按所选列数展示，小窗或详情展开空间不足时减少列数，保证按钮可用且不横向滚动。
- 素材卡片提供“打开文件所在位置”，在资源管理器选中仍存在的原始 FLA；多个原始来源时选择可用者，原位置不可用则定位素材库副本并说明。桌面端只接收已知素材 ID，不接收任意路径，原件不修改。
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
