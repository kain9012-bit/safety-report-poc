import XCTest
import UIKit
@testable import ParkingGuide

@MainActor final class NativeVisionContractTests: XCTestCase {
    private func legacyPhoto(_ description: String = "작은 빨간 시설이 보입니다.") -> [String: Any] {
        ["scene": ["fireHydrantNear": "yes", "onSidewalk": "no"], "typeGuess": "hydrant", "evidence": description]
    }
    private func modern(_ id: UUID, version: String = "3") -> [String: Any] {
        let row: [String: Any] = ["photoId": id.uuidString, "inputVersion": version, "type": "hydrant", "identity": "unclear", "markingToTarget": "unclear", "vehicleRelation": "unclear"]
        return ["analysisVersion": 2, "inputVersion": version, "photos": [["analysisVersion": 2, "photoId": id.uuidString, "inputVersion": version, "observations": [row]]], "evidenceReview": [["type": "hydrant", "status": "needs_context", "observations": [row]]]]
    }
    func testLegacyPreservesOrderedClaimsWithoutInventingStructuredEvidence() throws {
        let ids = [UUID(), UUID()]
        let decoded = try NativeVisionContract.decode(["photos": [legacyPhoto("첫 사진"), legacyPhoto("둘째 사진")], "ruleTypes": ["hydrant"]], photoIDs: ids, inputVersion: "3")
        XCTAssertEqual(decoded.format, "legacy"); XCTAssertFalse(decoded.supportsDetails)
        XCTAssertEqual(decoded.legacyReads.map(\.photoID), ids)
        XCTAssertEqual(decoded.legacyReads.map(\.evidence), ["첫 사진", "둘째 사진"])
        XCTAssertEqual(decoded.legacyReads[0].scene["fireHydrantNear"], "yes")
        XCTAssertTrue(decoded.notes.contains(NativeVisionContract.legacyNote))
        let parsed = NativeVisionClient.parse(decoded.object, allowedPhotoIDs: Set(ids))
        XCTAssertTrue(parsed.types.isEmpty); XCTAssertTrue(parsed.observations.isEmpty)
    }
    func testModernAndWrappedResponsesRetainBoundObservations() throws {
        let id = UUID()
        let decoded = try NativeVisionContract.decode(["result": modern(id)], photoIDs: [id], inputVersion: "3")
        XCTAssertTrue(decoded.supportsDetails); XCTAssertTrue(decoded.notes.isEmpty)
        XCTAssertEqual(NativeVisionClient.parse(decoded.object, allowedPhotoIDs: [id]).observations.first?.identity, "unclear")
    }
    func testModernEmptyObservationsAreDifferentFromMissingEvidence() throws {
        let id = UUID()
        let empty: [String: Any] = ["analysisVersion": 2, "photos": [["analysisVersion": 2, "photoId": id.uuidString, "observations": [[String: Any]]()]], "evidenceReview": [[String: Any]]()]
        XCTAssertTrue(try NativeVisionContract.decode(empty, photoIDs: [id], inputVersion: "3").supportsDetails)
        var malformed = empty; malformed.removeValue(forKey: "evidenceReview")
        XCTAssertThrowsError(try NativeVisionContract.decode(malformed, photoIDs: [id], inputVersion: "3"))
    }
    func testRejectsForeignReorderedStaleAndFutureVersionResponses() throws {
        let id = UUID()
        XCTAssertThrowsError(try NativeVisionContract.decode(modern(UUID()), photoIDs: [id], inputVersion: "3"))
        XCTAssertThrowsError(try NativeVisionContract.decode(modern(id, version: "2"), photoIDs: [id], inputVersion: "3"))
        var future = modern(id); future["analysisVersion"] = 9
        XCTAssertThrowsError(try NativeVisionContract.decode(future, photoIDs: [id], inputVersion: "3"))
        var legacy = legacyPhoto(); legacy["photoId"] = UUID().uuidString
        XCTAssertThrowsError(try NativeVisionContract.decode(["photos": [legacy]], photoIDs: [id], inputVersion: "3"))
        var corrupt = modern(id)
        corrupt["evidenceReview"] = [["type": "hydrant", "status": "observed", "observations": [["photoId": UUID().uuidString]]]]
        XCTAssertThrowsError(try NativeVisionContract.decode(corrupt, photoIDs: [id], inputVersion: "3"))
    }
    func testRejectsMalformedCountsAndAllFailedPhotosButRetainsPartialBinding() throws {
        let ids = [UUID(), UUID()]
        let invalidResponses: [[String: Any]] = [["photos": [legacyPhoto()]], ["photos": [NSNull(), NSNull()]], ["photos": [[String: Any](), legacyPhoto()]], ["evidence": "소화전"], ["error": "busy", "photos": [legacyPhoto(), legacyPhoto()]]]
        for response in invalidResponses {
            XCTAssertThrowsError(try NativeVisionContract.decode(response, photoIDs: ids, inputVersion: "3"))
        }
        let partial = try NativeVisionContract.decode(["photos": [NSNull(), legacyPhoto()]], photoIDs: ids, inputVersion: "3")
        XCTAssertTrue((partial.object["evidence"] as? String ?? "").contains("사진 2"))
        XCTAssertEqual(partial.legacyReads.first?.photoID, ids[1]); XCTAssertTrue(partial.notes.contains(NativeVisionContract.partialNote))
    }
    func testOldSavedAIResultStillDecodes() throws {
        let result = NativeAIResult(revision: 1, photoIDs: [], generatedAt: Date(), recommendedTypes: [], observations: [], summary: "기존 결과", model: "old", targetLinks: nil)
        let saved = try JSONDecoder().decode(NativeAIResult.self, from: JSONEncoder().encode(result))
        XCTAssertNil(saved.responseFormat); XCTAssertNil(saved.legacyReads); XCTAssertEqual(saved.summary, "기존 결과")
    }
    func testLegacyServerReceivesOnlyOneRequestEvenWithLargeOriginalAndRegionHint() async throws {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: folder) }
        let store = ZoneStore(folder: folder)
        let format = UIGraphicsImageRendererFormat(); format.scale = 1
        let image = UIGraphicsImageRenderer(size: CGSize(width: 1500, height: 1500), format: format).image { context in UIColor.blue.setFill(); context.fill(CGRect(x: 0, y: 0, width: 1500, height: 1500)) }.pngData()!
        var draft = ZoneCase(); draft.body = "유지할 내용"; draft.address = "유지할 주소"; draft.review.selectedType = .sidewalk
        draft = try store.add(data: image, source: .synthetic, role: .incident, date: nil, to: draft, slot: .first)
        let photo = try XCTUnwrap(draft.evidence.first)
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [LegacyContractProtocol.self]
        let session = URLSession(configuration: config); defer { session.invalidateAndCancel() }
        LegacyContractProtocol.requests = 0
        let result = try await NativeVisionClient.analyze(draft: draft, store: store, endpoint: "https://example.test/api/vision", session: session, regionHints: [photo.id: [.init(type: .hydrant, box: [0, 0, 600, 600])]])
        XCTAssertEqual(LegacyContractProtocol.requests, 1)
        XCTAssertEqual(result.responseFormat, "legacy"); XCTAssertEqual(result.legacyReads?.first?.photoID, photo.id)
        XCTAssertTrue(result.summary.contains(NativeVisionContract.legacyNote))
        XCTAssertTrue(result.observations.isEmpty); XCTAssertTrue(result.recommendedTypes.isEmpty)
        XCTAssertEqual(try store.data(photo), image); XCTAssertEqual(draft.review.selectedType, .sidewalk)
        XCTAssertEqual(draft.address, "유지할 주소"); XCTAssertEqual(draft.body, "유지할 내용")
    }
}

private final class LegacyContractProtocol: URLProtocol, @unchecked Sendable {
    static var requests = 0
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.requests += 1
        let result: [String: Any] = ["photos": [["scene": ["fireHydrantNear": "yes"], "typeGuess": "hydrant", "evidence": "작은 빨간 시설"]], "evidence": "소화전 추정", "model": "synthetic-test"]
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: try! JSONSerialization.data(withJSONObject: result)); client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
