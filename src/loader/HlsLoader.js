class HlsLoader {
  /**
   * 构造函数
   * @param {Function} onData - 数据处理回调函数
   * @param {Object} options - 可选参数
   */
  constructor(onData, options = {}) {
    this.onData = onData;
    this.reader = null;
    this.destroyed = false;
    this.options = options; // 支持自定义的请求参数
    this.abortController = null; // 控制请求的中止
  }

  /**
   * 加载 HLS 文件
   * @param {string} url - HLS 文件的 URL
   */
  loadHls(url) {
    const { headers, timeout = 30000 } = this.options;
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    const fetchOptions = {
      method: "GET",
      headers,
      signal,
    };

    const timeoutId = setTimeout(() => {
      console.warn("HlsLoader fetch timeout");
      this.abort(); // 超时终止请求
    }, timeout);

    fetch(url, fetchOptions)
      .then((res) => {
        clearTimeout(timeoutId);
        if (!res.ok) {
          throw new Error(`HTTP status ${res.status}: ${res.statusText}`);
        }
        this.reader = res.body.getReader();

        this.onheader(res);
        if (res.redirected) {
          this.on302(res);
        }
        this.onopen();
        this.pump(this.reader);
      })
      .catch((e) => {
        clearTimeout(timeoutId);
        if (e.name === "AbortError") {
          console.warn("HlsLoader fetch aborted");
        } else {
          this.onerror(e.message);
        }
      });
  }

  /**
   * 读取流数据
   * @param {ReadableStreamDefaultReader} reader - 可读流的读取器
   */
  pump(reader) {
    reader
      .read()
      .then((result) => {
        if (result.done) {
          console.log("HlsLoader reading complete");
          this.onend();
          return;
        }
        const chunk = result.value.buffer;
        if (this.destroyed) {
          this.abort();
        } else {
          if (this.onData) {
            this.onData(chunk); // 传递数据
          }
          this.onprogress(chunk); // 通知进度
          this.pump(reader);
        }
      })
      .catch((err) => {
        console.error("HlsLoader.pump error:", err);
        this.onerror(err.message);
      });
  }

  /**
   * 中止加载
   */
  abort() {
    if (this.abortController) {
      console.log("HlsLoader aborting");
      this.abortController.abort();
      this.abortController = null;
    }
    if (this.reader) {
      this.reader.cancel().catch(() => {});
      this.reader = null;
    }
  }

  /**
   * 销毁加载器
   */
  destroy() {
    this.destroyed = true;
    this.abort();
    this.reset();
  }

  /**
   * 重置加载器
   */
  reset() {
    this.reader = null;
    this.abortController = null;
    this.destroyed = false;
  }

  /**
   * 处理响应头
   * @param {Response} res - fetch API 的响应对象
   */
  onheader(res) {
    console.log("HlsLoader onheader:", res.headers);
  }

  /**
   * 处理 302 重定向
   * @param {Response} res - fetch API 的响应对象
   */
  on302(res) {
    console.log("HlsLoader on302: redirected to", res.url);
  }

  /**
   * 处理连接打开
   */
  onopen() {
    console.log("HlsLoader onopen");
  }

  /**
   * 处理加载完成
   */
  onend() {
    console.log("HlsLoader onend: loading complete");
  }

  /**
   * 处理加载进度
   * @param {ArrayBuffer} chunk - 当前读取的块
   */
  onprogress(chunk) {
    console.log(
      "HlsLoader onprogress: received chunk of size",
      chunk.byteLength
    );
  }

  /**
   * 处理错误
   * @param {string} err - 错误信息
   */
  onerror(err) {
    console.error("HlsLoader onerror:", err);
  }
}

export default HlsLoader;
