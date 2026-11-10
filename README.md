# MINFO

**MINFO**，即 **Music Information**，是一款部署在 GitHub Pages 的浏览器端音频元信息管理工具。

它帮助用户查看和编辑本地音频文件的标题、艺术家、专辑、封面、歌词等信息，并导出保持原格式或转换后的新文件。文件默认只在用户自己的浏览器中处理，源文件不会被修改。

> 当前仓库处于设计阶段：已完成文档，尚未创建应用代码。

## 计划中的体验

1. 选择或拖入一个音频文件。
2. 查看可编辑标签和只读技术信息，例如扩展名、大小、时长、编解码器、采样率和声道数。
3. 编辑标题、艺术家、专辑、流派、曲目、封面和歌词等字段。歌词会自动识别 LRC 式时间标签：有标签时按时间轴预览，无标签时保留换行并以纯文本排版展示。新增或替换封面仅接受 PNG、JPG/JPEG、GIF、WebP，最大 2 MB、1000×1000 px。
4. 默认保持原格式，或选择 `mp3`、`aac`、`flac`、`m4a`、`wma`、`wav`、`ogg`、`ape`、`amr`、`mid`、`alac`、`oga`，也可提出自定义扩展名。
5. 在导出前获得真实的兼容性检查。若无法转换或目标可能丢失字段，会清楚说明原因，并建议 MP3 作为兜底格式。
6. 生成一个新的下载文件，原文件保持不变。

## 技术方向

- UI：Vite、Vue 3、TypeScript、pnpm。
- 架构：UI 层与媒体服务层严格分离；UI 不直接依赖媒体内核。
- 媒体能力：先使用 Web Native 取得文件属性及可用的时长/解码技术属性，并用 WebCodecs 探测编解码能力；通用的容器、标签、封面和歌词读取由 Worker 中的 `ffprobe` WASM 兜底，写入元信息或转码由 `ffmpeg` WASM 兜底。大型媒体运行时资产首次按需加载后缓存至 OPFS，以版本清单和 SHA-256 控制更新与完整性。
- 部署：`main` 保存源码与文档。每次 push `main` 由 GitHub Actions 构建，并将产物覆盖式发布到孤儿 `pages` 分支；GitHub Pages 从 `pages` 根目录提供静态站点。
- 隐私：不设后端转码和文件上传。音频内容、封面和歌词只在当前浏览器会话内处理。

WebCodecs 是低层编解码 API，不包含通用的文件容器拆封装、封装或标签读写；浏览器原生可读取文件属性、可用时长及部分解码后的技术信息，但无法通用地读写 ID3、MP4、Vorbis、ASF 等标签。因此 MINFO 会基于运行时能力选择路径：原生能力优先，`ffprobe` WASM 负责完整探测，`ffmpeg` WASM 负责生成带新元信息的文件或转码，绝不会把扩展名或浏览器播放能力误当成格式支持承诺。

## 文档

- [文档索引](docs/README.md)
- [产品范围与验收目标](docs/01-product-scope.md)
- [架构设计](docs/02-architecture.md)
- [元数据与格式策略](docs/03-metadata-and-format-policy.md)
- [UI 与交互规范](docs/04-ui-ux.md)
- [部署、隐私与运行约束](docs/05-deployment-privacy.md)
- [实施路线与验证计划](docs/06-delivery-roadmap.md)

## 开始实施前

下一步是依据路线图创建 Vite + Vue 3 + TypeScript 项目，并先验证从 `main` 到孤儿 `pages` 分支的 GitHub Pages 发布、子路径部署、Worker 通信和媒体能力探测。具体媒体依赖、WASM 编码器支持和各格式支持等级会在真实样本验证后确定，不在设计阶段预先承诺。

## 参考依据

- [MDN: WebCodecs API](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API)
- [W3C: WebCodecs](https://www.w3.org/TR/webcodecs/)
- [FFmpeg WASM 架构说明](https://github.com/ffmpegwasm/ffmpeg.wasm/blob/main/apps/website/docs/overview.md)
- [GitHub Pages 文档](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)
