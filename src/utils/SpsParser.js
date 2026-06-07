/**
 * 从 SPS NALU 中解析视频宽高
 * 支持 Baseline / Main / High Profile (profile_idc 66/77/100)
 */

class BitReader {
  constructor(data) {
    this.data = data;
    this.pos = 0; // bit position
  }

  readBit() {
    const byteIdx = this.pos >> 3;
    const bitIdx = 7 - (this.pos & 7);
    this.pos++;
    return (this.data[byteIdx] >> bitIdx) & 1;
  }

  readBits(n) {
    let val = 0;
    for (let i = 0; i < n; i++) {
      val = (val << 1) | this.readBit();
    }
    return val;
  }

  // Exp-Golomb unsigned
  readUE() {
    let leadingZeros = 0;
    while (this.readBit() === 0) leadingZeros++;
    if (leadingZeros === 0) return 0;
    return (1 << leadingZeros) - 1 + this.readBits(leadingZeros);
  }

  // Exp-Golomb signed
  readSE() {
    const v = this.readUE();
    return v & 1 ? (v + 1) >> 1 : -(v >> 1);
  }
}

/**
 * @param {Uint8Array} spsNalu - 原始 SPS NALU（含 NALU 头字节 0x67）
 * @returns {{ width: number, height: number } | null}
 */
export function parseSpsWidthHeight(spsNalu) {
  try {
    // 跳过 NALU header (1 byte)，从 profile_idc 开始
    const r = new BitReader(spsNalu);
    r.readBits(8); // forbidden_zero_bit + nal_ref_idc + nal_unit_type

    const profileIdc = r.readBits(8);
    r.readBits(8); // constraint flags
    r.readBits(8); // level_idc

    r.readUE(); // seq_parameter_set_id

    const highProfiles = [100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135];
    if (highProfiles.includes(profileIdc)) {
      const chromaFormatIdc = r.readUE();
      if (chromaFormatIdc === 3) r.readBit(); // separate_colour_plane_flag
      r.readUE(); // bit_depth_luma_minus8
      r.readUE(); // bit_depth_chroma_minus8
      r.readBit(); // qpprime_y_zero_transform_bypass_flag
      const seqScalingMatrixPresentFlag = r.readBit();
      if (seqScalingMatrixPresentFlag) {
        const count = chromaFormatIdc !== 3 ? 8 : 12;
        for (let i = 0; i < count; i++) {
          if (r.readBit()) { // seq_scaling_list_present_flag[i]
            const size = i < 6 ? 16 : 64;
            let lastScale = 8, nextScale = 8;
            for (let j = 0; j < size; j++) {
              if (nextScale !== 0) {
                nextScale = (lastScale + r.readSE() + 256) % 256;
              }
              lastScale = nextScale === 0 ? lastScale : nextScale;
            }
          }
        }
      }
    }

    r.readUE(); // log2_max_frame_num_minus4
    const picOrderCntType = r.readUE();
    if (picOrderCntType === 0) {
      r.readUE(); // log2_max_pic_order_cnt_lsb_minus4
    } else if (picOrderCntType === 1) {
      r.readBit(); // delta_pic_order_always_zero_flag
      r.readSE();  // offset_for_non_ref_pic
      r.readSE();  // offset_for_top_to_bottom_field
      const n = r.readUE(); // num_ref_frames_in_pic_order_cnt_cycle
      for (let i = 0; i < n; i++) r.readSE();
    }

    r.readUE(); // max_num_ref_frames
    r.readBit(); // gaps_in_frame_num_value_allowed_flag

    const picWidthInMbsMinus1 = r.readUE();
    const picHeightInMapUnitsMinus1 = r.readUE();
    const frameMbsOnlyFlag = r.readBit();

    let width = (picWidthInMbsMinus1 + 1) * 16;
    let height = (picHeightInMapUnitsMinus1 + 1) * 16 * (frameMbsOnlyFlag ? 1 : 2);

    if (!frameMbsOnlyFlag) r.readBit(); // mb_adaptive_frame_field_flag
    r.readBit(); // direct_8x8_inference_flag

    // frame_cropping
    if (r.readBit()) {
      const cropLeft   = r.readUE() * 2;
      const cropRight  = r.readUE() * 2;
      const cropTop    = r.readUE() * (frameMbsOnlyFlag ? 2 : 4);
      const cropBottom = r.readUE() * (frameMbsOnlyFlag ? 2 : 4);
      width  -= cropLeft + cropRight;
      height -= cropTop  + cropBottom;
    }

    return { width, height };
  } catch (e) {
    console.warn('[SpsParser] failed:', e);
    return null;
  }
}
