class Config {
  constructor() {
    this.popSize0Brows = [];
  }

  now() {
    if (typeof window["performance"] !== "undefined") {
      var winperf = window["performance"];

      if (typeof winperf.now !== "undefined") {
        return ~~winperf.now();
      } else if (typeof winperf["webkitNow"] !== "undefined") {
        return ~~winperf["webkitNow"]();
      } else if (typeof winperf["mozNow"] !== "undefined") {
        return ~~winperf["mozNow"]();
      } else if (typeof winperf["msNow"] !== "undefined") {
        return ~~winperf["msNow"]();
      }
    }

    if (baseTime === 0) {
      baseTime = Date.now() - 1;
    }

    let diff = Date.now() - baseTime;
    if (diff > 0xffffffff) {
      baseTime += 0xffffffff;
      return diff - 0xffffffff;
    } else {
      return diff;
    }
  }
}
export default Config;
