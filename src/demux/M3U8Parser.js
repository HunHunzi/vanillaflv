/**
 * M3U8 播放列表解析器
 *
 * 支持：
 *   - Master Playlist（多码率选择）
 *   - Media Playlist（分片列表，VOD + 直播）
 *   - EXT-X-DISCONTINUITY 标记
 *   - 相对 / 绝对 URL 自动解析
 */

class M3U8Parser {
  /**
   * 解析 m3u8 文本
   * @param {string} text - 原始 m3u8 文本
   * @param {string} baseUrl - 该 m3u8 的请求地址，用于解析相对路径
   * @returns {MasterPlaylist | MediaPlaylist}
   */
  static parse(text, baseUrl) {
    const lines = text
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0);

    if (!lines[0].startsWith('#EXTM3U')) {
      throw new Error('Invalid M3U8: missing #EXTM3U header');
    }

    const isMaster = lines.some(l => l.startsWith('#EXT-X-STREAM-INF'));
    return isMaster
      ? M3U8Parser._parseMaster(lines, baseUrl)
      : M3U8Parser._parseMedia(lines, baseUrl);
  }

  // ─── Master Playlist ────────────────────────────────────────────────────────

  /**
   * @returns {{ isMaster: true, variants: Variant[] }}
   *
   * Variant: { url, bandwidth, resolution, codecs, frameRate }
   */
  static _parseMaster(lines, baseUrl) {
    const variants = [];
    let pending = null;

    for (const line of lines) {
      if (line.startsWith('#EXT-X-STREAM-INF:')) {
        const attrs = M3U8Parser._parseAttrs(line.slice('#EXT-X-STREAM-INF:'.length));
        pending = {
          bandwidth:  parseInt(attrs['BANDWIDTH'])   || 0,
          resolution: attrs['RESOLUTION']            || '',
          codecs:     M3U8Parser._stripQuotes(attrs['CODECS'] || ''),
          frameRate:  parseFloat(attrs['FRAME-RATE'] || '0') || 0,
          url: '',
        };
      } else if (!line.startsWith('#') && pending) {
        pending.url = M3U8Parser._resolve(line, baseUrl);
        variants.push(pending);
        pending = null;
      }
    }

    console.log(`[M3U8] Master playlist 解析完毕，共 ${variants.length} 条码率`);
    return { isMaster: true, variants };
  }

  // ─── Media Playlist ─────────────────────────────────────────────────────────

  /**
   * @returns {{
   *   isMaster: false,
   *   isVOD: boolean,
   *   targetDuration: number,
   *   mediaSequence: number,
   *   segments: Segment[]
   * }}
   *
   * Segment: { url, duration, sequence, discontinuity }
   */
  static _parseMedia(lines, baseUrl) {
    const segments = [];
    let targetDuration  = 0;
    let mediaSequence   = 0;
    let isVOD           = false;
    let seqCounter      = 0;

    // 临时状态：等待 URI 行补完的 EXTINF 信息
    let pendingDuration      = 0;
    let pendingDiscontinuity = false;

    for (const line of lines) {
      if (line.startsWith('#EXT-X-TARGETDURATION:')) {
        targetDuration = parseFloat(line.slice('#EXT-X-TARGETDURATION:'.length));

      } else if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
        mediaSequence = parseInt(line.slice('#EXT-X-MEDIA-SEQUENCE:'.length));
        seqCounter    = mediaSequence;

      } else if (line.startsWith('#EXTINF:')) {
        // #EXTINF:<duration>,[title]
        pendingDuration = parseFloat(line.slice('#EXTINF:'.length).split(',')[0]);

      } else if (line === '#EXT-X-ENDLIST') {
        isVOD = true;

      } else if (line === '#EXT-X-DISCONTINUITY') {
        // 下一个分片标记为不连续，通知 remuxer 重置时间戳基准
        pendingDiscontinuity = true;

      } else if (!line.startsWith('#')) {
        // 非注释行即为分片 URI
        segments.push({
          url:           M3U8Parser._resolve(line, baseUrl),
          duration:      pendingDuration,
          sequence:      seqCounter++,
          discontinuity: pendingDiscontinuity,
        });
        pendingDuration      = 0;
        pendingDiscontinuity = false;
      }
    }

    console.log(
      `[M3U8] Media playlist 解析完毕: isVOD=${isVOD} targetDuration=${targetDuration}s ` +
      `mediaSequence=${mediaSequence} segments=${segments.length}`
    );
    return { isMaster: false, isVOD, targetDuration, mediaSequence, segments };
  }

  // ─── 工具方法 ────────────────────────────────────────────────────────────────

  /**
   * 解析 key=value,key="value" 形式的属性字符串
   * @param {string} str
   * @returns {Object.<string, string>}
   */
  static _parseAttrs(str) {
    const result = {};
    // 匹配 KEY=VALUE 或 KEY="VALUE"，VALUE 内部可含逗号
    const re = /([A-Z0-9-]+)=("(?:[^"\\]|\\.)*"|[^,]*)/g;
    let m;
    while ((m = re.exec(str)) !== null) {
      result[m[1]] = m[2];
    }
    return result;
  }

  /**
   * 去掉属性值首尾的双引号
   */
  static _stripQuotes(str) {
    return str.replace(/^"|"$/g, '');
  }

  /**
   * 将相对 URL 解析为绝对 URL
   * @param {string} url   - 分片/播放列表 URL（可能是相对路径）
   * @param {string} base  - 当前 m3u8 的绝对地址
   */
  static _resolve(url, base) {
    if (!base) return url;
    // 已经是绝对地址
    if (/^https?:\/\//.test(url) || url.startsWith('//')) return url;
    try {
      return new URL(url, base).href;
    } catch {
      return url;
    }
  }
}

export default M3U8Parser;
