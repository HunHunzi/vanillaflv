/**
 * FlvCacher 类，用于缓存 FLV 数据
 * @class FlvCacher
 * @desc 用于缓存 FLV 数据
 * @popFrame 返回一个完整的帧数据，包括 FLV Tag Header + Tag Data + Previous Tag Size
 */

"use strict";

class FlvCacher {
  constructor() {
    this.size = 0; // 缓存的数据总大小
    this.buffers = []; // 存储缓存数据的数组
    this.parseFlvHead = false; // 标记是否已经解析了 FLV 头部
  }

  /**
   * 销毁缓存，调用 reset 方法
   */
  destroy() {
    this.reset();
  }

  /**
   * 重置缓存，清空 buffers 并将 size 设为 0
   */
  reset() {
    this.size = 0;
    this.buffers = [];
  }

  /**
   * 解析 FLV 数据
   * @param {Uint8Array} data - 要解析的 FLV 数据
   */
  // 解析 FLV 数据，必须是完整的 FLV 数据，否则会放到缓存中
  parseFlv(data) {
    // 确保 data 是 Uint8Array 类型
    if (data instanceof ArrayBuffer) {
      data = new Uint8Array(data);
    }
    let offset = 0; // 偏移量
    let len = data.byteLength; // 数据长度
    // 处理缓存的头部数据
    if (this.headCache) {
      let cache = new Uint8Array(data.byteLength + this.headCache.length);
      cache.set(this.headCache, 0);
      cache.set(data, this.headCache.length);
      data = cache;
      this.headCache = null;  // ←清空，防止下次再合并
    }
    // 如果有缓存的头部数据，则将头部数据和新数据合并
    if (this.headCache) {
      let cache = new Uint8Array(data.byteLength + this.headCache.length); // 数据的长度+缓存的长度
      // 将缓存的头部数据复制到新的 Uint8Array 的起始位置
      cache.set(this.headCache, 0);
      // 将新的数据复制到新的 Uint8Array 的缓存的长度位置
      cache.set(data, this.headCache.length);
      data = cache; // 将新的数据赋值给 data
    }
    if (this.parseFlvHead === false) {
      let headerLen = FlvCacher.FLV_HEADER_LEN + FlvCacher.PREV_TAG_SIZE_LEN; // FLV 头部长度+前一个标签大小的长度
      // 如果数据长度小于 FLV 头部长度，则说明数据不完整，将数据放到缓存中
      if (len < headerLen) {
        console.warn("FlvParser.parseFlv flv has no header len=" + len);
        this.headCache = data.slice(); // 将数据放到缓存中
        return;
      }
      this.headCache = null;
      offset += headerLen; // 偏移量加上 FLV 头部长度,作为下一次解析的起始位置
      // 如果数据不是有效的 FLV 数据，则返回
      if (!this.probe(data)) {
        return;
      }
      this.parseFlvHead = true; // 标记已经解析了 FLV 头部
    }

    // 偏移量=0，说明是第一次解析，直接添加到缓存中
    if (offset === 0) {
      this.append(data);
    } else {
      this.append(data.slice(offset));
    }
  }

  /**
   * 把接收到的数据放入缓存
   * @param {Uint8Array} data - 要缓存的数据
   */
  append(data) {
    if (data instanceof ArrayBuffer) {
      data = new Uint8Array(data);
    }
    if (data.length === 0) {
      return;
    }
    this.buffers.push(data);
    this.size += data.byteLength;
  }

  /**
   * 检查数据是否为有效的 FLV 数据
   * @param {Uint8Array} data - 要检查的数据
   * @returns {boolean} - 如果是有效的 FLV 数据则返回 true，否则返回 false
   */
  probe(data) {
    // FLV 文件头部的前四个字节是 "FLV\x01"，如果不是则返回 false
    const uint8Data = new Uint8Array(data);
    return !(
      uint8Data[0] !== 0x46 ||
      uint8Data[1] !== 0x4c ||
      uint8Data[2] !== 0x56 ||
      uint8Data[3] !== 0x01
    );
  }

  /**
   * 从缓存中获取指定偏移量的字节数据
   * @param {number} offset - 要获取的字节数据的偏移量
   * @returns {number} - 指定偏移量的字节数据
   */
  getByte(offset) {
    let size = 0;
    // 遍历 buffers 数组，查找指定偏移量的字节数据
    for (let i = 0; i < this.buffers.length; ++i) {
      let buffer = this.buffers[i];
      // 如果 size+buffer.length 大于等于 offset，则说明找到了指定偏移量的字节数据
      if (size + buffer.length > offset) {
        let pos = offset - size;
        return buffer[pos];
      }

      size += buffer.length;
    }

    return 0;
  }

  /**
   * 返回一个完整的帧数据，没有数据则返回 null
   * @returns {Uint8Array|null} - 完整的帧数据或 null
   */
  popFrame() {
    if (this.size === 0) {
      return null;
    }
    if (this.buffers.length === 0) {
      console.error(
        "FlvCacher.popFront error no buffers, size:" + this.size + " not eq 0"
      );
      this.reset();
      return null;
    }
    if (this.size <= FlvCacher.TAG_HEADER_LEN + FlvCacher.PREV_TAG_SIZE_LEN) {
      return null;
    }

    let dataLen =
      (this.getByte(1) << 16) + (this.getByte(2) << 8) + this.getByte(3);
    let totalLen =
      FlvCacher.TAG_HEADER_LEN + dataLen + FlvCacher.PREV_TAG_SIZE_LEN;

    if (this.size < totalLen) {
      return null;
    }

    let ret = new Uint8Array(totalLen);
    let copiedLen = 0;
    let offset = 0;

    while (copiedLen < totalLen) {
      let toCopyLen = totalLen - copiedLen;
      if (this.buffers[0].length > toCopyLen) {
        let buffer = this.buffers[0].slice(0, toCopyLen);
        ret.set(buffer, offset);
        offset += toCopyLen;
        copiedLen += toCopyLen;
        this.buffers[0] = this.buffers[0].slice(toCopyLen);
        this.size -= toCopyLen;
        break;
      } else {
        let buffer = this.buffers.shift();
        ret.set(buffer, offset);
        offset += buffer.length;
        copiedLen += buffer.length;
        this.size -= buffer.length;
      }
    }
    return ret;
  }
}

// FLV 头部长度
FlvCacher.FLV_HEADER_LEN = 9;
// FLV 标签头部长度
FlvCacher.TAG_HEADER_LEN = 11;
// 前一个标签大小的长度
FlvCacher.PREV_TAG_SIZE_LEN = 4;
// FLV 音频类型
FlvCacher.AUDIO_TYPE = 8;
// FLV 视频类型
FlvCacher.VIDEO_TYPE = 9;
// FLV 脚本类型
FlvCacher.SCRIPT_TYPE = 18;
// FLV 脚本 AMF1 头部长度
FlvCacher.SCRIPT_AMF1_HEAD_LEN = 13;
// FLV 脚本 AMF2 头部长度
FlvCacher.SCRIPT_AMF2_HEAD_LEN = 5;
// 无依赖帧
FlvCacher.IFRAME = 1;
FlvCacher.NO_REFERENCE_FRAME = 99; // 无依赖帧
// NALU 类型
FlvCacher.NAL_VPS = 32;
FlvCacher.NAL_SPS = 33;
FlvCacher.NAL_PPS = 34;
FlvCacher.HEVC_NAL_AUD = 35;
FlvCacher.HEVC_NAL_SEI = 39;
FlvCacher.NAL_RASL_N = 8;
FlvCacher.NAL_RASL_R = 9;
FlvCacher.NALU_TYPE_SLICE = 1;
FlvCacher.NALU_TYPE_DPA = 2;
FlvCacher.NALU_TYPE_DPB = 3;
FlvCacher.NALU_TYPE_DPC = 4;
FlvCacher.NALU_TYPE_IDR = 5;
FlvCacher.NALU_TYPE_SEI = 6;
FlvCacher.NALU_TYPE_SPS = 7;
FlvCacher.NALU_TYPE_PPS = 8;
FlvCacher.NALU_TYPE_AUD = 9;
FlvCacher.NALU_TYPE_EOSEQ = 10;
FlvCacher.NALU_TYPE_EOSTREAM = 11;
FlvCacher.NALU_TYPE_FILL = 12;

export default FlvCacher;
