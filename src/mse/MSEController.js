import BufferScheduler from "./BufferScheduler";

class MSEController {
  constructor(videoElement) {
    this.video = videoElement;
    this.mediaSource = null;
    this.scheduler = null;
    this._objectUrl = null;
    this.isInitialized = false;
    this.isOpen = false;
    this.pendingInit = {};
  }

  initialize() {
    if (this.isInitialized) return;
    this.mediaSource = new MediaSource();
    this.mediaSource.addEventListener("sourceopen", this._onSourceOpen.bind(this));
    this.mediaSource.addEventListener("sourceended", () => console.log("[MSE] ended"));
    this.mediaSource.addEventListener("sourceclose", () => console.log("[MSE] closed"));
    this.mediaSource.addEventListener("error", () => console.error("[MSE] error"));

    this._objectUrl = URL.createObjectURL(this.mediaSource);
    this.video.src = this._objectUrl;
     this.video.currentTime = 0;
    // 🔥 全量打点
    const dbg = (name) => this.video.addEventListener(name, () => {
      const buf = this.video.buffered;
      const ranges = Array.from({ length: buf.length }, (_, i) =>
        `[${buf.start(i).toFixed(2)},${buf.end(i).toFixed(2)}]`
      ).join(" ") || "[]";
      console.log(`[VIDEO] ${name} | ct=${this.video.currentTime.toFixed(2)} | readyState=${this.video.readyState} | buffered=${ranges}`);
    });
    ["waiting", "stalled", "error", "canplay", "playing", "pause"].forEach(dbg);

    this.scheduler = new BufferScheduler(
      this.video,
      () => (this.mediaSource ? this.mediaSource.readyState : "closed")
    );
    this.isInitialized = true;
  }

  _onSourceOpen() {
    this.isOpen = true;
    console.log("[MSE] sourceopen 成功");
    if (Object.keys(this.pendingInit).length > 0) {
      this._applyInitData(this.pendingInit);
    }
  }

  onInitSegment(data) {
    console.log("[MSE] 收到 initSegment");
    if (data.audioMoov) this.pendingInit.audioMoov = data.audioMoov;
    if (data.audioCodec) this.pendingInit.audioCodec = data.audioCodec;
    if (data.videoMoov) this.pendingInit.videoMoov = data.videoMoov;
    if (data.videoCodec) this.pendingInit.videoCodec = data.videoCodec;

    if (this.isOpen) {
      this._applyInitData(this.pendingInit);
    }
  }

  _applyInitData(data) {
    console.log("[MSE] 执行 applyInitData");
    const { audioMoov, videoMoov, audioCodec, videoCodec } = data;

    if (audioMoov && audioCodec && !this.scheduler.sourceBuffers.audio) {
      console.log("[MSE] 创建 audio SourceBuffer");
      this._addSourceBuffer("audio", `audio/mp4; codecs="${audioCodec}"`);
      this.scheduler.push("audio", audioMoov, true);
    }

    if (videoMoov && videoCodec && !this.scheduler.sourceBuffers.video) {
      console.log("[MSE] 创建 video SourceBuffer");
      this._addSourceBuffer("video", `video/mp4; codecs="${videoCodec}"`);
      this.scheduler.push("video", videoMoov, true);
    }
  }

  _addSourceBuffer(type, mimeType) {
    try {
      const sb = this.mediaSource.addSourceBuffer(mimeType);
      this.scheduler.register(type, sb);
      console.log(`[MSE] ✅ SourceBuffer 创建成功 [${type}] ${mimeType}`);

      if (type === 'video') {
        // updateend 是 video.buffered 更新的唯一可靠时机
        // moov append 完成后 buffered 还是空的，所以用 removeEventListener 持续等到第一个真实分片
        const onFirstContent = () => {
          const buf = this.video.buffered;
          if (!buf.length) return;
          sb.removeEventListener('updateend', onFirstContent);

          const start = buf.start(0);
          const end = buf.end(0);
          if (start > 0.5 && this.video.currentTime < start) {
            // PTS 不从 0 起（中途接入直播），跳到末尾 - 3s 追直播边沿
            const target = Math.max(start, end - 3);
            console.log(`[MSE] 🚀 直播对齐 start=${start.toFixed(2)}s → seek=${target.toFixed(2)}s`);
            //this.video.currentTime = target;
          }
        };
        sb.addEventListener('updateend', onFirstContent);
      }
    } catch (e) {
      console.error(`[MSE] ❌ 创建SB失败 [${type}]`, e);
    }
  }

  // 🔥 打点：是否收到分片数据
  onFragParsing(data) {
    const { type, data: fragment } = data;
    console.log(`[MSE] 收到分片 => ${type} 大小=${fragment.byteLength} `);
    this.scheduler.push(type, fragment);
  }

  onFragParsed() {}

  endOfStream() {
    if (!this.mediaSource || this.mediaSource.readyState !== "open") return;
    const allIdle = Object.values(this.scheduler.sourceBuffers).every(sb => !sb.updating);
    const allEmpty = Object.values(this.scheduler.queues).every(q => q.length === 0);
    if (allIdle && allEmpty) this.mediaSource.endOfStream();
  }

  pause() { this.video.pause(); }
  resume() { this.video.play(); }

  reset() {
    this.scheduler?.flushQueues();
    for (const type in this.scheduler.sourceBuffers) {
      try { this.mediaSource?.removeSourceBuffer(this.scheduler.sourceBuffers[type]); } catch {}
    }
    this.pendingInit = {};
    this.isOpen = false;
  }

  destroy() {
    this.reset();
    this.scheduler?.destroy();
    if (this._objectUrl) URL.revokeObjectURL(this._objectUrl);
    this.video.src = "";
    this.mediaSource = null;
  }
}

export default MSEController;