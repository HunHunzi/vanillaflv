/**
 * @file FlvParser.js
 * FLV 格式解析器
 * @desc FLV 格式解析器，用于解析 FLV 文件数据，支持结构化输出音视频数据。
 */

import * as FlvConstants from "../config/FlvConstants";

class FlvParser {
  constructor(onFrame) {
    this.onFrame = onFrame; // 解析到每一帧后回调处理函数
    this.buffer = null; // 缓存数据
    this.offset = 0; // 当前解析的偏移量
    this.parsedHeader = false; // 标记是否已解析 FLV Header
  }

  /**
   * 解析输入数据
   * @param {Uint8Array} data - 输入的 FLV 数据
   */
  parse(data) {
    if (this.buffer) {
      let merged = new Uint8Array(this.buffer.length + data.length);
      merged.set(this.buffer, 0);
      merged.set(data, this.buffer.length);
      this.buffer = merged;
    } else {
      this.buffer = data;
    }

    while (this.offset < this.buffer.length) {
      if (!this.parseTag()) {
        return; // 数据不足以解析完整的 Tag
      }
    }

    // 清理已解析的数据
    if (this.offset > 0) {
      this.buffer = this.buffer.slice(this.offset);
      this.offset = 0;
    }
  }

  /**
   * 解析 FLV Tag
   * @returns {boolean} - 如果成功解析返回 true，否则返回 false
   */
  parseTag() {
    if (
      this.buffer.length - this.offset <
      FlvConstants.TAG_HEADER_LEN + FlvConstants.PREV_TAG_SIZE
    ) {
      return false; // 数据不足以解析 Tag Header + PreviousTagSize
    }

    let tagType = this.buffer[this.offset]; // Tag 类型

    let dataSize =
      (this.buffer[this.offset + 1] << 16) |
      (this.buffer[this.offset + 2] << 8) |
      this.buffer[this.offset + 3]; // 数据大小

    let timestamp =
      (this.buffer[this.offset + 7] << 24) | // 时间戳扩展
      (this.buffer[this.offset + 4] << 16) |
      (this.buffer[this.offset + 5] << 8) |
      this.buffer[this.offset + 6]; // 时间戳

    let totalSize =
      FlvConstants.TAG_HEADER_LEN + dataSize + FlvConstants.PREV_TAG_SIZE;

    if (this.buffer.length - this.offset < totalSize) {
      return false; // 数据不足以解析完整 Tag
    }

    // 提取 Tag 数据
    let tagData = this.buffer.slice(
      this.offset + FlvConstants.TAG_HEADER_LEN,
      this.offset + FlvConstants.TAG_HEADER_LEN + dataSize
    );

    // 分类处理 Tag 数据
    if (tagType === FlvConstants.TAG_TYPE_VIDEO) {
      // 视频 Tag
      this.parseVideoTag(tagData, timestamp);
    } else if (tagType === FlvConstants.TAG_TYPE_AUDIO) {
      // 音频 Tag
      this.parseAudioTag(tagData, timestamp);
    } else if (tagType === FlvConstants.TAG_TYPE_SCRIPT) {
      // 脚本 Tag
      this.parseScriptTag(tagData);
    }

    this.offset += totalSize; // 更新偏移量
    return true;
  }

  /**
   * 解析视频 Tag
   * @param {Uint8Array} tagData - 视频 Tag 数据
   * @param {number} timestamp - 时间戳
   * @returns {Object} - 解析后的视频数据 包括两种frame类型, 一种是解码配置信息, 一种是NALU数据
   */
  parseVideoTag(tagData, timestamp) {
    let frameType = (tagData[0] & 0xf0) >> 4; // 帧类型
    let codecID = tagData[0] & 0x0f; // 编码 ID

    if (codecID === FlvConstants.VIDEO_CODEC_ID_AVC) {
      // 处理 H.264 视频
      let avcPacketType = tagData[1]; // AVC 数据包类型
      let compositionTime =
        ((tagData[2] << 16) | (tagData[3] << 8) | tagData[4]) >>> 0; // 组合时间戳

      if (avcPacketType === FlvConstants.AVC_PACKET_TYPE_SEQ_HEADER) {
        let config = this.parseAVCDecoderConfigurationRecord(
          tagData.subarray(5)
        );
        this.onFrame({
          type: "video",
          codec: "H.264",
          timestamp: timestamp,
          isConfig: true,
          config: config,
        });
      } else if (avcPacketType === FlvConstants.AVC_PACKET_TYPE_NALU) {
        let nalus = this.extractNALUs(tagData.subarray(5));
        let dataLength = 0;
        let units = [];

        for (let nalu of nalus) {
          dataLength += nalu.data.byteLength;
          units.push({ data: nalu.data });
        }

        let track = {
          len: dataLength,
          naluCnt: nalus.length,
          isAV01: false,
          samples: [{
            units: units,
            pts: (timestamp + compositionTime) * 90, // ms → 90kHz ticks
            dts: timestamp * 90,
            key: frameType === FlvConstants.VIDEO_FRAME_KEYFRAME,
          }],
        };

        this.onFrame({
          type: "video",
          codec: "H.264",
          track: track,
        });
      }
    } else if (codecID === FlvConstants.VIDEO_CODEC_ID_H263) {
      console.log("H.263 video tag");
      // 处理 H.263 视频
      let frameData = tagData.subarray(1); // 跳过第一个字节（包含帧类型和编码 ID）

      // H.263 视频帧通常直接包含已编码的视频数据
      let keyFrame = frameType === FlvConstants.VIDEO_FRAME_KEYFRAME; // 判断是否为关键帧

      let track = {
        len: frameData.byteLength, // 视频数据长度
        naluCnt: 1, // H.263 通常只有一个连续的数据块
        isAV01: false,
        samples: [
          {
            unit: frameData, // 视频帧数据
            pts: timestamp, // 显示时间戳
            dts: timestamp, // 解码时间戳
            key: keyFrame, // 是否关键帧
          },
        ],
      };

      this.onFrame({
        type: "video",
        codec: "H.263",
        track: track, // 返回符合 track 结构的数据
      });
    } else {
      console.warn("Unsupported codec ID:", codecID);
    }
  }

  /**
   * 解析音频 Tag
   * @param {Uint8Array} tagData - 音频 Tag 数据
   * @param {number} timestamp - 时间戳
   */
  parseAudioTag(tagData, timestamp) {
    let soundFormat = (tagData[0] & 0xf0) >> 4; // 音频格式

    // 如果是 AAC 音频
    if (soundFormat === FlvConstants.AUDIO_CODEC_AAC) {
      let aacPacketType = tagData[1]; // AAC 包类型

      if (aacPacketType === FlvConstants.AAC_PACKET_TYPE_SEQ_HEADER) {
        // 解析 AAC Audio Specific Config
        let config = this.parseAACAudioSpecificConfig(tagData.subarray(2));
        this.onFrame({
          type: "audio",
          codec: "AAC",
          timestamp: timestamp,
          isConfig: true,
          config: config,
        });
      } else if (aacPacketType === FlvConstants.AAC_PACKET_TYPE_RAW) {
        // 提取 AAC 音频数据
        let audioData = tagData.subarray(2);

        // 构造符合 track 的结构
        let samples = [
          {
            unit: audioData,
            pts: timestamp * 90, // ms → 90kHz ticks，与视频保持相同单位
            dts: timestamp * 90,
            key: true, // 音频帧通常视为关键帧
          },
        ];

        let track = {
          len: audioData.byteLength, // 音频数据长度
          naluCnt: 1, // 对音频来说，通常为 1
          isAV01: false, // 标识是否为 AV1，这里为 AAC，因此为 false
          samples: samples, // 样本数据
        };

        this.onFrame({
          type: "audio",
          codec: "AAC",
          track: track, // 返回符合 track 结构的数据
        });
      }
    } else if (soundFormat === FlvConstants.AUDIO_CODEC_MP3) {
      console.log("MP3 audio tag");

      // 提取 MP3 音频数据
      let audioData = tagData.subarray(1); // 提取音频数据

      // 构造符合 track 的结构
      let samples = [
        {
          unit: audioData,
          pts: timestamp * 90, // ms → 90kHz ticks
          dts: timestamp * 90,
          key: true, // 音频帧通常视为关键帧
        },
      ];

      let track = {
        len: audioData.byteLength, // 音频数据长度
        naluCnt: 1, // 对音频来说，通常为 1
        isAV01: false, // 标识是否为 AV1，这里为 MP3，因此为 false
        samples: samples, // 样本数据
      };

      this.onFrame({
        type: "audio",
        codec: "MP3",
        track: track, // 返回符合 track 结构的数据
      });
    }
  }

  /**
   * 解析脚本 Tag
   * @param {Uint8Array} tagData - 脚本 Tag 数据
   * @returns {Object} - 解析后的脚本数据
   */

  parseScriptTag(tagData) {
    let offset = 0;
    let scriptData = {};

    // AMF Object
    let amfObject = this.parseAMFObject(tagData, offset);
    scriptData[amfObject.key] = amfObject.value;

    // PreviousTagSize
    offset += FlvConstants.PREV_TAG_SIZE;
    return scriptData;
  }

  // 解析 AMF Object
  parseAMFObject(data, offset) {
    let key = this.parseAMFString(data, offset);
    let value = this.parseAMFData(data, offset + key.length);
    return { key, value };
  }

  parseAMFString(data, offset) {
    let length = (data[offset] << 8) | data[offset + 1];
    let value = String.fromCharCode.apply(
      null,
      data.subarray(offset + 2, offset + 2 + length)
    );
    return { length: length + 2, value };
  }

  parseAMFData(data, offset) {
    let type = data[offset];
    let value;
    switch (type) {
      case FlvConstants.AMF_DATA_TYPE_NUMBER:
        value = this.parseAMFNumber(data, offset);
        break;
      case FlvConstants.AMF_DATA_TYPE_BOOLEAN:
        value = this.parseAMFBoolean(data, offset);
        break;
      case FlvConstants.AMF_DATA_TYPE_STRING:
        value = this.parseAMFString(data, offset + 1).value;
        break;
      case FlvConstants.AMF_DATA_TYPE_OBJECT:
        value = this.parseAMFObject(data, offset + 1);
        break;
      default:
        value = null;
    }
    return value;
  }

  parseAMFNumber(data, offset) {
    let value = new DataView(data.buffer).getFloat64(offset + 1);
    return value;
  }

  /**
   * 解析 AVC Decoder Configuration Record
   * @param {Uint8Array} data - AVC 配置信息
   */
  parseAVCDecoderConfigurationRecord(data) {
    let offset = 5; // 从第 5 字节开始解析

    // NumOfSPS (低 5 位表示数量)
    let numOfSPS = data[offset++] & 0x1f;

    let spsList = [];
    for (let i = 0; i < numOfSPS; i++) {
      // SPS Length
      let spsLength = (data[offset] << 8) | data[offset + 1];
      offset += 2;

      // SPS Data
      let sps = data.subarray(offset, offset + spsLength);
      spsList.push(sps);
      offset += spsLength;
    }

    // NumOfPPS
    let numOfPPS = data[offset++];

    let ppsList = [];
    for (let i = 0; i < numOfPPS; i++) {
      // PPS Length
      let ppsLength = (data[offset] << 8) | data[offset + 1];
      offset += 2;

      // PPS Data
      let pps = data.subarray(offset, offset + ppsLength);
      ppsList.push(pps);
      offset += ppsLength;
    }

    return { spsList, ppsList };
  }

  /**
   * 提取 H.264 NALU
   * @param {Uint8Array} data - H.264 数据
   * @returns {Uint8Array[]} - NALU 数组
   */
  extractNALUs(buffer) {
    let offset = 0;
    let nalus = [];

    while (offset < buffer.length) {
      // 读取 NALU 长度（4 字节大端字节序）
      let naluLength =
        (buffer[offset] << 24) |
        (buffer[offset + 1] << 16) |
        (buffer[offset + 2] << 8) |
        buffer[offset + 3];
      offset += 4;

      // 提取 NALU 数据
      let naluData = buffer.subarray(offset, offset + naluLength);
      offset += naluLength;

      // 解析 NALU Header
      let naluHeader = naluData[0];
      let forbiddenZeroBit = (naluHeader & 0x80) >> 7; // 用于语法约束，确保传输通道的兼容性。
      let nalRefIdc = (naluHeader & 0x60) >> 5; // NALU 参考级别
      let nalUnitType = naluHeader & 0x1f; // 表示 NALU 的类型（关键帧、非关键帧等）

      // 检查 forbidden_zero_bit
      if (forbiddenZeroBit !== 0) {
        console.error("Invalid NALU: forbidden_zero_bit is not zero");
        continue;
      }

      // 将 NALU 数据存储到结果中
      nalus.push({
        type: nalUnitType,
        refIdc: nalRefIdc,
        isKeyFrame: nalUnitType === FlvConstants.NALU_TYPE_IDR,
        data: naluData,
      });
    }

    return nalus;
  }

  /**
   * 解析 AAC Audio Specific Config
   * @param {Uint8Array} data - AAC 配置信息
   */
  parseAACAudioSpecificConfig(data) {
    let audioObjectType = (data[0] >> 3) & 0x1f;
    let samplingFrequencyIndex =
      ((data[0] & 0x07) << 1) | ((data[1] >> 7) & 0x01);
    let channelConfiguration = (data[1] >> 3) & 0x0f;

    return {
      audioObjectType,
      samplingFrequencyIndex,
      channelConfiguration,
      config: Array.from(data.subarray(0, 2)),
    };
  }

  destroy() {
    this.buffer = null;
    this.offset = 0;
  }

  /**
   * 解析 MP3 Audio Specific Config
   *  MP3 音频数据解析
   * @param {Uint8Array} data - MP3 配置信息
   */
  parseMp3AudioSpecificConfig(data) {
    let audioObjectType = (data[0] >> 3) & 0x1f;
    let samplingFrequencyIndex =
      ((data[0] & 0x07) << 1) | ((data[1] >> 7) & 0x01);
    let channelConfiguration = (data[1] >> 3) & 0x0f;

    return {
      audioObjectType,
      samplingFrequencyIndex,
      channelConfiguration,
    };
  }

}

export default FlvParser;
