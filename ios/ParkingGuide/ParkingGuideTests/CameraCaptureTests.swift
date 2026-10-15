import XCTest
@testable import ParkingGuide

final class CameraCaptureTests: XCTestCase {
    func testCancelledPhotoCannotReappearFromDelayedSuccessOrError() {
        var requests = CaptureRequestGate()
        let cancelled = requests.begin()
        requests.cancel()

        // Both success and failure callbacks consume the same request before changing UI state.
        XCTAssertFalse(requests.finish(cancelled))
        XCTAssertFalse(requests.finish(cancelled))
        XCTAssertNil(requests.requestID)
    }

    func testLateCancelledCallbackCannotConsumeNextCapture() {
        var requests = CaptureRequestGate()
        let old = requests.begin()
        requests.cancel()
        let current = requests.begin()

        XCTAssertFalse(requests.finish(old))
        XCTAssertEqual(requests.requestID, current)
        XCTAssertTrue(requests.finish(current))
        XCTAssertFalse(requests.finish(current))
    }

    @MainActor func testClosedCameraIgnoresQueuedPhotoEvents() async {
        let camera = CameraModel()
        camera.close()
        camera.engine.onEvent?(.photo(UUID(), Data("synthetic photo".utf8), Date()))
        camera.engine.onEvent?(.photoFailure(UUID(), "late capture failure"))
        await Task.yield()
        await Task.yield()

        XCTAssertNil(camera.draft)
        XCTAssertNil(camera.error)
        XCTAssertFalse(camera.capturing)
    }

    @MainActor func testCancelledMovieCannotRestartProcessingFromQueuedDelegateEvents() async throws {
        let camera = CameraModel()
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("synthetic-\(UUID()).mov")
        try Data("synthetic cancelled movie".utf8).write(to: url)
        defer { try? FileManager.default.removeItem(at: url) }
        camera.cancelCapture()
        let id = UUID()
        camera.engine.onEvent?(.recording(id, Date(), 3))
        camera.engine.onEvent?(.movie(id, url, Date(), 3))
        camera.engine.onEvent?(.movieFailure(id, "late movie failure"))
        await Task.yield()
        await Task.yield()

        XCTAssertFalse(camera.capturing)
        XCTAssertFalse(camera.recording)
        XCTAssertFalse(camera.processing)
        XCTAssertNil(camera.clip)
        XCTAssertNil(camera.error)
        XCTAssertFalse(FileManager.default.fileExists(atPath: url.path))
    }
}
