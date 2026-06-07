import Player from "./Player";

class PlayerDemo {
  constructor(initParams) {
    const { streamType, source } = initParams || {};
    this.streamType = streamType || "mp4";
    this.source = source || "";
    this.videoElement = null;
    this.playerInstance = null;
  }

  init(initParams) {
    const { streamType, source } = initParams || {};
    this.streamType = streamType || "mp4";
    this.source = source || "";
    if (this.playerInstance) {
      this.playerInstance.init({
        streamType: this.streamType,
        source: this.source,
      });
    }
  }

  /**
   * 绑定 <video> 元素
   * @param {HTMLVideoElement} videoElement - 必须为 HTMLVideoElement 类型
   */
  bindVideoElement(videoElement) {
    if (!(videoElement instanceof HTMLVideoElement)) {
      throw new Error("videoElement must be an instance of HTMLVideoElement");
    }
    this.videoElement = videoElement;

    // 初始化 Player 实例
    this.playerInstance = new Player(this.videoElement, {
      streamType: this.streamType,
      source: this.source,
    });
  }

  /**
   * 播放视频
   */
  play() {
    if (this.playerInstance) {
      this.playerInstance.play();
    } else {
      throw new Error("Player instance is not initialized");
    }
  }

  /**
   * 暂停视频
   */
  pause() {
    if (this.playerInstance) {
      this.playerInstance.pause();
    } else {
      throw new Error("Player instance is not initialized");
    }
  }

  /**
   * 停止播放
   */
  stop() {
    if (this.playerInstance) {
      this.playerInstance.stop();
    } else {
      throw new Error("Player instance is not initialized");
    }
  }

  /**
   * 销毁播放器实例
   */
  destroy() {
    if (this.playerInstance) {
      this.playerInstance.destroy();
      this.playerInstance = null; // 清空实例
    }
    this.videoElement = null; // 清空绑定的视频元素
  }
}

export default PlayerDemo;
window.PlayerDemo = PlayerDemo;
