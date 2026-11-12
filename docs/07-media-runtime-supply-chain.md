# FFmpeg / FFprobe WASM 与 pnpm 供应链策略

## 已确认的决定

MINFO 使用 ffmpeg.wasm 已发布、可直接部署的单线程运行时，而不再要求浏览器核心必须由最新官方 FFmpeg 源码自行编译。

截至 **2026-11-11**，固定组合为：

| 职责                     | 包               | 固定版本  | 说明                                                  |
| ------------------------ | ---------------- | --------- | ----------------------------------------------------- |
| 浏览器 Worker/API 包装层 | `@ffmpeg/ffmpeg` | `0.12.15` | 应用调用 `load()`、`exec()` 和 `ffprobe()` 的接口     |
| 单线程 WASM 核心         | `@ffmpeg/core`   | `0.12.10` | 由构建脚本从已安装包复制到同源静态资源目录            |
| 核心内的 FFmpeg 基线     | ffmpeg.wasm 构建 | `n5.1.4`  | 信息字段；不是 MINFO 强行升级到官方最新 FFmpeg 的承诺 |

`@ffmpeg/core` 同时承载 `ffmpeg` 执行与 `ffprobe` JSON 探测能力。MINFO 不安装或加载一个不存在的独立 `ffprobe.wasm` npm 包；应用通过 `@ffmpeg/ffmpeg` 的 `ffprobe()` API 调用同一 WASM 核心。[ffmpeg.wasm API](https://ffmpegwasm.netlify.app/docs/api/ffmpeg/classes/ffmpeg/) 和其[当前依赖基线](https://ffmpegwasm.netlify.app/docs/overview/)是这一约定的依据。

许可证字段保留为可追溯信息，不会因 LGPL、GPL 或 nonfree 文本而拒绝加载。MINFO 是个人工具，但该事实不改变上游许可证的客观存在；本项目不提供法律判断。

## 运行时投放与浏览器完整性

构建时，`scripts/sync-media-runtime.mjs` 只从 pnpm 已安装的精确路径复制：

```text
node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js
node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm
```

这是有意选择的 ESM 变体。Vite 会使用 `@ffmpeg/ffmpeg` 的模块 Worker；该 Worker 在模块环境中通过动态 `import(coreURL)` 取得 core 的默认导出。UMD 变体没有该默认导出，会在初始化前报出 `failed to import ffmpeg-core.js`。`verify-media-runtime.mjs` 会实际导入生成的 core，并要求其默认导出为可调用函数，避免以后误复制 UMD 变体而只在浏览器中才暴露问题。

它生成 `public/media-runtime/manifest.json`（schema 3），记录：

- `@ffmpeg/core`、`@ffmpeg/ffmpeg` 的包名与固定版本；
- 核心内 FFmpeg 的已知基线，仅供展示和问题定位；
- 每个同源资产的文件名、长度和 SHA-256；
- 单线程/多线程变体。

浏览器启动时重新校验每个下载资产的长度与 SHA-256，之后才交给 Worker 加载；OPFS 缓存命中时也会重新校验。缓存身份包含核心/包装层版本及所有资产哈希，因此包升级或二进制变化会自动使用新缓存。GitHub Pages 基线为单线程核心，避免依赖其无法配置的 COOP/COEP 跨源隔离响应头。

这保证“页面实际执行的字节”与本次构建清单一致，但它不是独立的信任根：若 `main`、Pages 分支写入权限、GitHub Actions 执行环境或开发机遭入侵，攻击者仍可能同时替换清单和资产。因此分支保护、最小化 Actions 权限与依赖更新审查仍是必要边界。

## 开发期 FFmpeg / FFprobe 日志

FFprobe 输入预检失败时，界面会显示失败阶段、退出码和最多 12 条、每条最多 600 个字符的错误行；这些内容仅来自当前用户已选择的文件的浏览器内 Worker。它们用于说明新副本的输入保留结果无法预先完全验证，并要求用户确认后才继续尝试导出；不会上传或发送到服务端。

需要完整 Worker 输出时，可在本地开发环境设置 `VITE_MINFO_MEDIA_DEBUG=1` 后运行 `pnpm dev`。MINFO 仅在 `import.meta.env.DEV` 为真时调用 `console.debug()`，输出带有 `MINFO media:ffmpeg:*` 或 `MINFO media:ffprobe:*` 前缀。生产构建和 GitHub Pages 即使存在同名环境变量也不会输出这些日志；建议不要在共享屏幕或共享控制台时启用它，因为日志可能包含所选文件的名称或元数据。

## FFprobe `-1` 兼容处理

当前锁定的 `@ffmpeg/core@0.12.10` 初始化 Emscripten 的 `Module.ret` 为 `-1`，而其 `ffprobe()` 包装函数会直接返回该字段。部分成功的 FFprobe 调用会写出完整 JSON，却没有更新这个字段；因此单独将 `-1` 解释成探测失败会产生误报。

MINFO 不会因此放松交付完整性检查：仅当 `ffprobe()` 返回 `0` 或这个已知的 `-1` 哨兵值，且**输出文件**能解析为 JSON、包含非空容器名和至少一个带编码名的音频流时，才允许下载。输入预检中的其他非零状态、空文件、无效 JSON、无容器或无音频流会成为需确认的副本风险，不会修改源文件，也不自动禁止用户尝试导出；输出检查出现这些情况仍阻止下载。导出的文件还会继续核对目标容器与编码，以及能够逐项验证的元数据。

## pnpm 供应链门槛

供应链控制统一由 pnpm 负责，覆盖 FFmpeg WASM 及所有直接、传递、开发依赖，而不是只为 FFmpeg 另建一套 PGP/自编译流程。

`pnpm-workspace.yaml` 固定以下项目级策略：

| 控制                                                              | 目的                                                                              |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `saveExact`、精确的 `package.json` 版本 + 已提交 `pnpm-lock.yaml` | 新增依赖默认写入精确版本；普通安装/构建不接受 `latest`、`^` 或 `~` 悄然解析为新包 |
| `minimumReleaseAge: 1440` + `minimumReleaseAgeStrict`             | 新发布包至少冷却 24 小时，缺失发布时间时也拒绝解析                                |
| `trustPolicy: no-downgrade`                                       | 升级不能无声降低发布可信度                                                        |
| `blockExoticSubdeps: true`                                        | 拒绝传递依赖从 Git、裸 tarball 等非常规来源引入代码                               |
| `verifyStoreIntegrity` + `strictStorePkgContentCheck`             | 校验 pnpm 内容寻址存储及包内容一致性                                              |
| `strictDepBuilds: true` + 空 `allowBuilds`                        | 默认不准依赖安装/构建脚本执行；若未来确有必要，必须逐包显式审查并记录允许原因     |
| 项目 `.npmrc` 固定 npm Registry 与 TLS                            | CI 不依赖机器的隐式 Registry 选择                                                 |

CI 和本地可复现验证使用：

```bash
pnpm install --frozen-lockfile --ignore-scripts
pnpm audit signatures
pnpm audit --audit-level=low
pnpm run build
```

其中：

- `--frozen-lockfile` 禁止重新解析依赖图；
- `--ignore-scripts` 不执行依赖生命周期脚本；
- `pnpm audit signatures` 验证 Registry 提供的 ECDSA 包签名；若某个支持签名的 Registry 给出的包没有有效签名，命令失败；
- `pnpm audit --audit-level=low` 使任一已知低/中/高/严重漏洞都阻断 CI；
- 构建后的 `verify:dist-runtime` 复核复制到 Pages 产物的核心字节哈希与清单一致性。

pnpm 的签名与供应链功能不能证明“任何包永远无恶意行为”：它依赖 Registry 的签名基础设施，漏洞审计只能发现已公开的 advisory，锁文件也不能保护被攻破的开发机。它们的价值是让篡改、浮动解析、未审查安装脚本和已知漏洞成为可失败、可审计的事件，而不是静默风险。[pnpm 供应链安全说明](https://pnpm.io/supply-chain-security) 与 [`pnpm audit signatures` 文档](https://pnpm.io/cli/audit)给出了对应行为边界。

## 升级流程

运行时升级是一次普通但必须审查的 pnpm 依赖升级：

1. 修改 `package.json` 中 `@ffmpeg/ffmpeg` 和/或 `@ffmpeg/core` 的**精确版本**；不要使用 `latest`、`^` 或 `~`。
2. 运行 `pnpm install --no-frozen-lockfile --ignore-scripts`，让 pnpm 在上述策略下重写锁文件。
3. 运行 `pnpm audit signatures`、`pnpm audit --audit-level=low`、类型检查、单元测试和浏览器样本回归。
4. 审查 `package.json`、`pnpm-workspace.yaml`、`pnpm-lock.yaml` 和生成的运行时清单，再一并提交。

首次/日常开发无需下载 FFmpeg 官方源码、GPG 公钥或自编译 30 MB 以上的核心。浏览器实际处理能力仍应以 MP3、M4A、ADTS AAC 等首发矩阵样本的回读结果为准；`ffprobe` 可用不等于每一种容器、编码器或元数据字段都已被 MINFO 宣称支持。
