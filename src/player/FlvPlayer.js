import PlayerBase from "./PlayerBase";
import FlvLoader from "../loader/FlvLoader";
import MSEController from "../mse/MSEController";

class FlvPlayer extends PlayerBase {
  constructor(options) {
    super();
    this.type = "flv";
    this.options = options;

    this.loader = new FlvLoader(
      this.onData.bind(this),
      () => this.mseController.endOfStream()
    );

    this.mseController = new MSEController(options.videoElement);
    this.mseController.initialize();

    // Webpack 5：new URL(..., import.meta.url) 让 webpack 把 worker 单独打包
    this.worker = new Worker(new URL('../worker/FlvWorker.js', import.meta.url));
    this.worker.onmessage = this._onWorkerMessage.bind(this);
    this.worker.onerror = (e) => console.error('[FlvPlayer] Worker error', e);
  }

  loadFlv(url) {
    this.loader.loadFlv(url);
  }

  onData(data) {
    // data 是 ArrayBuffer（来自 FlvLoader.pump 的 result.value.buffer）
    // 用 Transferable 转移所有权到 Worker，主线程零拷贝
    this.worker.postMessage({ type: 'data', buffer: data }, [data]);
  }

  _onWorkerMessage(e) {
    const { type } = e.data;

    if (type === 'initSegment') {
      this.mseController.onInitSegment(e.data.data);

    } else if (type === 'fragment') {
      // e.data.buffer 是从 Worker 转移来的 ArrayBuffer，主线程零拷贝
      this.mseController.onFragParsing({
        type: e.data.trackType,
        data: new Uint8Array(e.data.buffer),
      });
      this.mseController.onFragParsed();
    }
  }

  destroy() {
    this.loader.destroy();
    this.worker.postMessage({ type: 'destroy' });
    this.worker.terminate();
    this.mseController.destroy();
  }
}

export default FlvPlayer;
