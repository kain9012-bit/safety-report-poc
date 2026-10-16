import XCTest
import UIKit
@testable import ParkingGuide

/// 횡단보도·인도 '위'는 바퀴가 닿은 바닥 답으로만 정한다 — 웹 src/lib/ground.test.ts 와 같은 사례.
@MainActor final class GroundRuleTests: XCTestCase {
    private let start = Date(timeIntervalSince1970: 1_791_000_000)

    private func pair() -> ZoneCase {
        var c = ZoneCase(); c.version = 2; c.evidenceReview = EvidenceReview()
        c.evidence = [
            ZoneEvidence(id: UUID(), roles: [.incident], source: .album, filename: "a", takenAt: start, addedAt: start, primarySlot: .first),
            ZoneEvidence(id: UUID(), roles: [.incident], source: .album, filename: "b", takenAt: start.addingTimeInterval(99), addedAt: start, primarySlot: .second),
        ]
        return c
    }
    private func full(_ type: EvidenceType, _ photo: UUID) -> NativeAIObservation {
        NativeAIObservation(photoID: photo, type: type, identity: "yes", target: "yes", relation: "yes", text: "", unknownReasons: [], sharedNotice: nil, busStop: nil, boundary: "yes", chargerToTarget: "unclear", zoneKind: nil)
    }
    private func ground(_ surface: String, _ wheels: [String], _ relation: String = "none") -> NativeGround {
        NativeGround(surface: surface, wheels: wheels.enumerated().map { .init(wheel: "바퀴 \($0.offset + 1)", surface: $0.element) }, crosswalkRelation: relation, evidence: "합성")
    }
    private func read(_ c: inout ZoneCase, _ observations: [NativeAIObservation], grounds: [NativeGround?]) {
        var r = c.review
        var map: [String: NativeGround] = [:]
        for (index, g) in grounds.enumerated() { if let g { map[c.primaryPair[index].id.uuidString] = g } }
        r.aiResult = NativeAIResult(revision: r.revision, photoIDs: c.evidence.map(\.id), generatedAt: start, recommendedTypes: [], observations: observations, summary: "", model: "test", grounds: map.isEmpty ? nil : map)
        c.evidenceReview = r
    }
    private func status(_ c: ZoneCase, _ type: EvidenceType) -> ReportEvidence.Status? { ReportEvidence.summarize(c).first { $0.type == type }?.status }

    func testRealPhotoCaseRoadwayNextToCrosswalkIsNotCrossingOrSidewalk() {
        var c = pair(); let (a, b) = (c.primaryPair[0].id, c.primaryPair[1].id)
        read(&c, [full(.crossing, a), full(.sidewalk, a), full(.crossing, b)],
             grounds: [ground("roadway", ["roadway", "roadway", "roadway", "roadway"], "adjacent"), ground("roadway", ["roadway"], "adjacent")])
        XCTAssertEqual(ReportEvidence.confidentTypes(c), [])
        XCTAssertEqual(status(c, .crossing), .notObserved); XCTAssertEqual(status(c, .sidewalk), .notObserved)
        XCTAssertTrue(ReportEvidence.crosswalkAdjacent(c))
        c.applyPhotoType(); XCTAssertNil(c.reportType)
    }
    func testWheelOnStripeConfirmsCrossingEvenWithoutObservation() {
        var c = pair()
        read(&c, [], grounds: [ground("crosswalk", ["crosswalk_stripe", "roadway"], "on"), ground("unclear", [])])
        XCTAssertEqual(ReportEvidence.confidentTypes(c), [.crossing]); XCTAssertFalse(ReportEvidence.crosswalkAdjacent(c))
        c.applyPhotoType(); XCTAssertEqual(c.reportType, .crossing)
    }
    func testDifferentGroundAnswersConflict() {
        var c = pair(); let (a, b) = (c.primaryPair[0].id, c.primaryPair[1].id)
        read(&c, [full(.crossing, a), full(.crossing, b)], grounds: [ground("crosswalk", ["crosswalk_stripe"]), ground("roadway", ["roadway"])])
        XCTAssertEqual(status(c, .crossing), .conflict); XCTAssertEqual(ReportEvidence.confidentTypes(c), [])
    }
    func testOldResultWithoutGroundDoesNotConfirmCrossing() {
        var c = pair(); let a = c.primaryPair[0].id
        read(&c, [full(.crossing, a), full(.hydrant, a)], grounds: [nil, nil])
        XCTAssertEqual(status(c, .crossing), .needsContext)
        XCTAssertEqual(ReportEvidence.confidentTypes(c), [.hydrant], "다른 유형은 지금처럼 표시 관찰로 정한다")
    }
    func testNormalizeMatchesWeb() {
        XCTAssertEqual(NativeGround.normalize(["surface": "crosswalk", "wheels": [["wheel": "x", "surface": "roadway"]]])?.surface, "unclear")
        XCTAssertEqual(NativeGround.normalize(["surface": "both", "wheels": [["wheel": "x", "surface": "crosswalk_stripe"], ["wheel": "y", "surface": "sidewalk_block"]]])?.surface, "both")
        let odd = NativeGround.normalize(["surface": "grass", "wheels": [["wheel": "x", "surface": "mud"]], "crosswalkRelation": "near"])
        XCTAssertEqual(odd?.surface, "unclear"); XCTAssertEqual(odd?.wheels, []); XCTAssertEqual(odd?.crosswalkRelation, "unclear")
        XCTAssertNil(NativeGround.normalize(nil))
        XCTAssertEqual(ground("both", []).on(.crossing), "yes"); XCTAssertEqual(ground("sidewalk", []).on(.crossing), "no"); XCTAssertEqual(ground("unclear", []).on(.sidewalk), "unclear")
    }
    func testSavedResultWithoutGroundsStillDecodes() throws {
        let result = NativeAIResult(revision: 1, photoIDs: [], generatedAt: start, recommendedTypes: [], observations: [], summary: "", model: "old")
        let json = String(decoding: try JSONEncoder().encode(result), as: UTF8.self)
        XCTAssertFalse(json.contains("grounds"))
        XCTAssertNil(try JSONDecoder().decode(NativeAIResult.self, from: Data(json.utf8)).grounds)
    }
    func testAnalyzerKeepsGroundFromModernServer() async throws {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: folder) }
        let store = ZoneStore(folder: folder)
        let format = UIGraphicsImageRendererFormat(); format.scale = 1
        let image = UIGraphicsImageRenderer(size: CGSize(width: 200, height: 200), format: format).image { context in UIColor.gray.setFill(); context.fill(CGRect(x: 0, y: 0, width: 200, height: 200)) }.pngData()!
        var draft = ZoneCase(); draft.version = 2; draft.evidenceReview = EvidenceReview()
        draft = try store.add(data: image, source: .synthetic, role: .incident, date: nil, to: draft, slot: .first)
        let photo = try XCTUnwrap(draft.evidence.first)
        ModernGroundProtocol.photoID = photo.id.uuidString
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [ModernGroundProtocol.self]
        let session = URLSession(configuration: config); defer { session.invalidateAndCancel() }
        let result = try await NativeVisionClient.analyze(draft: draft, store: store, endpoint: "https://example.test/api/vision", session: session)
        let g = try XCTUnwrap(result.grounds?[photo.id.uuidString])
        XCTAssertEqual(g.surface, "roadway"); XCTAssertEqual(g.crosswalkRelation, "adjacent"); XCTAssertEqual(g.wheels.count, 2)
    }
}

private final class ModernGroundProtocol: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var photoID = ""
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let ground: [String: Any] = ["surface": "roadway", "wheels": [["wheel": "앞", "surface": "roadway"], ["wheel": "뒤", "surface": "roadway"]], "crosswalkRelation": "adjacent", "evidence": "합성"]
        let photo: [String: Any] = ["photoId": Self.photoID, "analysisVersion": 2, "observations": [[String: Any]](), "detailRequests": [[String: Any]](), "ground": ground, "scene": [String: Any](), "typeGuess": "none", "evidence": ""]
        let result: [String: Any] = ["analysisVersion": 2, "photos": [photo], "evidenceReview": [[String: Any]](), "evidence": "", "model": "synthetic-test"]
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: try! JSONSerialization.data(withJSONObject: result)); client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
