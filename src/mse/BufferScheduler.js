const MAX_BUFFER_AHEAD = 30;
const MIN_BUFFER_AHEAD = 10;
const EVICT_KEEP_BEHIND = 2;

class BufferScheduler {
  constructor(video, getReadyState) {
    this.video = video;
    this.getReadyState = getReadyState;
    this.sourceBuffers = {};
    this.queues = {};
    this._throttled = false;

    this._checkInterval = setInterval(() => {
      this._checkThrottle();
    }, 500);

    this._onTimeUpdate = this._checkThrottle.bind(this);
    this._onWaiting = this._onWaiting.bind(this);
    video.addEventListener("timeupdate", this._onTimeUpdate);
    video.addEventListener("waiting", this._onWaiting);
  }

  register(type, sourceBuffer) {
    this.sourceBuffers[type] = sourceBuffer;
    this.queues[type] = [];
    sourceBuffer.addEventListener("updateend", () => {
      console.log(`[SB] updateend => ${type}`);
      this._onUpdateEnd(type);
    });
    sourceBuffer.addEventListener("error", (e) => console.error(`[SB] 错误 ${type}`, e));
  }

  // 🔥 打点：入队日志
  push(type, data, prepend = false) {
    if (!this.queues[type]) this.queues[type] = [];
    prepend ? this.queues[type].unshift(data) : this.queues[type].push(data);
    console.log(`[SCHED] 入队 ${type} | 队列剩余=${this.queues[type].length} | throttled=${this._throttled}`);
    this._drain(type);
  }

  _drain(type) {
    const sb = this.sourceBuffers[type];
    if (!sb) { console.log(`[SCHED] ❌ 无SB ${type}`); return; }
    if (this.getReadyState() !== "open") { console.log(`[SCHED] MS未open`); return; }
    if (sb.updating) { console.log(`[SCHED] ${type} 正在更新，跳过`); return; }
    if (!this.queues[type]?.length) { return; }
    if (this._throttled) { console.log(`[SCHED] ⏸️ 背压开启，不消费 ${type}`); return; }

    const data = this.queues[type].shift();
    console.log(`[SCHED] ✅ 开始追加 ${type} | 队列剩余=${this.queues[type].length}`);

    try {
      sb.appendBuffer(data);
    } catch (e) {
      console.log(`[SCHED] ❌ 追加失败 ${type}`, e.name);
      this.queues[type].unshift(data);
      if (e.name === "QuotaExceededError") this._evict(type);
      setTimeout(() => this._onUpdateEnd(type), 0);
    }
  }

  _onUpdateEnd(type) {
    for (const t in this.sourceBuffers) this._drain(t);
  }

  _checkThrottle() {
    const ahead = this._bufferedAhead();
    if (this._throttled && ahead < MIN_BUFFER_AHEAD) {
      console.log(`[SCHED] ✅ 背压关闭 | 缓冲=${ahead.toFixed(1)}s`);
      this._throttled = false;
      for (const t in this.sourceBuffers) this._drain(t);
    } else if (!this._throttled && ahead > MAX_BUFFER_AHEAD) {
      console.log(`[SCHED] ⏸️ 背压开启 | 缓冲=${ahead.toFixed(1)}s`);
      this._throttled = true;
    }
  }

  _bufferedAhead() {
    const ct = this.video.currentTime;
    const buf = this.video.buffered;
    if (!buf.length) return 0;
    let maxEnd = 0;
    for (let i = 0; i < buf.length; i++) { try { maxEnd = Math.max(maxEnd, buf.end(i)); } catch {} }
    return Math.max(0, maxEnd - ct);
  }

  _evict(type) {
    const sb = this.sourceBuffers[type];
    if (!sb || sb.updating) return;
    const evictEnd = Math.max(0, this.video.currentTime - EVICT_KEEP_BEHIND);
    console.log(`[SCHED] 清理缓冲区 ${type} 0~${evictEnd.toFixed(1)}s`);
    try { sb.remove(0, evictEnd); } catch {}
  }

  _onWaiting() {
    const ct = this.video.currentTime;
    const buf = this.video.buffered;
    for (let i = 0; i < buf.length; i++) {
      const start = buf.start(i);
      if (start > ct && start < ct + 1) {
        console.log(`[VIDEO] 🚀 跳坑 ${ct.toFixed(2)} → ${start.toFixed(2)}`);
        this.video.currentTime = start + 0.05;
        break;
      }
    }
  }

  flushQueues() { for (const t in this.queues) this.queues[t] = []; this._throttled = false; }
  destroy() { clearInterval(this._checkInterval); }
}

export default BufferScheduler;