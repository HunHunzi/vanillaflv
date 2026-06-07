class FlvLoader {
  /**
   * 构造函数
   * @param {Function} onData - 数据处理回调函数
   */
  constructor(onData, onComplete) {
    this.onData = onData;
    this.onComplete = onComplete;
    this.reader = null;
    this.destroyed = false;
  }

  /**
   * 加载 FLV 文件
   * @param {string} url - FLV 文件的 URL
   */
  loadFlv(url) {
    fetch(url)
      .then((res) => {
        let reader = res.body.getReader();
        this.reader = reader;
        if (this.destroyed) {
          this.abort(); // 终止加载
        } else {
          // 判断 HTTP 状态码是否有效
          if (res.ok && res.status >= 200 && res.status < 300) {
            this.onheader(res); // 处理响应头
            if (res.redirected) {
              this.on302(res); // 处理 302 重定向
            }
            this.onopen(); // 处理连接打开
            this.pump.call(this, reader); // 读取流数据
          } else {
            console.log(
              "ProtoLinkFetch http code invalid status:" + res.status
            );
            this.onerror(res.statusText, res.status);
          }
        }
      })
      .catch((e) => {
        console.log("ProtoLinkFetch exception");
        this.onerror(e.message);
      });
  }

  /**
   * 读取流数据
   * @param {ReadableStreamDefaultReader} reader - 可读流的读取器
   * @returns {Promise<void>} -
   */
  pump(reader) {
    reader
      .read()
      .then((result) => {
        if (result.done) {
          this.reader = null;
          console.log("[FlvLoader] stream complete");
          this.onComplete && this.onComplete();
        } else {
          let chunk = result.value.buffer; // chunk 是一个 ArrayBuffer，二进制字节流
          if (this.destroyed) {
            this.abort();
          } else {
            if (this.onData) {
              // 将数据传递给 onData 回调函数
              this.onData(chunk);
            }
            // 继续读取流数据
            this.pump(reader);
          }
        }
      })
      .catch((err) => {
        console.error("ProtoLinkFetch.pump", err);
        this.onerror(err);
      });
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
   * 处理错误
   * @param {string} err - 错误信息
   * @param {number} [httpCode] - HTTP 状态码
   */
  onerror(err, httpCode) {
    console.log("ProtoLinkFetch.onerror " + err);
  }

  /**
   * 中止加载
   */
  abort() {
    if (this.reader && this.reader.cancel) {
      console.log("ProtoLinkFetch.abort reader");
      this.reader.cancel();
      this.reader = null;
    }
  }

  /**
   * 重置加载器
   */
  reset() {
    this.reader = null;
    this.destroyed = false;
  }

  /**
   * 处理响应头
   * @param {Response} res - fetch API 的响应对象
   */
  onheader(res) {
    console.log("ProtoLinkFetch.onheader", res);
  }

  /**
   * 处理 302 重定向
   * @param {Response} res - fetch API 的响应对象
   */
  on302(res) {
    console.log("ProtoLinkFetch.on302", res);
  }

  /**
   * 处理连接打开
   */
  onopen() {
    console.log("ProtoLinkFetch.onopen");
  }
}

export default FlvLoader;
