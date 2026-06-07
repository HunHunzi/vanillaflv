import LoaderController from "../src/core/Loader/LoaderController";
import HLSLoader from "../src/core/Loader/HLSLoader";
import MP4Loader from "../src/core/Loader/MP4Loader";
import DemuxerController from "../src/core/Demuxer/DemuxerController";
import DecoderController from "../src/core/Decoder/DecoderController";
import MSEController from "../src/core/Buffer/MSEController";

jest.mock("../src/core/Loader/HLSLoader");
jest.mock("../src/core/Loader/MP4Loader");
jest.mock("../src/core/Demuxer/DemuxerController");
jest.mock("../src/core/Decoder/DecoderController");
jest.mock("../src/core/Buffer/MSEController");

describe("LoaderController", () => {
  let loaderController;
  const options = {
    sourceURL: "http://example.com/playlist.m3u8",
    logger: {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("should initialize with HLSLoader", () => {
    loaderController = new LoaderController("HLS", options);

    expect(loaderController.type).toBe("HLS");
    expect(loaderController.sourceURL).toBe(options.sourceURL);
    expect(HLSLoader).toHaveBeenCalledWith({
      ...options,
      loaderController,
    });
    expect(loaderController.exeLoader).toBeInstanceOf(HLSLoader);
  });

  test("should initialize with MP4Loader", () => {
    const mp4Options = {
      ...options,
      sourceURL: "http://example.com/video.mp4",
    };
    loaderController = new LoaderController("MP4", mp4Options);

    expect(loaderController.type).toBe("MP4");
    expect(loaderController.sourceURL).toBe(mp4Options.sourceURL);
    expect(MP4Loader).toHaveBeenCalledWith({
      ...mp4Options,
      loaderController,
    });
    expect(loaderController.exeLoader).toBeInstanceOf(MP4Loader);
  });

  test("should log error for unsupported loader type", () => {
    loaderController = new LoaderController("INVALID", options);

    expect(options.logger.error).toHaveBeenCalledWith(
      "init",
      "INVALID is not supported."
    );
  });

  test("should start loading successfully", async () => {
    const mockLoadStream = jest.fn().mockResolvedValue();
    HLSLoader.mockImplementation(() => ({
      loadStream: mockLoadStream,
    }));

    loaderController = new LoaderController("HLS", options);
    await loaderController.startLoading();

    expect(options.logger.info).toHaveBeenCalledWith(
      "startLoading",
      "Loading started for HLS stream"
    );
    expect(mockLoadStream).toHaveBeenCalledTimes(1);
    expect(options.logger.info).toHaveBeenCalledWith(
      "startLoading",
      "Loading completed for HLS"
    );
  });

  test("should not start loading if already loading", async () => {
    loaderController = new LoaderController("HLS", options);
    loaderController.isLoading = true;

    await loaderController.startLoading();

    expect(options.logger.warn).toHaveBeenCalledWith(
      "startLoading",
      "Already loading..."
    );
  });

  test("should stop loading", () => {
    const mockStop = jest.fn();
    HLSLoader.mockImplementation(() => ({
      stop: mockStop,
    }));

    loaderController = new LoaderController("HLS", options);
    loaderController.isLoading = true;
    loaderController.exeLoader = { stop: mockStop };

    loaderController.stopLoading();

    expect(mockStop).toHaveBeenCalledTimes(1);
    expect(loaderController.isLoading).toBe(false);
    expect(options.logger.info).toHaveBeenCalledWith(
      "stopLoading",
      "Loading stopped."
    );
  });

  test("should log warning if stopLoading called while not loading", () => {
    loaderController = new LoaderController("HLS", options);

    loaderController.stopLoading();

    expect(options.logger.warn).toHaveBeenCalledWith(
      "stopLoading",
      "No loading in progress to stop."
    );
  });

  test("should add segments to segment pool", () => {
    loaderController = new LoaderController("HLS", options);
    const segments = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5, 6])];

    loaderController.addSegments(segments);

    expect(loaderController.segmentPool).toEqual(segments);
    expect(options.logger.info).toHaveBeenCalledWith(
      "addSegments",
      "2 segments added to the pool."
    );
  });

  test("should clear segment pool", () => {
    loaderController = new LoaderController("HLS", options);
    loaderController.segmentPool = [new Uint8Array([1, 2, 3])];

    loaderController.clearSegmentPool();

    expect(loaderController.segmentPool).toEqual([]);
    expect(options.logger.info).toHaveBeenCalledWith(
      "clearSegmentPool",
      "Segment pool cleared."
    );
  });

  test("should initialize DemuxerController", () => {
    loaderController = new LoaderController("HLS", options);

    expect(DemuxerController).toHaveBeenCalledWith(loaderController.ffmpeg);
    expect(loaderController.demuxer).toBeInstanceOf(DemuxerController);
  });
});
