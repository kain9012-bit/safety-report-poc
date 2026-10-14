import XCTest
import AVFoundation
@testable import ParkingGuide

@MainActor final class ShortClipTests: XCTestCase {
    private var files: [URL] = []
    override func tearDown() {
        for url in files { try? FileManager.default.removeItem(at: url) }
        files = []; super.tearDown()
    }
    private func folder() throws -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        files.append(url); return url
    }
    // Real encoded synthetic movie; this does not test a physical camera.
    private func movie(seconds: Int) async throws -> URL {
        let url = try folder().appendingPathComponent("synthetic.mov")
        let writer = try AVAssetWriter(outputURL: url, fileType: .mov)
        let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
            AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: 320, AVVideoHeightKey: 240,
        ])
        let adapter = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32ARGB,
            kCVPixelBufferWidthKey as String: 320, kCVPixelBufferHeightKey as String: 240,
        ])
        writer.add(input)
        XCTAssertTrue(writer.startWriting()); writer.startSession(atSourceTime: .zero)
        var buffer: CVPixelBuffer?
        XCTAssertEqual(CVPixelBufferCreate(kCFAllocatorDefault, 320, 240, kCVPixelFormatType_32ARGB, nil, &buffer), kCVReturnSuccess)
        let pixel = try XCTUnwrap(buffer)
        CVPixelBufferLockBaseAddress(pixel, [])
        memset(CVPixelBufferGetBaseAddress(pixel), 128, CVPixelBufferGetBytesPerRow(pixel) * 240)
        CVPixelBufferUnlockBaseAddress(pixel, [])
        for i in 0..<(seconds * 30) {
            var waits = 0
            while !input.isReadyForMoreMediaData {
                if waits > 1000 { throw CocoaError(.fileWriteUnknown) }
                try await Task.sleep(for: .milliseconds(5)); waits += 1
            }
            XCTAssertTrue(adapter.append(pixel, withPresentationTime: CMTime(value: Int64(i), timescale: 30)))
        }
        input.markAsFinished(); writer.endSession(atSourceTime: CMTime(seconds: Double(seconds), preferredTimescale: 600))
        await writer.finishWriting(); XCTAssertEqual(writer.status, .completed)
        return url
    }
    private func clip(seconds: Int = 3) async throws -> CapturedClip {
        let url = try await movie(seconds: seconds)
        return try await ShortClip.prepare(url: url, startedAt: Date(), seconds: seconds)
    }
    func testThreeAndFiveSecondDecodingAndFrameOffsets() async throws {
        for seconds in [3, 5] {
            let clip = try await clip(seconds: seconds)
            XCTAssertEqual(clip.duration, Double(seconds), accuracy: 0.1)
            XCTAssertEqual(clip.width, 320); XCTAssertEqual(clip.height, 240)
            XCTAssertFalse(clip.firstImage.isEmpty); XCTAssertFalse(clip.lastImage.isEmpty)
            XCTAssertLessThan(clip.firstOffset, 0.1)
            XCTAssertGreaterThan(clip.lastOffset, clip.duration - 0.2)
            let audio = try await AVURLAsset(url: clip.url).loadTracks(withMediaType: .audio)
            XCTAssertTrue(audio.isEmpty)
        }
    }
    func testShortenedRecordingIsRejected() async throws {
        let url = try await movie(seconds: 3)
        do { _ = try await ShortClip.prepare(url: url, startedAt: Date(), seconds: 5); XCTFail("Short clip accepted") }
        catch { XCTAssertTrue(error is ShortClip.ClipError) }
    }
    func testSaveRestoresOriginalAndBothFrames() async throws {
        let root = try folder(); let store = PhotoStore(folder: root)
        let clip = try await clip(); try store.save(clip: clip)
        let restored = PhotoStore(folder: root); let saved = try XCTUnwrap(restored.photos.first)
        XCTAssertEqual(saved.duration, clip.duration)
        XCTAssertNotNil(restored.videoURL(for: saved)); XCTAssertNotNil(restored.image(for: saved)); XCTAssertNotNil(restored.lastImage(for: saved))
        XCTAssertEqual(try Data(contentsOf: XCTUnwrap(restored.videoURL(for: saved))), try Data(contentsOf: clip.url))
    }
    func testReplacementCommitsNewFilesBeforeRemovingOldOriginal() async throws {
        let store = PhotoStore(folder: try folder())
        let first = try await clip(); try store.save(clip: first)
        let old = try XCTUnwrap(store.photos.first); let oldURL = try XCTUnwrap(store.videoURL(for: old))
        let replacement = try await clip(seconds: 5); try store.save(clip: replacement, replacing: old.id)
        XCTAssertEqual(store.photos.count, 1); XCTAssertEqual(store.photos[0].id, old.id)
        XCTAssertEqual(store.photos[0].requestedSeconds, 5)
        XCTAssertFalse(FileManager.default.fileExists(atPath: oldURL.path))
    }
    func testIndexFailurePreservesOldRecordAndRemovesStagedFiles() async throws {
        let root = try folder(); var fail = false
        let store = PhotoStore(folder: root, indexWriter: { data, url in
            if fail { throw CocoaError(.fileWriteOutOfSpace) }
            try data.write(to: url, options: .atomic)
        })
        let first = try await clip(); try store.save(clip: first)
        let old = try XCTUnwrap(store.photos.first)
        let before = try FileManager.default.contentsOfDirectory(atPath: root.path).sorted()
        let newClip = try await clip(seconds: 5); fail = true
        XCTAssertThrowsError(try store.save(clip: newClip, replacing: old.id))
        XCTAssertEqual(store.photos[0].videoFilename, old.videoFilename)
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: root.path).sorted(), before)
        XCTAssertEqual(PhotoStore(folder: root).photos[0].videoFilename, old.videoFilename)
        XCTAssertThrowsError(try store.delete(old)); XCTAssertNotNil(store.videoURL(for: old))
    }
    func testDeleteRemovesVideoAndBothFrames() async throws {
        let root = try folder(); let store = PhotoStore(folder: root)
        let first = try await clip(); try store.save(clip: first)
        let old = try XCTUnwrap(store.photos.first); try store.delete(old)
        XCTAssertTrue(store.photos.isEmpty)
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: root.path), ["index.json"])
        XCTAssertTrue(PhotoStore(folder: root).photos.isEmpty)
    }
    func testLegacyPhotoIndexRemainsReadable() throws {
        let root = try folder(); let id = UUID()
        let legacy = "[{\"id\":\"\(id.uuidString)\",\"capturedAt\":100,\"filename\":\"old.jpg\"}]"
        try Data(legacy.utf8).write(to: root.appendingPathComponent("index.json"))
        let store = PhotoStore(folder: root)
        XCTAssertEqual(store.photos.count, 1); XCTAssertEqual(store.photos[0].id, id)
        XCTAssertFalse(store.photos[0].isVideo)
    }
}
