# vanillaflv

> 😎一个人在闲暇时间瞎整出来的 FLV ，代码不算优雅，但绝对适合新手入门。

基于 **MediaSource Extensions (MSE)** 和 **Web Worker** 实现的轻量级浏览器端 FLV 视频播放器。无需 Flash，零运行时依赖，纯原生 JavaScript 手撸 FLV 解析、fMP4 重混和流式播放全流程。

---

## 写在前面

这个项目是我自研的，从零开始搭，没有用 flv.js 之类的现成库。功能比较基础，坑也不少，但正因为简单，**整个播放流程一目了然**

---

## 特性

- **零依赖**：不依赖任何第三方运行时库，纯原生 JavaScript 实现
- **Worker 并发**：FLV 解析与 fMP4 重混运行在独立 Web Worker 中，不阻塞主线程 UI
- **零拷贝传输**：通过 Transferable Objects 在线程间转移 ArrayBuffer 所有权，避免数据拷贝
- **流式加载**：基于 Fetch ReadableStream 边下边播，首帧延迟低
- **背压控制**：BufferScheduler 动态调节 SourceBuffer 消费速率，防止内存溢出
- **多格式支持**：FLV（完整实现）、MP4（直连播放）、HLS（框架预留，还没写完）

---

## 架构原理

整体流程其实不复杂，数据单向流动，每一层职责明确：

```text
HTTP Server
    │  FLV 字节流
    ↓
FlvLoader  ──  Fetch ReadableStream 逐块读取
    │  ArrayBuffer chunk
    ↓  postMessage (Transferable，零拷贝)
FlvWorker  ─────────────────────────────────┐
    ├─ FlvCacher    ← FLV Tag 缓冲与边界对齐  │  Web Worker 线程
    ├─ FlvParser    ← 解析 FLV Tag，提取帧    │
    └─ FMp4Remux   ← 生成 initSegment/moof  │
                                            ┘
    │  postMessage (Transferable，零拷贝)
    ↓
主线程 MSEController
    ├─ new MediaSource() + SourceBuffer
    └─ BufferScheduler  ← 背压控制 & 缓冲区管理
```

---

## 快速开始

**环境要求**：Node.js ≥ 16，现代浏览器（Chrome / Firefox / Edge 均可）

```bash
# 安装依赖
npm install

# 开发模式（自动打开 http://localhost:8080）
npm start

# 打包 SDK（输出 dist/bundle.js，UMD 格式）
npm run build
```

---

## API 参考

### 创建实例

```js
const player = new PlayerDemo();
```

### `bindVideoElement(videoElement)`

绑定 HTML `<video>` 元素，须在 `init()` 之前调用。

```js
const video = document.getElementById('myVideo');
player.bindVideoElement(video);
```

### `init(options)`

初始化播放器并加载视频源。

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `streamType` | `'flv'` \| `'mp4'` \| `'hls'` | 视频流类型 |
| `source` | `string` | 视频地址（URL） |

```js
player.init({
  streamType: 'flv',
  source: 'http://example.com/live.flv'
});
```

### 播放控制

```js
player.play();    // 开始播放
player.pause();   // 暂停
player.stop();    // 停止并重置缓冲区
player.destroy(); // 销毁实例，释放所有资源
```

### 完整示例

```html
<!DOCTYPE html>
<html>
<body>
  <video id="video" controls style="width: 640px"></video>
  <script src="dist/bundle.js"></script>
  <script>
    const player = new PlayerDemo();
    player.bindVideoElement(document.getElementById('video'));
    player.init({ streamType: 'flv', source: '/sample.flv' });
    player.play();
  </script>
</body>
</html>
```

---

## 目录结构

```text
├── src/
│   ├── Player.js               # 核心播放器：根据 streamType 分发到具体实现
│   ├── PlayerDemo.js           # 对外公开的 API 入口
│   ├── index.html              # 开发演示页面
│   ├── buffer/
│   │   └── CacheMgr.js         # 缓存管理
│   ├── config/
│   │   ├── Browser.js          # 浏览器能力检测
│   │   ├── Config.js           # 全局配置（时间基等）
│   │   └── FlvConstants.js     # FLV 格式常量（Tag 类型、编码 ID 等）
│   ├── demux/
│   │   ├── FlvCacher.js        # FLV Tag 缓冲与字节对齐
│   │   └── FlvParser.js        # FLV 格式解析器，逐 Tag 提取音视频帧
│   ├── loader/
│   │   ├── FlvLoader.js        # FLV HTTP 流加载器（Fetch + ReadableStream）
│   │   └── HlsLoader.js        # HLS 加载器（预留框架）
│   ├── mse/
│   │   ├── MSEController.js    # MediaSource 生命周期管理
│   │   ├── BufferScheduler.js  # SourceBuffer 队列调度与背压控制
│   │   └── MSEPlayer.js        # MSE 播放器（预留）
│   ├── player/
│   │   ├── PlayerBase.js       # 播放器抽象基类
│   │   ├── FlvPlayer.js        # FLV 播放器（完整实现）
│   │   ├── HLSPlayer.js        # HLS 播放器（预留）
│   │   └── MP4Player.js        # MP4 直连播放器
│   ├── remux/
│   │   ├── FMp4Remux.js        # FLV → fMP4 重混器（核心）
│   │   └── mp4-generator.js    # MP4 Box 二进制构建工具库
│   ├── utils/
│   │   ├── SpsParser.js        # H.264 SPS NALU 解析（提取分辨率等参数）
│   │   └── logger.js           # 日志工具
│   └── worker/
│       └── FlvWorker.js        # Web Worker 入口（解析 + 重混）
├── test/
│   └── LoaderController.test.js
├── webpack.config.js           # 开发构建配置
├── webpack.build.js            # SDK 打包配置（UMD）
└── package.json
```

---

## 技术说明

### FLV 格式

FLV 文件结构其实很简单：9 字节 Header + 若干 Tag 首尾相连。每个 Tag 长这样：

- **Tag Type**（1 字节）：`0x09` 视频 / `0x08` 音频 / `0x12` Script 数据
- **Data Size**（3 字节）：Tag 数据长度
- **Timestamp**（4 字节，单位 ms）：解码时间戳
- **Tag Data**：编码帧数据（H.264 / AAC）

`FlvParser` 逐 Tag 顺序解析，提取 SPS/PPS、AAC Config 和音视频帧，传给 `FMp4Remux` 封装成 fMP4 喂给 MSE。

### 为什么要重混成 fMP4？

MSE 的 SourceBuffer 不认识 FLV，只接受 **fragmented MP4（fMP4）** 格式。所以需要一个重混步骤：

1. **initSegment**（`ftyp + moov`）：播放前一次性发送，告诉浏览器视频分辨率、采样率等参数
2. **Fragment**（`moof + mdat`）：每帧/每组帧对应一个，源源不断 append 进去

这一步是整个项目最复杂的部分，代码在 `src/remux/` 里，感兴趣可以重点看。

### 背压控制

光把数据喂进去还不够，喂太快会撑爆内存。`BufferScheduler` 每 500ms 检查一次缓冲时长：

| 缓冲状态 | 动作 |
| --- | --- |
| > 30 s | 暂停消费，等播放头追上来 |
| < 10 s | 恢复消费 |
| SourceBuffer 已满 | 删除已播放的部分（`remove(0, currentTime - 5)`） |

---

## 浏览器兼容性

| 特性 | Chrome | Firefox | Edge | Safari |
| --- | --- | --- | --- | --- |
| MediaSource Extensions | 23+ | 42+ | 13+ | 13+ |
| Fetch ReadableStream | 43+ | 65+ | 14+ | 14.1+ |
| Web Worker + Transferable | 4+ | 4+ | 12+ | 5+ |

> FLV 源需以 **H.264 + AAC** 编码，且服务端需允许 CORS 跨域请求。

---

## 已知局限

毕竟是个人自研项目，有些地方还比较粗糙：

- HLS 支持只有框架，尚未实现
- 没有做 seek（跳转进度）支持
- 错误处理比较简陋，生产环境慎用
- 没有单元测试覆盖核心解析逻辑

欢迎 PR 和 Issue，也欢迎单纯来学习交流。

---

## License

[MIT](./LICENSE)
