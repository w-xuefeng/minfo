# MINFO 文档索引

MINFO 是 **Music Information** 的缩写合成词。它是一款部署在 GitHub Pages 上的纯前端音频元信息管理工具：用户在浏览器中选择或拖入本地音频文件，查看、编辑可写元数据，并导出原格式或转换后的新文件。

本仓库当前只沉淀产品与工程决策，尚未创建应用代码。

| 文档 | 说明 |
| --- | --- |
| [01-product-scope.md](01-product-scope.md) | 用户目标、范围、术语与验收标准 |
| [02-architecture.md](02-architecture.md) | UI/服务分层、媒体能力路由与 Worker 边界 |
| [03-metadata-and-format-policy.md](03-metadata-and-format-policy.md) | 元数据模型、格式语义与导出兼容性规则 |
| [04-ui-ux.md](04-ui-ux.md) | 页面信息架构、状态、无障碍与交互规范 |
| [05-deployment-privacy.md](05-deployment-privacy.md) | GitHub Pages、隐私、性能与安全约束 |
| [06-delivery-roadmap.md](06-delivery-roadmap.md) | 分阶段实施、测试矩阵与上线门槛 |

## 已确认的基线

- 前端：Vite、Vue 3、TypeScript、pnpm。实际建项时采用当时稳定的最新版本并由 lockfile 固化，不在设计阶段虚构版本号。
- 部署：`main` 保存源码和文档；每次推送 `main` 后，GitHub Actions 构建并把产物发布到孤儿 `pages` 分支根目录，GitHub Pages 从该分支提供静态站点。默认无后端、无账号、无云端文件上传。
- 分层：UI 层只负责呈现与用户意图；服务层负责文件检查、元数据读写、能力判定、转码和下载。
- 媒体：先使用浏览器原生能力取得文件属性、可用时长与编解码能力信息；通用的容器标签、封面、歌词读取与写入不属于 Web Native/WebCodecs 的能力，因而在 Dedicated Worker 中以 `ffprobe` WASM 探测、以 `ffmpeg` WASM 写入或转码作为兜底。
- 运行时缓存：体积较大的 `ffmpeg` / `ffprobe` WASM 运行时首次按需加载后缓存至 OPFS；缓存由构建生成的版本化清单和 SHA-256 完整性校验控制，依赖变更时自动更新。
- 隐私：音频内容、封面和歌词默认只在当前浏览器会话中处理，导出产物由浏览器下载。

## 关键术语

- **文件扩展名**：如 `.mp3`、`.m4a`。它是用户可见的命名提示，不能单独作为真实格式判断依据。
- **容器**：组织音频流和标签的文件结构，例如 MP4/M4A、Ogg、WAV。
- **编解码器**：压缩或还原音频数据的算法，例如 MP3、AAC、FLAC、ALAC。
- **元数据**：标题、艺术家、专辑、封面、歌词等附随信息。不同容器可表达的字段并不相同。
- **原格式导出**：不改变用户选择的输出扩展名；为写入标签，内部仍可能需要重封装或流复制，绝不就地修改源文件。
