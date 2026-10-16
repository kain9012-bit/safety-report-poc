import XCTest
import UIKit
@testable import ParkingGuide

/// 차량번호 세 단계(초록·주황·빨강) — 웹 src/lib/precheck.test.ts · officer.test.ts 와 같은 사례.
@MainActor final class PlateCheckTests: XCTestCase {
    private let start = Date(timeIntervalSince1970: 1_791_000_000)

    /// 차량번호 말고는 빨간불이 없는 신고(위치·유형·발생지역을 갖춤)
    private func pair(plate: String? = "12가3456") -> ZoneCase {
        var c = ZoneCase(); c.version = 2; c.evidenceReview = EvidenceReview(); c.plate = plate
        let at = LocationRecord(latitude: 35.8242, longitude: 127.148, accuracy: 6, measuredAt: start, sampleCount: 3, spread: 2, quality: "good", heading: nil, headingAccuracy: nil, headingMeasuredAt: nil, cameraDirection: nil)
        c.evidence = [
            ZoneEvidence(id: UUID(), roles: [.incident], source: .album, filename: "a", takenAt: start, addedAt: start, primarySlot: .first, location: at),
            ZoneEvidence(id: UUID(), roles: [.incident], source: .album, filename: "b", takenAt: start.addingTimeInterval(70), addedAt: start, primarySlot: .second, location: at),
        ]
        c.chooseType(.hydrant); c.address = "전북특별자치도 전주시 완산구 노송광장로 10"
        return c
    }
    /// 사진마다 읽은 번호 — nil 은 못 읽은 장
    private func read(_ c: inout ZoneCase, _ reads: [(String, Double)?]) {
        var r = c.review, map: [String: NativePlateRead] = [:]
        for (index, read) in reads.enumerated() { if let read { map[c.primaryPair[index].id.uuidString] = .init(text: read.0, readable: true, confidence: read.1) } }
        r.aiResult = NativeAIResult(revision: r.revision, photoIDs: c.evidence.map(\.id), generatedAt: start, recommendedTypes: [], observations: [], summary: "", model: "test", plates: map)
        c.evidenceReview = r
    }
    private func check(_ c: ZoneCase) -> ReportCheck { c.reportChecks.first { $0.id == "vehicle" }! }

    func testSameNumberOnBothPhotosPasses() {
        var c = pair(); read(&c, [("12가3456", 0.95), ("12가3456", 0.93)])
        XCTAssertEqual(check(c).status, .pass); XCTAssertNil(c.officerPlateLine)
    }
    func testOnePhotoReadIsOrangeWithReporterNumber() {
        var c = pair(); read(&c, [("12가3456", 0.9), nil])
        XCTAssertEqual(check(c).status, .warn); XCTAssertTrue(check(c).detail.contains("한 장에서만"))
        XCTAssertFalse(c.reportChecks.contains { $0.id == "vehicle" && $0.status == .fail })
    }
    func testNoReadingIsOrange() {
        let c = pair()
        XCTAssertEqual(check(c).status, .warn); XCTAssertTrue(check(c).detail.contains("판독 결과 없음"))
    }
    func testLowConfidenceIsOrange() {
        var c = pair(); read(&c, [("12가3456", 0.95), ("12가3456", 0.79)])
        XCTAssertEqual(check(c).status, .warn); XCTAssertTrue(check(c).detail.contains("확신도"))
    }
    func testDifferentEntryIsRedUntilConfirmedThenOrange() {
        var c = pair(plate: "99나9999"); read(&c, [("12가3456", 0.95), ("12가3456", 0.95)])
        XCTAssertEqual(check(c).status, .fail)
        XCTAssertEqual(c.reportReds.map(\.id), ["vehicle"], "시험 신고는 차량번호 말고 빨간불이 없어야 한다")
        c.plateConfirmedFor = "99 나 9999"
        XCTAssertEqual(check(c).status, .warn); XCTAssertTrue(check(c).detail.contains("신고인이 사진을 보고 확인했습니다"))
        c.plate = "99나9998"
        XCTAssertEqual(check(c).status, .fail, "확인한 뒤 번호를 바꾸면 확인이 풀린다")
    }
    func testEveryRedIsListedForNoticeAndRecordedWhenSubmittedAnyway() {
        var c = pair(plate: "99나9999"); read(&c, [("12가3456", 0.95), ("12가3456", 0.95)])
        c.body = "짧음"; c.bodyEdited = true
        XCTAssertTrue(c.reportBlocked); XCTAssertEqual(Set(c.reportReds.map(\.id)), ["vehicle", "body"])
        XCTAssertEqual(ReportRules.fixStep(c.reportReds[0].id), 2)
        c.submittedWithReds = c.reportReds.map(\.label)
        XCTAssertTrue(c.officerLines.contains("- 고지 후 제출: 빨간불(두 장 번호판 일치, 내용)과 불수용될 수 있다는 안내를 보고 신고인이 그대로 제출"))
        XCTAssertEqual([("address", 1), ("location", 1), ("plate", 2), ("body", 3), ("interval", 0), ("evidence", 0)].map { ReportRules.fixStep($0.0) }, [1, 1, 2, 3, 0, 0])
    }
    func testDifferentReadsNeedConfirmation() {
        var c = pair(); read(&c, [("12가3456", 0.9), ("12가3457", 0.9)])
        XCTAssertEqual(check(c).status, .fail); XCTAssertTrue(check(c).detail.contains("12가3457"))
        c.plateConfirmedFor = "12가3456"
        XCTAssertEqual(check(c).status, .warn)
    }
    func testEmptyEntryWithSureReadIsFilledOnlyWhenEmpty() {
        var c = pair(plate: nil); read(&c, [("12가3456", 0.95), ("12가3456", 0.95)])
        XCTAssertEqual(c.plateStatus.kind, .empty); XCTAssertTrue(check(c).detail.contains("12가3456"))
        XCTAssertEqual(c.reportChecks.first { $0.id == "plate" }?.status, .fail)
        c.applyPhotoPlate(); XCTAssertEqual(c.plate, "12가3456"); XCTAssertEqual(check(c).status, .pass)
        var typed = pair(plate: "34나5678"); read(&typed, [("12가3456", 0.95), ("12가3456", 0.95)])
        typed.applyPhotoPlate(); XCTAssertEqual(typed.plate, "34나5678", "사람이 넣은 번호는 덮어쓰지 않는다")
    }
    func testOfficerLineMatchesWeb() {
        var c = pair(); read(&c, [nil, ("12가3458", 0.62)])
        XCTAssertEqual(c.officerPlateLine, "- 차량번호: 12가3456(신고인 직접 입력) · AI 판독: 1장 못 읽음, 2장 12가3458(확신 62%) — AI가 확실히 읽지 못함, 사진으로 번호 확인 필요")
        var confirmed = pair(); read(&confirmed, [("12가3458", 0.93), ("12가3458", 0.91)]); confirmed.plateConfirmedFor = "12가3456"
        XCTAssertEqual(confirmed.officerPlateLine, "- 차량번호: 12가3456(신고인이 사진 보고 확인) · AI 판독: 1장 12가3458(확신 93%), 2장 12가3458(확신 91%) — AI 판독과 다름, 사진으로 번호 확인 필요")
        XCTAssertEqual(pair().officerPlateLine, "- 차량번호: 12가3456(신고인 직접 입력) · AI 판독: 판독 결과 없음 — AI가 확실히 읽지 못함, 사진으로 번호 확인 필요")
    }
    func testStaleReadingIsIgnored() {
        var c = pair(); read(&c, [("12가3456", 0.95), ("12가3456", 0.95)])
        var r = c.review; r.revision += 1; c.evidenceReview = r
        XCTAssertNil(c.photoPlates); XCTAssertEqual(check(c).status, .warn)
    }
    func testNormalizeAndOldSavedResult() throws {
        XCTAssertEqual(NativePlateRead.normalize(["text": " 12 가 3456 ", "readable": true, "confidence": 1.4]), .init(text: "12가3456", readable: true, confidence: 1))
        XCTAssertEqual(NativePlateRead.normalize(["text": "", "readable": true, "confidence": 0.9])?.readable, false)
        XCTAssertNil(NativePlateRead.normalize(nil))
        let old = NativeAIResult(revision: 1, photoIDs: [], generatedAt: start, recommendedTypes: [], observations: [], summary: "", model: "old")
        let json = String(decoding: try JSONEncoder().encode(old), as: UTF8.self)
        XCTAssertNil(try JSONDecoder().decode(NativeAIResult.self, from: Data(json.utf8)).plates)
    }
    /// 차가 여러 대라 서버가 대상 차를 정하지 못한 사진 — 웹 PlateFeedback.test.tsx 와 같은 사례
    func testCrowdedPhotoExplainsWhyNumberIsEmpty() throws {
        let empty: [String: Any] = ["text": "", "readable": false, "confidence": 0]
        XCTAssertEqual(NativePlateRead.normalize(empty, target: ["status": "ambiguous", "reason": "close_scores"])?.targetNote, "차가 여러 대라 신고할 차를 정하지 못함")
        XCTAssertEqual(NativePlateRead.normalize(empty, target: ["status": "ambiguous", "reason": "multiple_plates"])?.targetNote, "번호판이 보이는 차가 여러 대라 신고할 차를 정하지 못함")
        XCTAssertEqual(NativePlateRead.normalize(empty, target: ["status": "ambiguous", "reason": "other_plate_only"])?.targetNote, "가운데 차의 번호판은 안 보이고 다른 차 번호판만 보임")
        XCTAssertEqual(NativePlateRead.normalize(empty, target: ["status": "none", "reason": "no_vehicle"])?.targetNote, "사진에서 신고할 차를 찾지 못함")
        XCTAssertNil(NativePlateRead.normalize(empty, target: ["status": "clear", "reason": "linked"])?.targetNote)
        XCTAssertNil(NativePlateRead.normalize(empty)?.targetNote)
        // 이전에 저장한 판독(대상 정보 없음)도 그대로 읽힌다
        let saved = try JSONDecoder().decode(NativePlateRead.self, from: Data(#"{"text":"12가3456","readable":true,"confidence":0.9}"#.utf8))
        XCTAssertEqual(saved, .init(text: "12가3456", readable: true, confidence: 0.9))

        var c = pair(plate: nil), r = c.review
        let unsure = NativePlateRead(text: "", readable: false, confidence: 0, targetNote: "차가 여러 대라 신고할 차를 정하지 못함")
        r.aiResult = NativeAIResult(revision: r.revision, photoIDs: c.evidence.map(\.id), generatedAt: start, recommendedTypes: [], observations: [], summary: "", model: "test", plates: Dictionary(uniqueKeysWithValues: c.primaryPair.map { ($0.id.uuidString, unsure) }))
        c.evidenceReview = r
        XCTAssertEqual(c.plateStatus.kind, .unreadable)
        XCTAssertEqual(c.plateStatus.reason, "차가 여러 대라 신고할 차를 정하지 못함")
        XCTAssertTrue(check(c).detail.contains("차가 여러 대라 신고할 차를 정하지 못함"))
    }
    func testAnalyzerKeepsPlateFromServer() async throws {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: folder) }
        let store = ZoneStore(folder: folder)
        let format = UIGraphicsImageRendererFormat(); format.scale = 1
        let image = UIGraphicsImageRenderer(size: CGSize(width: 200, height: 200), format: format).image { context in UIColor.gray.setFill(); context.fill(CGRect(x: 0, y: 0, width: 200, height: 200)) }.pngData()!
        var draft = ZoneCase(); draft.version = 2; draft.evidenceReview = EvidenceReview()
        draft = try store.add(data: image, source: .synthetic, role: .incident, date: nil, to: draft, slot: .first)
        let photo = try XCTUnwrap(draft.evidence.first)
        PlateServerProtocol.photoID = photo.id.uuidString
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [PlateServerProtocol.self]
        let session = URLSession(configuration: config); defer { session.invalidateAndCancel() }
        let result = try await NativeVisionClient.analyze(draft: draft, store: store, endpoint: "https://example.test/api/vision", session: session)
        XCTAssertEqual(result.plates?[photo.id.uuidString], .init(text: "12가3456", readable: true, confidence: 0.72))
    }
}

private final class PlateServerProtocol: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var photoID = ""
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let photo: [String: Any] = ["photoId": Self.photoID, "analysisVersion": 2, "observations": [[String: Any]](), "detailRequests": [[String: Any]](), "plate": ["text": "12가 3456", "readable": true, "confidence": 0.72], "scene": [String: Any](), "typeGuess": "none", "evidence": ""]
        let result: [String: Any] = ["analysisVersion": 2, "photos": [photo], "evidenceReview": [[String: Any]](), "evidence": "", "model": "synthetic-test"]
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: try! JSONSerialization.data(withJSONObject: result)); client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
