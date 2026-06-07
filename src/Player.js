import MSEController from "./mse/MSEController";
import FlvPlayer from "./player/FlvPlayer";
import HlsPlayer from "./player/HLSPlayer";

class Player {
  constructor(videoElement, initParams) {
    const { streamType, source } = initParams || {};
    if (!(videoElement instanceof HTMLVideoElement)) {
      throw new Error("A valid HTMLVideoElement is required");
    }

    // 初始化参数
    this.video = videoElement;
    this.streamType = streamType || "mp4";
    this.source = source || "";
    this.player = null; // 当前播放器实例
    this.mseController = null; // MSE 管理器

    // 加载初始视频源
    if (this.source) {
      this.loadSource(this.source);
    }
  }

  /**
   * 初始化播放器参数
   */
  init(initParams) {
    const { streamType, source } = initParams || {};
    this.streamType = streamType || "mp4";
    this.source = source || "";
    if (this.source) {
      this.loadSource(this.source);
    }
  }

  /**
   * 加载视频源
   * @param {string} url - 视频地址
   */
  loadSource(url) {
    this.stop(); // 停止当前播放，清理资源

    if (this.streamType === "flv") {
      this.loadFlv(url);
    } else if (this.streamType === "hls") {
      this.loadHls(url);
    } else if (this.streamType === "mp4") {
      this.loadMp4(url);
    } else {
      console.error("Unsupported stream type:", this.streamType);
    }
  }

  /**
   * 加载 FLV 流
   * @param {string} url - FLV 流地址
   */
  loadFlv(url) {
    // 创建 FlvPlayer（内部自行管理 MSEController）
    this.player = new FlvPlayer({ videoElement: this.video });
    this.player.loadFlv(url); // 加载 FLV 数据
    // 测试 onRemuxSegment的mse注入
    //let testUrl = "https://vjs.zencdn.net/v/oceans.mp4";
    //this.player.onRemuxSegment(testUrl);
  }

  /**
   * 加载 HLS 流
   * @param {string} url - HLS 流地址
   */

  loadHls(url) {
    // 创建 HlsPlayer 实例（如果需要）
    if (HlsPlayer.isSupported()) {
      this.player = new HlsPlayer(this.video);
      this.player.load(url);
    } else {
      console.error("HLS is not supported on this browser.");
    }
  }

  /**
   * 加载 MP4 文件
   * @param {string} url - MP4 文件地址
   */
  loadMp4(url) {
    this.video.src = url; // 直接加载 MP4 文件
    this.video.addEventListener("canplay", () => {
      console.log("MP4 file is ready to play");
    });
  }

  /**
   * 播放视频
   */
  play() {
    if (!this.video.src) {
      console.error("No video source loaded.");
      return;
    }
    this.video.play().catch((err) => {
      console.error("Error during play:", err);
    });
    this.mseController && this.mseController.resume();
  }

  /**
   * 暂停视频
   */
  pause() {
    this.video.pause();
    this.mseController && this.mseController.pause();
  }

  /**
   * 停止播放并重置
   */
  stop() {
    if (this.video) {
      this.video.pause();
      this.video.currentTime = 0;
    }
    if (this.mseController) {
      this.mseController.endOfStream();
    }
    if (this.player && typeof this.player.destroy === "function") {
      this.player.destroy(); // 销毁播放器实例
    }

    this.player = null;
  }

  /**
   * 销毁播放器实例
   */
  destroy() {
    this.stop();
    if (this.mseController) {
      this.mseController.destroy();
      this.mseController = null;
    }
    this.video = null;
    this.player = null;
  }
}

export default Player;
