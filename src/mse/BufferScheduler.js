/**
 *  MSEController 和 SourceBuffer 之间的调度中间层
 */
const MAX_BUFFER_AHEAD = 30; // 水位上限
const MIN_BUFFER_AHEAD = 10; // 水位下限
const EVICT_KEEP_BEHIND = 2; // 保留内存

class BufferScheduler {
  constructor(video, getReadyState) {
    this.video = video;
    this.getReadyState = getReadyState;
    this.sourceBuffers = {};
    this.queues = {};
    this._throttled = false; // 背压开关

    // 纯事件驱动，不使用 setInterval
    // timeupdate：播放中持续触发，用于检测缓冲是否已追上
    // playing：暂停后恢复播放时触发，立即重新检查背压
    this._onTimeUpdate = this._checkThrottle.bind(this);
    this._onPlaying = this._checkThrottle.bind(this);
    this._onWaiting = this._onWaiting.bind(this);
    video.addEventListener("timeupdate", this._onTimeUpdate);
    video.addEventListener("playing", this._onPlaying);
    video.addEventListener("waiting", this._onWaiting);
    video.addEventListener("stalled", this._onWaiting); // stalled 与 waiting 同样处理
  }

  // 将 SourceBuffer 注册进来，绑定 updateend 事件
  register(type, sourceBuffer) {
    this.sourceBuffers[type] = sourceBuffer;
    this.queues[type] = [];
    sourceBuffer.addEventListener("updateend", () => {
      console.log(`[SB] updateend => ${type}`);
      this._onUpdateEnd(type);
    });
    sourceBuffer.addEventListener("error", (e) => console.error(`[SB] 错误 ${type}`, e));
  }

  // prepend确保moov永远先入队
  push(type, data, prepend = false) {
    if (!this.queues[type]) this.queues[type] = [];
    prepend ? this.queues[type].unshift(data) : this.queues[type].push(data);
    console.log(`[SCHED] 入队 ${type} | 队列剩余=${this.queues[type].length} | throttled=${this._throttled}`);
    this._drain(type);
  }

  // 调度核心：每次有数据入队或 updateend 触发时调用，尝试消费队列头部的一条数据
  _drain(type) {
    const sb = this.sourceBuffers[type];
    if (!sb) { console.log(`[SCHED] ❌ 无SB ${type}`); return; }
    if (this.getReadyState() !== "open") { console.log(`[SCHED] MS未open`); return; }
    if (sb.updating) { console.log(`[SCHED] ${type} 正在更新，跳过`); return; }
    if (!this.queues[type]?.length) return;

    // 每次实际消费前检查缓冲水位，实时触发背压开启
    // 这样即使在 timeupdate 不触发时（如暂停），push 进来的数据也不会撑爆缓冲区
    const ahead = this._bufferedAhead();
    if (ahead > MAX_BUFFER_AHEAD) {
      if (!this._throttled) {
        console.log(`[SCHED] ⏸️ 背压开启 | 缓冲=${ahead.toFixed(1)}s`);
        this._throttled = true;
      }
      return;
    }

    // 已开启背压但水位还未降到恢复阈值，等待 timeupdate / playing 事件来恢复
    if (this._throttled) { console.log(`[SCHED] ⏸️ 背压中，等待播放头追上`); return; }

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

  // 每次append调度前都要背压调度
  _onUpdateEnd(type) {
    for (const t in this.sourceBuffers) this._drain(t);
  }

  // 只负责"背压解除"：由 timeupdate / playing 驱动，检测播放头是否追上
  _checkThrottle() {
    if (!this._throttled) return;
    const ahead = this._bufferedAhead();
    if (ahead < MIN_BUFFER_AHEAD) {
      console.log(`[SCHED] ✅ 背压关闭 | 缓冲=${ahead.toFixed(1)}s`);
      this._throttled = false;
      for (const t in this.sourceBuffers) this._drain(t);
    }
  }

  //  计算前向缓冲量
  _bufferedAhead() {
    const ct = this.video.currentTime;
    const buf = this.video.buffered;
    if (!buf.length) return 0;
    let maxEnd = 0;
    // 遍历所有 range 取最大值，可能有多个不连续区间（如 seek 后形成空洞）
    for (let i = 0; i < buf.length; i++) { try { maxEnd = Math.max(maxEnd, buf.end(i)); } catch {} }
    return Math.max(0, maxEnd - ct);
  }

  // 内存回收
  _evict(type) {
    const sb = this.sourceBuffers[type];
    if (!sb || sb.updating) return;
    // 保留部分
    const evictEnd = Math.max(0, this.video.currentTime - EVICT_KEEP_BEHIND);
    console.log(`[SCHED] 清理缓冲区 ${type} 0~${evictEnd.toFixed(1)}s`);
    try { sb.remove(0, evictEnd); } catch {}
  }

  _onWaiting() {
    // 视频因缓冲耗尽进入 waiting，timeupdate 此时不触发，需要主动检查能否解除背压
    // 这是去掉 setInterval 后必须补上的兜底：让被 throttle 拦住的队列有机会恢复消费
    this._checkThrottle();

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

  // 清空所有待写入的分片队列，强制解除
  flushQueues() { for (const t in this.queues) this.queues[t] = []; this._throttled = false; }

  destroy() {
    this.video.removeEventListener("timeupdate", this._onTimeUpdate);
    this.video.removeEventListener("playing", this._onPlaying);
    this.video.removeEventListener("waiting", this._onWaiting);
    this.video.removeEventListener("stalled", this._onWaiting);
  }
}

export default BufferScheduler;
