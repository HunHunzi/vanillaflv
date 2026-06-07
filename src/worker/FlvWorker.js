import FlvCacher from '../demux/FlvCacher';
import FlvParser from '../demux/FlvParser';
import FMp4Remux from '../remux/FMp4Remux';
import { parseSpsWidthHeight } from '../utils/SpsParser';

// AAC 规范里的采样率查找表
const SAMPLE_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
const FRAGMENT_DURATION = 500; // ms每个 fmp4 分片的最小时长  500ms + 遇到关键帧才触发一次 remux

// ─── 状态（等价于主线程 FlvPlayer 里的实例变量） ────────────────────────────
let audioConfig = null;
let videoConfig = null;
let audioTrack = null;
let videoTrack = null;
let timeOffset = null;
let lastAudioPTS = undefined;
let lastVideoPTS = undefined;
let lastAudioDuration = 0;
let lastVideoDuration = 0;

// ─── Mock MSE：拦截 remuxer 输出，postMessage 回主线程 ──────────────────────
const mockMse = {
  onInitSegment(data) {
    // init segment 很小，直接结构化克隆（无需 transfer）
    self.postMessage({ type: 'initSegment', data });
  },
  onFragParsing(fragData) {
    const src = fragData.data; // Uint8Array，来自 _mergeBoxes，byteOffset 始终为 0
    const buf = src.buffer.slice(src.byteOffset, src.byteOffset + src.byteLength);
    // Transfer：零拷贝把 ArrayBuffer 所有权转给主线程
    self.postMessage({ type: 'fragment', trackType: fragData.type, buffer: buf }, [buf]);
  },
  onFragParsed() {},// 预留接口
};

// ─── Remuxer ────────────────────────────────────────────────────────────────
const mp4Remux = new FMp4Remux();
mp4Remux.mse = mockMse;

// ─── 解析帧回调（对应主线程 FlvPlayer.onFrame） ──────────────────────────────
function onFrame(frame) {
  if (frame.type === 'audio') {
    if (frame.isConfig) { audioConfig = frame.config; return; }
    if (!audioConfig) return;

    if (!audioTrack) {
      const cfg = audioConfig;
      audioTrack = {
        id: 2, type: 'audio', len: 0, naluCnt: 0, isAV01: false,
        samples: [], config: cfg.config || [], codec: 'mp4a.40.2',
        channelCount: cfg.channelConfiguration || 2,
        audiosamplerate: SAMPLE_RATES[cfg.samplingFrequencyIndex] || 44100,
        timescale: 90000, duration: 0, sn: 0,
      };
    }
    // 需要追加，积累到足够再一次性 remux
    if (frame.track) {
      audioTrack.len += frame.track.len;
      audioTrack.naluCnt += frame.track.naluCnt;
      audioTrack.samples.push(...frame.track.samples);
    }
  }

  if (frame.type === 'video') {
    if (frame.isConfig) { videoConfig = frame.config; return; }
    if (!videoConfig) return;

    if (!videoTrack) {
      const cfg = videoConfig;
      const spsList = cfg.spsList || [];
      const ppsList = cfg.ppsList || [];
      let codec = 'avc1.42E01E';
      if (spsList.length > 0 && spsList[0].length >= 4) {
        const sps = spsList[0];
        const toHex = (n) => n.toString(16).padStart(2, '0').toUpperCase();
        codec = `avc1.${toHex(sps[1])}${toHex(sps[2])}${toHex(sps[3])}`;
      }
      let width = 0, height = 0;
      if (spsList.length > 0) {
        const parsed = parseSpsWidthHeight(spsList[0]);
        if (parsed) ({ width, height } = parsed);
      }
      videoTrack = {
        id: 1, type: 'video', len: 0, naluCnt: 0, isAV01: false,
        samples: [], sps: spsList, pps: ppsList, codec,
        width, height, timescale: 90000, duration: 0, sn: 0,
      };
    }
    if (frame.track) {
      videoTrack.len += frame.track.len;
      videoTrack.naluCnt += frame.track.naluCnt;
      videoTrack.samples.push(...frame.track.samples);
    }
  }

  tryRemux();
}

// ─── 连续性检测 ──────────────────────────────────────────────────────────────
function checkContiguous() {
  if (lastAudioPTS === undefined || lastVideoPTS === undefined) return false;
  const tolerance = 9000; // 100ms in 90kHz units允许的时钟漂移值
  let audioOK = true, videoOK = true;
  if (audioTrack?.samples.length) {
    audioOK = Math.abs(audioTrack.samples[0].pts - (lastAudioPTS + lastAudioDuration)) < tolerance;
  }
  if (videoTrack?.samples.length) {
    videoOK = Math.abs(videoTrack.samples[0].pts - (lastVideoPTS + lastVideoDuration)) < tolerance;
  }
  return audioOK && videoOK;
}

// ─── 触发 remux（对应主线程 FlvPlayer.tryRemux） ─────────────────────────────
function tryRemux() {
  if (!audioTrack || !videoTrack) return;
  // 音视频都必须有数据才能 remux
  if (!audioTrack.samples.length || !videoTrack.samples.length) return;

  const videoSamples = videoTrack.samples;
  const firstVideo = videoSamples[0];
  const lastVideo = videoSamples[videoSamples.length - 1];
  const duration = (lastVideo.dts - firstVideo.dts) / 90; // 90kHz → ms

  const hasKeyframe = lastVideo.key === true || lastVideo.isKeyframe === true;
  // 视频段末尾是关键帧+累积时长 ≥ 500ms
  if (!hasKeyframe || duration < FRAGMENT_DURATION) return;

  if (timeOffset == null) {
    const firstAudioPTS = audioTrack?.samples?.[0]?.pts ?? Infinity;
    const firstVideoPTS = videoTrack?.samples?.[0]?.pts ?? Infinity;
    timeOffset = Math.min(firstAudioPTS, firstVideoPTS) / 90000;
  }

  // timeOffset 只在第一次 remux 时确定，取音视频中最早的 PTS 转成秒数。后续所有分片共用同一个基准，确保 SourceBuffer 时间轴一致。
  const contiguous = checkContiguous();
  mp4Remux.remux(audioTrack, videoTrack, timeOffset, contiguous);

  // 记录最后一帧 PTS，用于下一轮 contiguous 检测
  if (audioTrack.samples.length) {
    const last = audioTrack.samples[audioTrack.samples.length - 1];
    lastAudioPTS = last.pts;
    lastAudioDuration = last.duration || 0;
  }
  if (videoTrack.samples.length) {
    const last = videoTrack.samples[videoTrack.samples.length - 1];
    lastVideoPTS = last.pts;
    lastVideoDuration = last.duration || 0;
  }

  // FMp4Remux 内部已清空 samples/len/naluCnt，这里补充重置保险
  audioTrack.samples = []; audioTrack.len = 0; audioTrack.naluCnt = 0;
  videoTrack.samples = []; videoTrack.len = 0; videoTrack.naluCnt = 0;
}

// ─── Parser + Cacher ─────────────────────────────────────────────────────────
const flvCacher = new FlvCacher();
const flvParser = new FlvParser(onFrame);

// ─── 消息入口 ────────────────────────────────────────────────────────────────
self.onmessage = (e) => {
  const { type } = e.data;

  if (type === 'data') {
    // e.data.buffer 是 Transferable，已从主线程转移所有权，无内存拷贝
    flvCacher.parseFlv(new Uint8Array(e.data.buffer));
    let frame;
    while ((frame = flvCacher.popFrame()) !== null) {
      flvParser.parse(frame);
    }
  } else if (type === 'destroy') {
    flvCacher.destroy();
    flvParser.destroy();
    mp4Remux.destroy();
  }
};
