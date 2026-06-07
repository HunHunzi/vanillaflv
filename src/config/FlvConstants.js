/**
 * @file FlvConstants.js
 * @desc FLV 文件格式常量
 */

// 所有长度均为字节
// FLV 头部长度
export const FLV_HEADER_LEN = 9;
// FLV 标签头部长度
export const TAG_HEADER_LEN = 11;
// 前一个标签大小的长度
export const PREV_TAG_SIZE = 4;
// FLV 文件标识
export const FLV_SIGNATURE = 0x464c5601;
// FLV 版本
export const FLV_VERSION = 1;
// 视频标签
export const TAG_TYPE_VIDEO = 9;
// 音频标签
export const TAG_TYPE_AUDIO = 8;
// 脚本标签
export const TAG_TYPE_SCRIPT = 18;
// 视频编码格式
//  FLV 脚本 AMF1 头部长度
export const SCRIPT_AMF1_HEAD_LEN = 13;
// FLV 脚本 AMF2 头部长度
export const SCRIPT_AMF2_HEAD_LEN = 5;
// 无依赖帧
export const IFRAME = 1;
export const NO_REFERENCE_FRAME = 99; // 无依赖帧
// NALU 头部长度
export const NALU_HEADER_LEN = 4;
// NALU 类型
export const NAL_VPS = 32;
export const NAL_SPS = 33;
export const NAL_PPS = 34;
export const HEVC_NAL_AUD = 35;
export const HEVC_NAL_SEI = 39;
export const NAL_RASL_N = 8;
export const NAL_RASL_R = 9;
export const NALU_TYPE_SLICE = 1;
export const NALU_TYPE_DPA = 2;
export const NALU_TYPE_DPB = 3;
export const NALU_TYPE_DPC = 4;
export const NALU_TYPE_IDR = 5;
export const NALU_TYPE_SEI = 6;
export const NALU_TYPE_SPS = 7;
export const NALU_TYPE_PPS = 8;
export const NALU_TYPE_AUD = 9;
export const NALU_TYPE_EOSEQ = 10;
export const NALU_TYPE_EOSTREAM = 11;
export const NALU_TYPE_FILL = 12;
// 音频编码格式
export const AUDIO_CODEC_AAC = 10; // AAC
export const AUDIO_CODEC_MP3 = 2; // MP3
export const AAC_PACKET_TYPE_SEQ_HEADER = 0; // AAC 序列头
export const AAC_PACKET_TYPE_RAW = 1; // AAC 原始数据
export const MP3_PACKET_TYPE = 0; // MP3 数据

// 音频采样率
export const AUDIO_SAMPLE_RATE_5_5K = 0;
export const AUDIO_SAMPLE_RATE_11K = 1;
export const AUDIO_SAMPLE_RATE_22K = 2;
export const AUDIO_SAMPLE_RATE_44K = 3;
// 音频采样位数
export const AUDIO_SAMPLE_SIZE_8BIT = 0;
export const AUDIO_SAMPLE_SIZE_16BIT = 1;
// 音频声道数
export const AUDIO_CHANNEL_MONO = 0;
export const AUDIO_CHANNEL_STEREO = 1;
// 视频编码格式
export const VIDEO_CODEC_ID_H263 = 2; // H263
export const VIDEO_CODEC_ID_AVC = 7; // AVC H.264
export const VIDEO_CODEC_ID_HEVC = 12; // HEVC H.265
// 视频帧类型
export const FRAME_TYPE_KEY_FRAME = 1; // 关键帧
export const FRAME_TYPE_INTER_FRAME = 2; // 非关键帧
export const FRAME_TYPE_DISPOSABLE_INTER_FRAME = 3; // 可丢弃的非关键帧
export const FRAME_TYPE_GENERATED_KEY_FRAME = 4; // 生成的关键帧
export const FRAME_TYPE_COMMAND_FRAME = 5; // 命令帧
// AVC 视频包类型
export const AVC_PACKET_TYPE_SEQ_HEADER = 0; // 序列头
export const AVC_PACKET_TYPE_NALU = 1; // NALU
export const AVC_PACKET_TYPE_EOS = 2; // 结束
// HEVC 视频包类型
export const HEVC_PACKET_TYPE_NALU = 1; // NALU
export const HEVC_PACKET_TYPE_EOS = 2; // 结束

export const VIDEO_FRAME_KEYFRAME = 1; // 关键帧

//AMF数据类型
export const AMF_DATA_TYPE_NUMBER = 0;
export const AMF_DATA_TYPE_BOOLEAN = 1;
export const AMF_DATA_TYPE_STRING = 2;
export const AMF_DATA_TYPE_OBJECT = 3;
export const AMF_DATA_TYPE_NULL = 5;
export const AMF_DATA_TYPE_UNDEFINED = 6;
export const AMF_DATA_TYPE_REFERENCE = 7;
export const AMF_DATA_TYPE_MIXEDARRAY = 8;
