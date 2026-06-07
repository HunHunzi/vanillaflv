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

// 中途接入保护：等到第一个 IDR 帧才开始送数据给 MSE
let waitingForKeyframe = true;

// 打点计数器，避免每帧都刷日志
let videoFrameCount = 0;
let audioFrameCount = 0;
let droppedVideoCount = 0;

// ─── Mock MSE：拦截 remuxer 输出，postMessage 回主线程 ──────────────────────
const mockMse = {
  onInitSegment(data) {
    console.log('[W] ✅ initSegment 发往主线程', JSON.stringify({
      hasAudioMoov: !!data.audioMoov,
      hasVideoMoov: !!data.videoMoov,
      audioCodec: data.audioCodec,
      videoCodec: data.videoCodec,
    }));
    self.postMessage({ type: 'initSegment', data });
  },
  onFragParsing(fragData) {
    const src = fragData.data;
    const buf = src.buffer.slice(src.byteOffset, src.byteOffset + src.byteLength);
    console.log(`[W] 📦 fragment 发往主线程 type=${fragData.type} size=${buf.byteLength}`);
    self.postMessage({ type: 'fragment', trackType: fragData.type, buffer: buf }, [buf]);
  },
  onFragParsed() {},
};

// ─── Remuxer ────────────────────────────────────────────────────────────────
const mp4Remux = new FMp4Remux();
mp4Remux.mse = mockMse;

// ─── 解析帧回调 ──────────────────────────────────────────────────────────────
function onFrame(frame) {
  if (frame.type === 'audio') {
    if (frame.isConfig) {
      audioConfig = frame.config;
      console.log('[W] 🎵 收到 AudioConfig:', {
        sampleRate: SAMPLE_RATES[frame.config.samplingFrequencyIndex] || '未知',
        channels: frame.config.channelConfiguration,
      });
      return;
    }
    if (!audioConfig) {
      // 每 50 帧提示一次，避免刷屏
      if (audioFrameCount++ % 50 === 0) console.warn('[W] ⚠️ 收到音频帧但 audioConfig 为空，已丢弃');
      return;
    }
    if (waitingForKeyframe) return; // 等待首个 IDR，音频同步丢弃

    if (!audioTrack) {
      const cfg = audioConfig;
      audioTrack = {
        id: 2, type: 'audio', len: 0, naluCnt: 0, isAV01: false,
        samples: [], config: cfg.config || [], codec: 'mp4a.40.2',
        channelCount: cfg.channelConfiguration || 2,
        audiosamplerate: SAMPLE_RATES[cfg.samplingFrequencyIndex] || 44100,
        timescale: 90000, duration: 0, sn: 0,
      };
      console.log('[W] 🎵 audioTrack 初始化完成');
    }
    if (frame.track) {
      audioTrack.len += frame.track.len;
      audioTrack.naluCnt += frame.track.naluCnt;
      audioTrack.samples.push(...frame.track.samples);
    }
  }

  if (frame.type === 'video') {
    if (frame.isConfig) {
      videoConfig = frame.config;
      console.log('[W] 🎬 收到 VideoConfig (SPS/PPS):', {
        spsCount: frame.config.spsList?.length,
        ppsCount: frame.config.ppsList?.length,
      });
      return;
    }
    if (!videoConfig) {
      if (videoFrameCount++ % 50 === 0) console.warn('[W] ⚠️ 收到视频帧但 videoConfig 为空（SPS/PPS 未到），已丢弃');
      return;
    }

    // 等待第一个 IDR
    if (waitingForKeyframe) {
      const isKeyframe = frame.track?.samples?.[0]?.key === true;
      droppedVideoCount++;
      if (droppedVideoCount % 10 === 1) {
        console.log(`[W] ⏳ 等待首个 IDR，已丢弃 ${droppedVideoCount} 帧，当前帧 isKeyframe=${isKeyframe}`);
      }
      if (!isKeyframe) return;
      waitingForKeyframe = false;
      console.log(`[W] ✅ 找到首个 IDR（共丢弃 ${droppedVideoCount - 1} 帧），MSE 管线启动`);
    }

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
      console.log('[W] 🎬 videoTrack 初始化完成:', { codec, width, height });
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
  const tolerance = 9000;
  let audioOK = true, videoOK = true;
  if (audioTrack?.samples.length) {
    audioOK = Math.abs(audioTrack.samples[0].pts - (lastAudioPTS + lastAudioDuration)) < tolerance;
  }
  if (videoTrack?.samples.length) {
    videoOK = Math.abs(videoTrack.samples[0].pts - (lastVideoPTS + lastVideoDuration)) < tolerance;
  }
  return audioOK && videoOK;
}

// ─── 触发 remux ──────────────────────────────────────────────────────────────
function tryRemux() {
  if (!audioTrack || !videoTrack) {
    // 只在刚刚解锁 IDR 后的前几次调用时打，避免前期刷屏
    if (!waitingForKeyframe && (videoTrack || audioTrack)) {
      console.log(`[W] tryRemux 跳过: audioTrack=${!!audioTrack} videoTrack=${!!videoTrack}`);
    }
    return;
  }
  if (!audioTrack.samples.length || !videoTrack.samples.length) {
    console.log(`[W] tryRemux 跳过: audio样本=${audioTrack.samples.length} video样本=${videoTrack.samples.length}`);
    return;
  }

  const videoSamples = videoTrack.samples;
  const firstVideo = videoSamples[0];
  const lastVideo = videoSamples[videoSamples.length - 1];
  const duration = (lastVideo.dts - firstVideo.dts) / 90;
  const hasKeyframe = lastVideo.key === true || lastVideo.isKeyframe === true;

  console.log(`[W] tryRemux 检查: 视频样本=${videoSamples.length} 音频样本=${audioTrack.samples.length} duration=${duration.toFixed(0)}ms lastVideoIsKey=${hasKeyframe}`);

  if (!hasKeyframe || duration < FRAGMENT_DURATION) {
    console.log(`[W] tryRemux 未达标: hasKeyframe=${hasKeyframe} duration=${duration.toFixed(0)}ms < ${FRAGMENT_DURATION}ms`);
    return;
  }

  if (timeOffset == null) {
    const firstAudioPTS = audioTrack?.samples?.[0]?.pts ?? Infinity;
    const firstVideoPTS = videoTrack?.samples?.[0]?.pts ?? Infinity;
    timeOffset = Math.min(firstAudioPTS, firstVideoPTS) / 90000;
    console.log(`[W] timeOffset 确定: ${timeOffset.toFixed(3)}s`);
  }

  const contiguous = checkContiguous();
  console.log(`[W] 🚀 触发 remux contiguous=${contiguous}`);
  mp4Remux.remux(audioTrack, videoTrack, timeOffset, contiguous);

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
    const bytes = new Uint8Array(e.data.buffer);
    console.log(`[W] 收到数据块 ${bytes.byteLength} 字节`);
    flvCacher.parseFlv(bytes);
    let frame;
    while ((frame = flvCacher.popFrame()) !== null) {
      flvParser.parse(frame);
    }
  } else if (type === 'destroy') {
    console.log('[W] destroy');
    flvCacher.destroy();
    flvParser.destroy();
    mp4Remux.destroy();
  }
};
