# 参与贡献

感谢你为安安素材管理器提交改进。项目面向 Windows 与 Adobe Animate 制作者，优先保持本地处理、原文件不移动、AN 插入可回退和界面容易理解。

## 开始开发

需要 Node.js 22+、pnpm 和 Windows。安装依赖并运行基础检查：

```powershell
pnpm install --frozen-lockfile
pnpm test
pnpm build
```

完整 Electron 验收需要设置 `ANSHELF_PLAYWRIGHT`，命令与隔离数据目录说明见 [TEST_PLAN.md](TEST_PLAN.md)。测试不能指向用户的 `%APPDATA%\\AnShelf`，也不能把用户的 FLA、预览图或作品复制到仓库。

## 提交改动

- 持久化行为先补核心测试，再修改 UI；分类是元数据操作，不能移动原件。
- 新增导入类型时必须验证文件扩展名、内容哈希、预览队列和错误恢复。
- 修改 CEP 运行文件后必须重新生成签名；不要提交私钥、证书或本机安装目录。
- 不要把 `dist/`、`release/`、`test-output/`、用户素材或本地 AppData 数据提交到 Git。
- 代码文件保留项目归属头；第三方目录保留上游许可证和原作者说明。

提交前至少运行：

```powershell
pnpm test
pnpm build
node scripts/category-ui-e2e.cjs
node scripts/filter-ui-e2e.cjs
git diff --check
```

涉及发布包或 CEP 的改动，再运行 `electron-builder`、`scripts/verify-release.cjs` 和对应的便携版/安装版验收。真实 Animate 和剪映行为必须单独注明是实机验证还是自动契约测试。

## 归属与许可证

项目基础许可证是 Apache-2.0。请保留源文件中的 `Copyright (c) 2026 安屿动画`、根目录 `NOTICE` 和 [COMMERCIAL-ATTRIBUTION.md](COMMERCIAL-ATTRIBUTION.md)。商业再发布需要遵守其中的 UI 署名约定；第三方代码按各自许可证执行。
