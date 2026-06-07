import Config from "../config/Config";
import MP4 from "./mp4-generator";

class MP4Remuxer {
  constructor() {
    this.initSegments = null; // 初始化段，用于MP4容器
    this.PES2MP4SCALEFACTOR = 1; // PES 到 MP4 的时间基本单位转换因子
    this.PES_TIMESCALE = 90000; // PES 的时间基本单位
    this.MP4_TIMESCALE = this.PES_TIMESCALE / this.PES2MP4SCALEFACTOR; // MP4 的时间基本单位
    this.audioISGenerated = false; // 是否生成音频初始化段
    this.videoISGenerated = false; // 是否生成视频初始化段
    // 初始化MP4
    MP4.init();
    this.mse = null;
  }

  /**
   * 重混
   * @param {*} audioTrack 音频轨道
   * @param {*} videoTrack 视频轨道
   * @param {*} timeOffset 时间偏移
   * @param {*} contiguous 是否连续
   */

  remux(audioTrack, videoTrack, timeOffset, contiguous) {
    // 如果音频轨道和视频轨道都没有数据
    if (!this.audioISGenerated) {
      // 生成音频初始化段
      this.generateAudioIS(audioTrack, timeOffset);
    }

    if (!this.videoISGenerated) {
      this.generateVideoIS(videoTrack, timeOffset);
    }
    // 如果音频轨道和视频轨道都有数据，生成分片数据
    this.initTs(audioTrack, videoTrack, timeOffset);

    //logger.log('nb AVC samples:' + videoTrack.samples.length);
    if (videoTrack.samples.length) {
      // 处理视频帧数据
      this.remuxVideo(videoTrack, contiguous);
    }
    //logger.log('nb AAC samples:' + audioTrack.samples.length);
    if (audioTrack.samples.length) {
      this.remuxAudio(audioTrack, contiguous);
    }

    this.mse.onFragParsed(); // 触发解析完成事件
  }

  /**
   * 生成音频初始化段
   * @param {*} audioTrack 音频轨道
   * @param {*} timeOffset 时间偏移
   * @returns
   */

  generateAudioIS(audioTrack, timeOffset) {
    console.log("mp4-remuxer.generateAudioIS audioTrack", audioTrack);
    if (audioTrack.config) {
      let data = {
        audioMoov: MP4.initSegment([audioTrack]),
        audioCodec: audioTrack.codec,
        audioChannelCount: audioTrack.channelCount,
      };
      this.mse.onInitSegment(data);
      this.audioISGenerated = true;
    }
  }

  /**
   * 生成视频初始化段
   * @param {*} videoTrack 视频轨道
   * @param {*} timeOffset 时间偏移
   * @returns
   */
  generateVideoIS(videoTrack, timeOffset) {
    const hasSps = videoTrack.sps && videoTrack.sps.length > 0;
    const hasPps = videoTrack.pps && videoTrack.pps.length > 0;
    if (videoTrack.isAV01 || (hasSps && hasPps)) {
      let data = {
        videoMoov: MP4.initSegment([videoTrack]),
        videoCodec: videoTrack.codec,
        videoWidth: videoTrack.width,
        videoHeight: videoTrack.height,
      };
      this.mse.onInitSegment(data);
      this.videoISGenerated = true;
    }
  }

  /**
   * 生成音频初始化段
   * @param {*} audioTrack 音频轨道
   * @param {*} timeOffset 时间偏移
   * @returns
   */
  initTs(audioTrack, videoTrack, timeOffset) {
    let audioSamples = audioTrack.samples,
      videoSamples = videoTrack.samples,
      pesTimeScale = this.PES_TIMESCALE;

    // 音频和视频各自独立归一化到 timeOffset，避免因流内 A/V 启动时间不同
    // 导致两个 SourceBuffer 的数据时间段不重叠而卡住
    if (this._audioInitDTS === undefined && audioSamples.length > 0) {
      this._audioInitDTS = audioSamples[0].dts - pesTimeScale * timeOffset;
    }
    if (this._videoInitDTS === undefined && videoSamples.length > 0) {
      this._videoInitDTS = videoSamples[0].dts - pesTimeScale * timeOffset;
    }
  }

  /**
   * 处理 视频帧数据，生成 MP4 文件中的关键数据块 mdat 和 moof
   * @param {*} track 视频轨道
   * @param {*} contiguous  是否连续
   */

  /**
   * 处理 视频帧数据，生成 MP4 文件中的关键数据块 mdat 和 moof
   * @param {*} track 视频轨道
   * @param {*} contiguous  是否连续
   */
  remuxVideo(track, contiguous) {
    let view,
      i = 8,
      byteLength,
      pes2mp4ScaleFactor = this.PES2MP4SCALEFACTOR,
      avcSample,
      mp4Sample,
      mp4SampleLength,
      unit,
      mdat,
      moof,
      firstPTS,
      firstDTS,
      lastDTS,
      pts,
      dts,
      ptsnorm,
      dtsnorm,
      samples = [];
    let isAV1 = track.isAV01;
    let naluCntByteLength = isAV1 ? 0 : 4 * track.naluCnt;
    mdat = new Uint8Array(track.len + naluCntByteLength + 8);
    view = new DataView(mdat.buffer);
    view.setUint32(0, mdat.byteLength);
    mdat.set(MP4.types.mdat, 4);

    // 处理所有视频 sample，合并进同一个 moof+mdat
    while (track.samples.length) {
      avcSample = track.samples.shift();
      mp4SampleLength = 0;

      while (avcSample.units.length) {
        unit = avcSample.units.shift();
        byteLength = unit.data.byteLength;
        if (!isAV1) {
          view.setUint32(i, byteLength);
          i += 4;
          mp4SampleLength += 4;
        }
        mdat.set(unit.data, i);
        i += byteLength;
        mp4SampleLength += byteLength;
      }

      pts = avcSample.pts - this._videoInitDTS;
      dts = avcSample.dts - this._videoInitDTS;

      if (lastDTS !== undefined) {
        ptsnorm = this._PTSNormalize(pts, lastDTS);
        dtsnorm = this._PTSNormalize(dts, lastDTS);
        mp4Sample.duration = (dtsnorm - lastDTS) / pes2mp4ScaleFactor;
        if (mp4Sample.duration < 0) {
          mp4Sample.duration = 0;
          dtsnorm = lastDTS;
        }
      } else {
        let nextAvcDts = this.nextAvcDts || dts;
        ptsnorm = this._PTSNormalize(pts, nextAvcDts);
        dtsnorm = this._PTSNormalize(dts, nextAvcDts);
        let delta = Math.round((dtsnorm - nextAvcDts) / 90);
        if (contiguous || Math.abs(delta) < 600) {
          if (delta) {
            dtsnorm = nextAvcDts;
            ptsnorm = Math.max(ptsnorm - delta, dtsnorm);
          }
        }
        firstPTS = Math.max(0, ptsnorm);
        firstDTS = Math.max(0, dtsnorm);
      }

      let isKeyframe = avcSample.key;
      mp4Sample = {
        size: mp4SampleLength,
        duration: 0,
        cts: (ptsnorm - dtsnorm) / pes2mp4ScaleFactor,
        flags: {
          isLeading: 0,
          degradPrio: 0,
          hasRedundancy: 0,
          dependsOn: isKeyframe ? 2 : 1,
          isDependedOn: isKeyframe ? 1 : 0,
          isNonSync: isKeyframe ? 0 : 1,
        },
      };
      samples.push(mp4Sample);
      lastDTS = dtsnorm;
    }

    if (samples.length === 0) return;

    // 最后一帧 duration 同倒数第二帧
    if (samples.length >= 2) {
      samples[samples.length - 1].duration = samples[samples.length - 2].duration;
    } else {
      samples[0].duration = 90;
    }
    this.nextAvcDts = lastDTS + samples[samples.length - 1].duration * pes2mp4ScaleFactor;

    track.len = 0;
    track.naluCnt = 0;
    track.sn = (track.sn || 0) + 1;
    track.samples = samples;
    moof = MP4.moof(track.sn, firstDTS / pes2mp4ScaleFactor, track);
    track.samples = [];

    let data = { type: "video", data: this._mergeBoxes(moof, mdat) };
    
    // ====================== 🔥 打印视频 REMUX 后时间 🔥 ======================
    const videoPtsSec = (firstPTS / 90000).toFixed(3);
    const videoDtsSec = (firstDTS / 90000).toFixed(3);
    console.log(`[REMUX-VIDEO] 分片时间：PTS=${videoPtsSec}s | DTS=${videoDtsSec}s | 帧数=${samples.length}`);

    this.mse.onFragParsing(data);
  }

  remuxAudio(track, contiguous) {
    let view,
      i = 8,
      pesTimeScale = this.PES_TIMESCALE,
      pes2mp4ScaleFactor = this.PES2MP4SCALEFACTOR,
      aacSample,
      mp4Sample,
      unit,
      mdat,
      moof,
      firstPTS,
      firstDTS,
      lastDTS,
      pts,
      dts,
      ptsnorm,
      dtsnorm,
      samples = [];
    /* concatenate the audio data and construct the mdat in place
        (need 8 more bytes to fill length and mdat type) */
    mdat = new Uint8Array(track.len + 8); // 添加 8 字节的 mdat 头
    view = new DataView(mdat.buffer); // 创建一个新的 DataView 对象
    view.setUint32(0, mdat.byteLength); // 设置 mdat 大小

    mdat.set(MP4.types.mdat, 4); // 设置 mdat 标识符
    // 处理每个音频 sample
    while (track.samples.length) {
      aacSample = track.samples.shift();
      unit = aacSample.unit;
      mdat.set(unit, i);
      i += unit.byteLength;
      pts = aacSample.pts - this._audioInitDTS;
      dts = aacSample.dts - this._audioInitDTS;

      if (lastDTS !== undefined) {
        ptsnorm = this._PTSNormalize(pts, lastDTS);
        dtsnorm = this._PTSNormalize(dts, lastDTS);
        mp4Sample.duration = (dtsnorm - lastDTS) / pes2mp4ScaleFactor;
        if (mp4Sample.duration < 0) {
          mp4Sample.duration = 0;
          ptsnorm = dtsnorm = lastDTS;
        }
      } else {
        let nextAacPts = this.nextAacPts || pts,
          delta;
        ptsnorm = this._PTSNormalize(pts, nextAacPts);
        dtsnorm = this._PTSNormalize(dts, nextAacPts);
        delta = Math.round((1000 * (ptsnorm - nextAacPts)) / pesTimeScale);
        if (contiguous || Math.abs(delta) < 600) {
          ptsnorm = dtsnorm = nextAacPts;
        }
        firstPTS = Math.max(0, ptsnorm);
        firstDTS = Math.max(0, dtsnorm);
      }

      mp4Sample = {
        size: unit.byteLength,
        cts: 0,
        duration: 0,
        flags: {
          isLeading: 0,
          isDependedOn: 0,
          hasRedundancy: 0,
          degradPrio: 0,
          dependsOn: 1,
        },
      };
      samples.push(mp4Sample);
      lastDTS = dtsnorm;
    }

    if (samples.length >= 2) {
      mp4Sample.duration = samples[samples.length - 2].duration;
    } else if (samples.length === 1) {
      mp4Sample.duration = Math.round(1024 * this.PES_TIMESCALE / (track.audiosamplerate || 44100)) / this.PES2MP4SCALEFACTOR;
    }
    this.nextAacPts = ptsnorm + mp4Sample.duration * pes2mp4ScaleFactor;
    track.len = 0;
    track.naluCnt = 0;
    track.sn = (track.sn || 0) + 1;
    track.samples = samples;
    moof = MP4.moof(track.sn, firstDTS / pes2mp4ScaleFactor, track);
    track.samples = [];

    let data = {
      type: "audio",
      data: this._mergeBoxes(moof, mdat), // 合并 moof 和 mdat
    };

    // ====================== 🔥 打印音频 REMUX 后时间 🔥 ======================
    const audioPtsSec = (firstPTS / 90000).toFixed(3);
    const audioDtsSec = (firstDTS / 90000).toFixed(3);
    console.log(`[REMUX-AUDIO] 分片时间：PTS=${audioPtsSec}s | DTS=${audioDtsSec}s | 帧数=${samples.length}`);

    this.mse.onFragParsing(data);
  }

  _mergeBoxes(moof, mdat) {
    let result = new Uint8Array(moof.byteLength + mdat.byteLength);
    result.set(moof, 0);
    result.set(mdat, moof.byteLength);
    return result;
  }

  _PTSNormalize(value, reference) {
    let offset;
    if (reference === undefined) {
      return value;
    }
    if (reference < value) {
      // - 2^33
      offset = -8589934592;
    } else {
      // + 2^33
      offset = 8589934592;
    }
    /* PTS is 33bit (from 0 to 2^33 -1)
    if diff between value and reference is bigger than half of the amplitude (2^32) then it means that
    PTS looping occured. fill the gap */
    while (Math.abs(value - reference) > 4294967296) {
      value += offset;
    }
    return value;
  }

  destroy() {
    this.reset();
  }

  reset() {
    this.insertDiscontinuity();
    this.switchLevel();
  }

  insertDiscontinuity() {
    this.nextAacPts = this.nextAvcDts = undefined;
    this._audioInitDTS = this._videoInitDTS = undefined;
  }

  switchLevel(isVideo = true, isAudio = true) {
    console.log("mp4-remuxer.switchLevel");
    // this.ISGenerated = false;
    if (isVideo) {
      this.videoISGenerated = false;
    }
    if (isAudio) {
      this.audioISGenerated = false;
    }
  }
}

export default MP4Remuxer;
