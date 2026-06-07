"use strict";

const LOGLEVEL_DEBUG = -1;
const LOGLEVEL_LOG = 0;
const LOGLEVEL_INFO = 1;
const LOGLEVEL_WARN = 2;
const LOGLEVEL_ERROR = 3;
const MAX_LOG_LENGTH = 1000;

var globalLevel = 99; //默认不打印log

function getLogTime() {
  return new Date().toLocaleString() + " ";
}

var hasHeader = false;

let logger = {
  _data: [],
  _data2: [],
  _length: 0,

  debug: function () {
    var logTime = getLogTime();
    var args = Array.apply(null, arguments);
    args[0] = logTime + args[0];
    if (globalLevel <= LOGLEVEL_DEBUG) {
      //some browser(version) unsupport debug
      //console.debug.apply(console, args);
      console.log.apply(console, args);
    }
  },

  log: function (s) {
    var logTime = getLogTime();
    var args = Array.apply(null, arguments);
    args[0] = logTime + args[0];
    if (globalLevel <= LOGLEVEL_LOG) {
      console.log.apply(console, args);
    }
    logger.record(args, "log");
  },

  info: function (s) {
    var logTime = getLogTime();
    var args = Array.apply(null, arguments);
    args[0] = logTime + args[0];
    if (globalLevel <= LOGLEVEL_INFO) {
      console.info.apply(console, args);
    }
    logger.record(args, "info");
  },

  warn: function (s) {
    var logTime = getLogTime();
    var args = Array.apply(null, arguments);
    args[0] = logTime + args[0];
    if (globalLevel <= LOGLEVEL_WARN) {
      console.warn.apply(console, args);
    }
    logger.record(args, "warn");
  },

  error: function (s) {
    var logTime = getLogTime();
    var args = Array.apply(null, arguments);
    args[0] = logTime + args[0];
    if (globalLevel <= LOGLEVEL_ERROR) {
      console.error.apply(console, args);
    }
    logger.record(args, "error");
  },

  group: function (s) {
    var logTime = getLogTime();
    var args = Array.apply(null, arguments);
    args[0] = logTime + args[0];
    if (globalLevel <= LOGLEVEL_INFO) {
      var logFunc = console.groupCollapsed || console.group || console.log;
      logFunc.apply(console, args);
    }
    logger.record(args, "group");
  },

  groupEnd: function () {
    if (console.groupEnd) {
      console.groupEnd.apply(console);
    }
  },

  setLevel: function (newLevel) {
    if (newLevel != globalLevel) {
      console.log(
        getLogTime() + " set log level from " + globalLevel + " to " + newLevel
      );
      globalLevel = newLevel;
    }
  },

  getLevel: function () {
    return globalLevel;
  },

  record: function (args, type) {
    const maxLogLen = 4000 || MAX_LOG_LENGTH;
    if (logger._length === maxLogLen + 100) {
      logger._data.splice(0, 100);
      logger._data2.splice(0, 100);
      logger._length = maxLogLen;
    }
    var n = 0;
    var s = (args.shift() || "").toString();
    s = s.replace(/\%c/gi, function (match, $1) {
      n++;
      return "";
    });
    while (n-- && args.length) {
      args.shift();
    }
    for (var i = 0, len = args.length; i < len; i++) {
      var ss = args[i];
      if (typeof ss == "object") {
        // args[i] = JSON.stringify(args[i]);
        args[i] = "";
      }
    }
    args.unshift(s);
    var msg = args.join(" ");
    logger._length++;
    logger._data.push(`[${type}]${msg}`);
    logger._data2.push(`[${type}]${msg}`);
  },

  getLog: function () {
    if (!hasHeader) {
      hasHeader = true;
    }
    return logger._data;
  },

  getNewLog: function () {
    if (!hasHeader) {
      hasHeader = true;
    }

    const data = [...logger._data2];
    logger._data2.length = 0;
    return data;
  },

  logcss: function (color, bgColor, borderColor) {
    let css = "font-weight:900";
    if (color) css += ";color:" + color;
    if (bgColor) css += ";background:" + bgColor;
    if (borderColor) css += ";border:3px solid " + borderColor;
    return css;
  },

  padNum: function (val, digit) {
    let len = val.toString().length;
    let cnt = Math.max(0, digit - len);
    return "0".repeat(cnt) + val;
  },
};

export default logger;
