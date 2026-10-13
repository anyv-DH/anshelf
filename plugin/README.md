# 安安素材管理器 · AN 面板

作者：安屿动画。面板代码按项目根目录的 Apache License 2.0 与商业归属附加条款发布；商用集成不得移除面板或宿主页面中的“安屿动画”归属信息。

此目录是与安安素材管理器配套的 CEP 面板，目标为 Windows、Adobe Animate 2023（23.x）和 2024（24.x）。清单声明宿主范围 `[23.0,24.9]`，最低运行时为 CSXS 11.0，可用于 CEP 11 或 12。

本机 Animate 2023 版本 23.0.0.407，CEP 11.5.3，内嵌 Node v15.9.0 已确认。真实三份素材首次/重复插入、完整面板链路、舞台居中及独立目标第 50/100 帧普通关键帧、图层不增加、继承原内容已实测通过。0.3.2 面板默认约 48×48（最低 40×40）并保留单按钮；不同复杂 FLA 的全面兼容仍以实际制作文件为准。

## 安装面板

在插件目录运行以下命令，不需要管理员权限：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

交付面板已使用 Adobe 官方 ZXPSignCmd 在本机自签；这不是 Adobe 审核或商业发布者认证。脚本校验签名清单中的文件 SHA256，将完整面板（包括 `mimetype` 和 `META-INF/signatures.xml`）安装到 `%APPDATA%\Adobe\CEP\extensions\com.anshelf.receiver`，默认不修改注册表或系统证书。请完整解压目录，勿只复制 HTML/JS。签名的信任与有效性由 AN 的 CEP 加载器检查。

更新时先在独立目录完成复制和校验，再替换插件；旧安装保留在 `%APPDATA%\Adobe\CEP\AnShelfPluginBackups`，替换失败会尝试恢复。备份不放在 extensions 下，以免 AN 发现同名扩展。素材库保持原样。

`-CepMajor` 只接受 `11` 或 `12`，默认 `11`；它只选择显式启用开发调试时的注册表版本，不修改插件清单。版本对应关系如下：

| Animate | CEP / 参数 | 当前验证情况 |
|---|---|---|
| 2023（23.x） | CEP 11，`-CepMajor 11` | 本机基本原生插入、帧/层、居中与复用已通过 |
| 2024（24.x） | CEP 12，`-CepMajor 12` | 声明支持，宿主实测待完成 |

只有自行修改源码并移除签名元数据后的未签名开发目录，才需要显式启用调试。本机出现过正确设置 `PlayerDebugMode` 仍被 AN 拒绝加载未签名扩展的情况；已通过签名面板解决。Animate 2023：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -EnableDebug -CepMajor 11
```

Animate 2024：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -EnableDebug -CepMajor 12
```

`-EnableDebug` 只把当前用户所选版本的 `HKCU\Software\Adobe\CSXS.11\PlayerDebugMode` 或 `CSXS.12\PlayerDebugMode`（字符串）设为 `1`，允许此用户运行该 CEP 版本的其他未签名扩展。没有该参数时，即使指定 `-CepMajor` 也不改注册表。它不会修改 WindowsApps、Animate 安装文件或全局执行策略。签名元数据缺一部分或文件哈希不符时，即使启用调试也拒绝安装，避免把损坏的面板覆盖到正常安装上。

任何已签名文件的修改都必须重新签名。使用 [Adobe 官方签名工具和指南](https://github.com/Adobe-CEP/CEP-Resources/tree/master/ZXPSignCMD) 对不含旧签名元数据的运行文件目录签成 ZXP；解包后保留 `mimetype` 和 `META-INF/signatures.xml` 并运行 `ZXPSignCmd -verify <目录>`。本版本证书有效期至 2036 年 10 月；私钥和密码不随交付包分发。安装脚本不属于运行签名内容。

安装后保存作品并重启 Animate，选择 **窗口 > 扩展 > 安安素材管理器**。保持面板打开，在管理器点击素材“粘贴到舞台”，再回目标 AN 文档选择普通可编辑图层/帧，点击面板“粘贴到舞台”。目标文档可以未保存；面板成功后显示插入结果，桌面端读取同一回执。

面板内容区默认约 48×48、最低 40×40，只显示一个按钮。窄面板显示原创图标，放大后显示连接或处理状态文字；素材名和详细结果放在按钮的悬停提示中；无待处理素材时按钮不可点击。AN 可能记住旧的大尺寸，更新后拖动边缘缩小即可；菜单改名在下次重启后生效。外层标题栏与停靠位置由 Animate 决定。

0.3.2舞台拖动：从管理器FLA卡片的「拖出」区域拖到AN舞台／工作区，松开后面板自动执行粘贴。也支持在同一次拖拽中悬停 AN 的 Windows 任务栏按钮：native helper 先确认精确的 Animate 按钮和目标 PID，renderer 再验证鼠标释放位置、面板能力和 `Document.id`，通过后才创建5秒请求。桌面端不向原生导入器发送FLA或标记文件；监视器只在本次手势期间运行，失败或取消即清理。用户已确认普通跨窗口拖到 AN 舞台粘贴可用；任务栏自动切换仍需独立实机验收。原有按钮确认流程保持可用。音频直接拖入宿主支持的导入区域，不通过此FLA面板。

卸载时先退出 Animate，然后删除上述 `com.anshelf.receiver` 目录即可。素材库数据保留在 `%APPDATA%\AnShelf`。安装脚本会拒绝源、安装目录及其父级路径中的符号链接或目录联接，脚本文本使用 ASCII 以兼容 Windows PowerShell 5。

## 插入内容与处理方式

- 面板只读取 `%APPDATA%\AnShelf\bridge` 的固定格式请求，验证版本、SHA256、素材路径和符号链接。队列不支持任意 JSFL 代码。
- 插入前创建单独的临时 FLA 副本；原素材和内容寻址的受管理副本不会被改写。临时源文档会被 Animate 自动打开，导入完成后关闭且不保存。单次插入支持最多 512 MB 的 FLA；超出时在读取和创建副本之前报告失败。
- 每个源场景的完整图层和帧通过 Animate `copyLayers(0,last)` / `pasteLayers(0)` 收进独立图形元件。多场景按原顺序接在总 MovieClip 里，场景各占一层且结尾为空白，不叠加覆盖。双击总元件可以继续编辑内部场景。
- 库目录是 `AnShelf/<完整素材SHA256>/source`、`scenes` 和 `whole`。相同字节素材再次插入时复用已有 `whole`；该元件在目标库中被用户修改后也会复用修改后的版本，不会重新导入或覆盖修改。同名不同内容使用不同哈希目录。此处“去重”是相同 FLA 文件的字节去重，不是识别不同 FLA 内部视觉相同的元件。
- 总元件居中添加到目标当前场景、当前图层、播放头所在帧。延续帧转为普通关键帧，继承已有内容后追加；已有关键帧直接追加，不增加目标层、不创建空白关键帧。编辑嵌套元件时逐层回当前场景舞台。目标文件不自动保存，现有舞台对象保留。

## 已知验证边界

实际可编辑性取决于 Animate 的本机原生复制行为。掩码/引导层、相机和骨骼、场景级 ActionScript/跳转、声音同步、嵌入视频、HTML5 Canvas 与 AS3 的跨文档兼容、字体替换需要真实素材测试。把源场景包进元件会改变场景级脚本的执行上下文；项目不是整 FLA 无差别合并器。帧率不同会提示，目标帧率保持原值。复杂素材出现模态字体或兼容弹窗时，由用户在 Animate 中处理；接收面板不会自动点掉弹窗。

只有目标层可编辑才会插入。无目标文档、锁层、隐藏层、非法路径或字节哈希不匹配会报告失败。若原生粘贴已部分执行后失败，目标可能存在未完成元件；请检查目标库或使用 Animate 撤销。接收器没有声称具备跨全部原生 API 的事务回滚。只在源临时文档已关闭后尝试清理临时文件；如文件仍被 AN 占用，会显示提示。

Node 契约测试覆盖请求原子写入、越界/符号链接、心跳、字节校验与文件大小上限、临时副本、固定 receiver 调用、多层多场景/帧、场景结束、哈希复用、嵌套编辑返回当前场景舞台、未保存目标恢复和错误清理。测试不启动 Adobe 软件。

## 实机验收

先在目标文件副本验证一个单元件武器 FLA、一个带嵌套元件和声音的 FLA、一个多场景多层 FLA。检查第一到最后一帧、内部可编辑对象、不同场景顺序、同素材二次插入、同名不同素材、未保存目标和已有对象是否完整。通过后再在正式工作文档使用。

## 核对的官方 API

以下是 Adobe 官方公开 JSFL 文档；文档核对不等于本机运行验证。

- [library.addNewItem](https://github.com/AdobeDocs/developers-animatesdk-docs/blob/master/library_object/library1.md)：创建元件并返回 Boolean。
- [library.moveToFolder](https://github.com/AdobeDocs/developers-animatesdk-docs/blob/master/library_object/librar11.md)：移动元件并返回 Boolean。
- [document.addItem](https://github.com/AdobeDocs/developers-animatesdk-docs/blob/master/Document_object/documen4.md)：添加元件并返回 Boolean。
- [fl.runScript](https://github.com/AdobeDocs/developers-animatesdk-docs/blob/master/flash_object_(fl)/fl62.md)：指定函数名后返回该函数的字符串结果。
- [fl.setActiveWindow](https://github.com/AdobeDocs/developers-animatesdk-docs/blob/master/flash_object_(fl)/fl69.md)：用 Document 对象恢复活动窗口，无返回值。
- [timeline.copyLayers](https://github.com/AdobeDocs/developers-animatesdk-docs/blob/master/Timeline_object/timelin7.md) / [pasteLayers](https://github.com/AdobeDocs/developers-animatesdk-docs/blob/master/Timeline_object/timeli35.md)：复制范围含两端；粘贴返回最低层索引。
- [timeline.addNewLayer](https://github.com/AdobeDocs/developers-animatesdk-docs/blob/master/Timeline_object/timelin1.md)：在当前层上方创建图层并返回实际索引，临时转移层使用该索引，不假定是第 0 层。
- [timeline.insertBlankKeyframe](https://github.com/AdobeDocs/developers-animatesdk-docs/blob/master/Timeline_object/timeli27.md)：已有关键帧和普通帧的插入规则不同，因此总元件首帧不重复调用。
