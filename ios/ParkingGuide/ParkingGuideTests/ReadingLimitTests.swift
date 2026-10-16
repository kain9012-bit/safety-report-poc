import XCTest
import UIKit
@testable import ParkingGuide

/// 판독 한도(429) — 한 번만, 천천히 자동으로 다시 판독(웹 App.test '판독 한도' 와 같은 사례)
@MainActor final class ReadingLimitTests: XCTestCase {
    private var saved: (String?, String?)
    override func setUp() {
        super.setUp()
        saved = (UserDefaults.standard.string(forKey: ReportReading.endpointKey), UserDefaults.standard.string(forKey: ReportReading.consentKey))
        UserDefaults.standard.set("https://example.test/api/vision", forKey: ReportReading.endpointKey)
        UserDefaults.standard.set("yes", forKey: ReportReading.consentKey)
    }
    override func tearDown() {
        UserDefaults.standard.set(saved.0, forKey: ReportReading.endpointKey)
        UserDefaults.standard.set(saved.1, forKey: ReportReading.consentKey)
        super.tearDown()
    }
    private func pair() -> ZoneCase {
        var c = ZoneCase(); c.version = 2; c.evidenceReview = EvidenceReview()
        let t = Date(timeIntervalSince1970: 1_791_000_000)
        c.evidence = [
            ZoneEvidence(id: UUID(), roles: [.incident], source: .album, filename: "a", takenAt: t, addedAt: t, primarySlot: .first),
            ZoneEvidence(id: UUID(), roles: [.incident], source: .album, filename: "b", takenAt: t.addingTimeInterval(70), addedAt: t, primarySlot: .second),
        ]
        return c
    }
    private func result(_ c: ZoneCase) -> NativeAIResult {
        NativeAIResult(revision: c.review.revision, photoIDs: c.evidence.map(\.id), generatedAt: Date(), recommendedTypes: [], observations: [], summary: "", model: "test")
    }
    private func wait(_ reading: ReportReading, until done: @escaping (ReportReading.State) -> Bool) async {
        for _ in 0..<200 { if done(reading.state) { return }; try? await Task.sleep(for: .milliseconds(10)) }
    }
    private let limited = NativeVisionError(message: "한도", rateLimited: true)

    func testLimitedReadingIsRetriedOnceThenSucceeds() async {
        let c = pair(), store = ZoneStore(folder: FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString))
        let reading = ReportReading(); reading.retryDelay = .milliseconds(30)
        var calls = 0, applied = 0
        reading.analyzer = { draft, _, _ in calls += 1; if calls == 1 { throw self.limited }; return self.result(draft) }
        reading.run(c, store: store) { _, _ in applied += 1 }
        await wait(reading) { $0 == .retrying }
        XCTAssertEqual(reading.state, .retrying)
        await wait(reading) { $0 == .ok }
        XCTAssertEqual(calls, 2); XCTAssertEqual(applied, 1); XCTAssertEqual(reading.state, .ok)
    }
    func testStillLimitedAfterOneRetryStopsAndManualRetryCallsOnlyOnce() async {
        let c = pair(), store = ZoneStore(folder: FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString))
        let reading = ReportReading(); reading.retryDelay = .milliseconds(30)
        var calls = 0
        reading.analyzer = { _, _, _ in calls += 1; throw self.limited }
        reading.run(c, store: store) { _, _ in }
        await wait(reading) { $0 == .limited }
        XCTAssertEqual(reading.state, .limited); XCTAssertEqual(calls, 2)
        // 같은 사진으로 '다시 판독'을 누르면 한 번만 부르고, 자동으로 또 기다리지 않는다
        reading.run(c, store: store, force: true) { _, _ in }
        await wait(reading) { $0 == .limited && calls == 3 }
        try? await Task.sleep(for: .milliseconds(80))
        XCTAssertEqual(calls, 3); XCTAssertEqual(reading.state, .limited)
    }
    func testOtherErrorsAreNotRetried() async {
        let c = pair(), store = ZoneStore(folder: FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString))
        let reading = ReportReading(); reading.retryDelay = .milliseconds(10)
        var calls = 0
        reading.analyzer = { _, _, _ in calls += 1; throw NativeVisionError(message: "다른 오류") }
        reading.run(c, store: store) { _, _ in }
        await wait(reading) { if case .failed = $0 { return true }; return false }
        try? await Task.sleep(for: .milliseconds(50))
        XCTAssertEqual(calls, 1)
    }
    func testServerLimitBecomesRateLimitedError() async throws {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: folder) }
        let store = ZoneStore(folder: folder)
        let format = UIGraphicsImageRendererFormat(); format.scale = 1
        let image = UIGraphicsImageRenderer(size: CGSize(width: 100, height: 100), format: format).image { context in UIColor.gray.setFill(); context.fill(CGRect(x: 0, y: 0, width: 100, height: 100)) }.pngData()!
        var draft = ZoneCase(); draft.version = 2; draft.evidenceReview = EvidenceReview()
        draft = try store.add(data: image, source: .synthetic, role: .incident, date: nil, to: draft, slot: .first)
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [LimitProtocol.self]
        let session = URLSession(configuration: config); defer { session.invalidateAndCancel() }
        do {
            _ = try await NativeVisionClient.analyze(draft: draft, store: store, endpoint: "https://example.test/api/vision", session: session)
            XCTFail("한도 초과는 오류여야 한다")
        } catch let error as NativeVisionError {
            XCTAssertTrue(error.rateLimited)
        }
    }
}

private final class LimitProtocol: URLProtocol, @unchecked Sendable {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: 429, httpVersion: nil, headerFields: nil)!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(#"{"error":"rate_limited"}"#.utf8)); client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
