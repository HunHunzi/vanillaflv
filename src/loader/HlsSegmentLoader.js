/**
 * HLS 分片调度加载器
 *
 * 职责：
 *   1. 拉取 m3u8 → 若为 Master Playlist，自动选择最高码率的媒体列表
 *   2. 按序下载每个 .ts 分片，每下完一个立即回调 onSegment
 *   3. 直播模式（无 EXT-X-ENDLIST）：每 targetDuration/2 秒轮询刷新列表，只下载新增分片
 *   4. VOD 模式：分片全部下完后回调 onEnd
 *   5. 支持 EXT-X-DISCONTINUITY：通过 onSegment 的 discontinuity 参数通知 Worker
 */

import M3U8Parser from '../demux/M3U8Parser';

class HlsSegmentLoader {
  /**
   * @param {(buffer: ArrayBuffer, discontinuity: boolean) => void} onSegment
   * @param {() => void} onEnd
   * @param {(err: string) => void} onError
   */
  constructor(onSegment, onEnd, onError) {
    this.onSegment = onSegment;
    this.onEnd     = onEnd;
    this.onError   = onError;

    this._destroyed      = false;
    this._mediaUrl       = null;   // 最终确定的 media playlist URL
    this._lastSequence   = -1;     // 最后一个已成功下载的分片序号
    this._pollTimer      = null;   // 直播轮询定时器 (setTimeout ID)
    this._currentAbort   = null;   // 当前分片请求的 AbortController
    this._isLive         = false;  // 是否直播模式
    this._targetDuration = 5;      // 目标分片时长，用于计算轮询间隔
  }

  /**
   * 开始加载
   * @param {string} url - m3u8 地址（master 或 media 均可）
   */
  load(url) {
    console.log(`[HLS] 开始加载: ${url}`);
    this._fetchAndProcess(url);
  }

  // ─── 播放列表获取与处理 ────────────────────────────────────────────────────

  /**
   * 拉取任意 m3u8 地址并决定后续动作
   */
  async _fetchAndProcess(url) {
    if (this._destroyed) return;

    const text = await this._fetchText(url);
    if (text === null) return; // 出错已在内部处理

    let playlist;
    try {
      playlist = M3U8Parser.parse(text, url);
    } catch (e) {
      this._emitError(`M3U8 解析失败: ${e.message}`);
      return;
    }

    if (playlist.isMaster) {
      this._handleMaster(playlist);
    } else {
      this._mediaUrl = url;
      await this._handleMedia(playlist);
    }
  }

  /**
   * Master Playlist：选最高码率的 variant，递归拉取其 media playlist
   */
  _handleMaster(playlist) {
    if (!playlist.variants.length) {
      this._emitError('Master playlist 中没有可用的 variant');
      return;
    }

    // 按码率降序，取第一条（最高码率）
    const variants = playlist.variants.slice().sort((a, b) => b.bandwidth - a.bandwidth);
    const best = variants[0];
    console.log(`[HLS] 选择 variant: ${best.bandwidth}bps ${best.resolution} → ${best.url}`);
    this._fetchAndProcess(best.url);
  }

  /**
   * Media Playlist：下载所有新增分片，直播时追加轮询
   */
  async _handleMedia(playlist) {
    if (this._destroyed) return;

    const { segments, isVOD, targetDuration } = playlist;

    this._isLive         = !isVOD;
    this._targetDuration = targetDuration || 5;

    // 过滤出还没下载过的分片
    let newSegments;
    if (this._lastSequence === -1) {
      // 首次加载
      newSegments = isVOD
        ? segments                          // VOD：从头开始
        : this._pickLiveEdge(segments);     // 直播：从靠近末尾的分片开始，降低首帧延迟
    } else {
      newSegments = segments.filter(s => s.sequence > this._lastSequence);
    }

    console.log(
      `[HLS] 本轮更新: 列表总数=${segments.length} 新增=${newSegments.length} ` +
      `lastSeq=${this._lastSequence} isVOD=${isVOD}`
    );

    // 顺序下载每个分片
    for (const seg of newSegments) {
      if (this._destroyed) return;
      const ok = await this._fetchSegment(seg);
      if (ok) this._lastSequence = seg.sequence;
    }

    if (isVOD) {
      console.log('[HLS] VOD 全部分片下载完成');
      this.onEnd && this.onEnd();
      return;
    }

    // 直播：等待 targetDuration/2 后刷新列表
    this._schedulePoll();
  }

  /**
   * 直播首次加载时，取列表末尾 3 个分片，跳过历史积压
   */
  _pickLiveEdge(segments) {
    const LIVE_START_BACK = 3;
    const start = Math.max(0, segments.length - LIVE_START_BACK);
    const picked = segments.slice(start);
    console.log(`[HLS] 直播边沿对齐: 从 seq=${picked[0]?.sequence} 开始 (跳过前 ${start} 个)`);
    return picked;
  }

  // ─── 直播轮询 ─────────────────────────────────────────────────────────────

  _schedulePoll() {
    // targetDuration/2 是 RFC 8216 推荐的轮询间隔，最小 1s
    const interval = Math.max(1000, (this._targetDuration / 2) * 1000);
    console.log(`[HLS] 直播轮询 ${(interval / 1000).toFixed(1)}s 后刷新`);
    this._pollTimer = setTimeout(() => this._refreshPlaylist(), interval);
  }

  async _refreshPlaylist() {
    if (this._destroyed) return;

    // 追加时间戳防止浏览器或 CDN 缓存旧播放列表
    const url = this._mediaUrl + (this._mediaUrl.includes('?') ? '&' : '?') + '_t=' + Date.now();
    const text = await this._fetchText(url, { cache: 'no-store' });
    if (text === null) {
      // 拉取失败，2s 后重试，不终止直播
      if (!this._destroyed) {
        console.warn('[HLS] 刷新播放列表失败，2s 后重试');
        this._pollTimer = setTimeout(() => this._refreshPlaylist(), 2000);
      }
      return;
    }

    let playlist;
    try {
      // 解析时用原始 _mediaUrl 作为 base，保证分片相对路径正确解析
      playlist = M3U8Parser.parse(text, this._mediaUrl);
    } catch (e) {
      this._emitError(`M3U8 刷新解析失败: ${e.message}`);
      return;
    }

    await this._handleMedia(playlist);
  }

  // ─── 单个分片下载 ─────────────────────────────────────────────────────────

  /**
   * 下载单个 .ts 分片并回调 onSegment
   * @param {{ url, sequence, discontinuity }} seg
   * @returns {Promise<boolean>} 是否成功
   */
  async _fetchSegment(seg) {
    console.log(`[HLS] ↓ 下载分片 seq=${seg.sequence}${seg.discontinuity ? ' [DISCONTINUITY]' : ''}`);

    const abort = new AbortController();
    this._currentAbort = abort;

    try {
      const res = await fetch(seg.url, { signal: abort.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);

      const buffer = await res.arrayBuffer();

      if (this._destroyed) return false;

      console.log(`[HLS] ✅ 分片到达 seq=${seg.sequence} size=${buffer.byteLength}B`);
      this.onSegment(buffer, seg.discontinuity);
      return true;

    } catch (e) {
      if (e.name === 'AbortError') return false;
      if (!this._destroyed) {
        console.warn(`[HLS] ❌ 分片下载失败 seq=${seg.sequence}: ${e.message}`);
        // 单个分片失败不终止整体，上层 for 循环会跳到下一个
      }
      return false;
    } finally {
      this._currentAbort = null;
    }
  }

  // ─── 通用 HTTP 文本拉取 ──────────────────────────────────────────────────

  /**
   * @param {string} url
   * @param {RequestInit} [extraOpts]
   * @returns {Promise<string|null>}  失败返回 null（已内部 warn，不抛出）
   */
  async _fetchText(url, extraOpts = {}) {
    try {
      const res = await fetch(url, extraOpts);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      if (!this._destroyed) {
        console.warn(`[HLS] 拉取失败 ${url}: ${e.message}`);
      }
      return null;
    }
  }

  // ─── 错误上报 ─────────────────────────────────────────────────────────────

  _emitError(msg) {
    if (!this._destroyed) {
      console.error(`[HLS] 错误: ${msg}`);
      this.onError && this.onError(msg);
    }
  }

  // ─── 销毁 ─────────────────────────────────────────────────────────────────

  /**
   * 终止一切网络请求和定时器
   */
  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;

    clearTimeout(this._pollTimer);
    this._pollTimer = null;

    if (this._currentAbort) {
      this._currentAbort.abort();
      this._currentAbort = null;
    }

    console.log('[HLS] HlsSegmentLoader 已销毁');
  }
}

export default HlsSegmentLoader;
