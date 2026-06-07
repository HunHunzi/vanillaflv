class CacheMgr {
  constructor() {
    // 解析后的帧数据
    this.videoFrames = []; // 视频帧缓存队列
    this.audioFrames = []; // 音频帧缓存队列
  }

  /**
   * 添加解析后的帧
   * @param {Object} frame - 解析后的帧数据
   */
  addFrame(frame) {
    if (frame.type === "video") {
      this.videoFrames.push(frame);
    } else if (frame.type === "audio") {
      this.audioFrames.push(frame);
    }
  }

  /**
   * 获取下一个视频帧
   * @returns {Object|null}
   */
  getNextVideoFrame() {
    return this.videoFrames.shift() || null;
  }

  /**
   * 获取下一个音频帧
   * @returns {Object|null}
   */
  getNextAudioFrame() {
    return this.audioFrames.shift() || null;
  }

  /**
   * 获取视频帧数量
   * @returns {number}
   */
  getVideoFrameSize() {
    return this.videoFrames.length;
  }

  /**
   * 获取音频帧数量
   * @returns {number}
   */

  getAudioFrameSize() {
    return this.audioFrames.length;
  }

  /**
   * 清理缓存
   */
  clear() {
    this.videoFrames = [];
    this.audioFrames = [];
  }
}

export default CacheMgr;
