import XCTest
import CoreLocation
import CoreMotion
import UIKit
@testable import ParkingGuide

@MainActor final class EvidenceReviewTests: XCTestCase {
    private var folders: [URL] = []
    override func tearDown() { folders.forEach { try? FileManager.default.removeItem(at: $0) }; folders = []; super.tearDown() }
    private func store() throws -> ZoneStore {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString); folders.append(folder)
        return ZoneStore(folder: folder)
    }
    private func image() -> Data {
        let format = UIGraphicsImageRendererFormat(); format.scale = 1
        return UIGraphicsImageRenderer(size: CGSize(width: 200, height: 200), format: format).image { context in UIColor.blue.setFill(); context.fill(CGRect(x: 0, y: 0, width: 200, height: 200)) }.pngData()!
    }
    func testPrimaryPairIgnoresSupplementAndPreservesTypedFields() throws {
        let store = try store(); var c = ZoneCase(); c.address = "수동 주소"; c.body = "수동 설명"; c.review.selectedType = .busstop
        let date = Date(timeIntervalSince1970: 1000)
        c = try store.add(data: image(), source: .prototypeCamera, role: .incident, date: date, to: c, slot: .first)
        c = try store.add(data: image(), source: .prototypeCamera, role: .incident, date: date.addingTimeInterval(61), to: c, slot: .second)
        c = try store.add(data: image(), source: .album, role: .sign, date: nil, to: c)
        XCTAssertEqual(c.primaryPair.count, 2); XCTAssertTrue(c.primaryPairSummary.contains("61초")); XCTAssertEqual(c.evidence.count, 3)
        XCTAssertEqual(c.address, "수동 주소"); XCTAssertEqual(c.body, "수동 설명"); XCTAssertEqual(c.review.selectedType, .busstop)
        XCTAssertNil(c.evidence.last?.takenAt); XCTAssertEqual(c.evidence.last?.primarySlot, .supplemental)
    }
    func testReplacementInvalidatesAnswersAndRetainsSlot() throws {
        let store = try store(); var c = try store.add(data: image(), source: .album, role: .incident, date: nil, to: ZoneCase(), slot: .first)
        let id = c.evidence[0].id; let revision = c.review.revision
        c.review.answers["hydrant.identity"] = .init(answer: .yes, photoIDs: [id], revision: revision)
        let next = try store.add(data: image(), source: .album, role: .sign, date: nil, to: c, replacing: id)
        XCTAssertEqual(next.evidence[0].primarySlot, .first); XCTAssertNotEqual(next.evidence[0].id, id)
        XCTAssertGreaterThan(next.review.revision, revision); XCTAssertEqual(next.review.answer("hydrant.identity").photoIDs, [id])
        XCTAssertTrue(next.manualCandidates.isEmpty)
    }
    func testLegacyJSONOpensWithoutPromotingPhotosOrManualAnswers() throws {
        var c = ZoneCase(); c.sharedSign = .yes
        c.evidence = [.init(id: UUID(), roles: [.incident], source: .album, filename: "original", addedAt: Date())]
        var object = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(c)) as? [String: Any])
        object.removeValue(forKey: "evidenceReview")
        let restored = try JSONDecoder().decode(ZoneCase.self, from: JSONSerialization.data(withJSONObject: object))
        XCTAssertNil(restored.evidenceReview); XCTAssertTrue(restored.primaryPair.isEmpty)
        XCTAssertEqual(restored.sharedSign, .yes); XCTAssertEqual(restored.review.shared.observed, .unknown)
    }
    func testCandidateRequiresCurrentPhotoLinkedRelations() throws {
        let store = try store(); var c = try store.add(data: image(), source: .album, role: .overview, date: nil, to: ZoneCase(), slot: .first)
        for (key, _) in EvidenceType.disabled.questions { c.review.answers["disabled." + key] = .init(answer: .yes, photoIDs: [c.evidence[0].id], revision: c.review.revision) }
        XCTAssertEqual(c.manualCandidates, [.disabled]); c.invalidateEvidenceReview(); XCTAssertTrue(c.manualCandidates.isEmpty)
        XCTAssertEqual(c.review.selectedType, .other)
    }
    func testSharedNoticeRequiresRecheckingNewBayOrPhoto() {
        var c = ZoneCase(); c.review.shared.observed = .yes; c.review.shared.kind = "ev_extra_time"
        c.review.shared.reviewedSignature = c.reviewSignature
        XCTAssertTrue(c.review.shared.finding(signature: c.reviewSignature).contains("일반차 허용 근거는 미확인"))
        c.bay = "새로운 칸"
        XCTAssertTrue(c.review.shared.finding(signature: c.reviewSignature).contains("재확인"))
        XCTAssertEqual(c.review.shared.kind, "ev_extra_time")
    }
    func testSupplementalTargetLinkCannotSurviveChangedPrimaryOrSamePlateOnly() {
        let first = UUID(), second = UUID(); var link = EvidenceTargetLink(sameVehicle: .yes, samePlace: .unknown, primaryIDs: [first, second])
        XCTAssertFalse(link.usable(for: [first, second])); link.samePlace = .yes
        XCTAssertTrue(link.usable(for: [first, second])); XCTAssertFalse(link.usable(for: [UUID(), second]))
        XCTAssertFalse(link.usable(for: []))
    }

    func testNoNoticeCannotBecomeNoRestriction() {
        var value = SharedParkingReview(); value.observed = .no; value.reviewedSignature = "x"
        XCTAssertTrue(value.finding(signature: "x").contains("허용·금지 확정 안 됨"))
    }
    private func location(_ t: Double, accuracy: Double = 20, lat: Double = 37) -> CLLocation {
        CLLocation(coordinate: .init(latitude: lat, longitude: 127), altitude: 0, horizontalAccuracy: accuracy, verticalAccuracy: -1, timestamp: Date(timeIntervalSince1970: t))
    }
    func testGPSFreshnessAccuracyBoundariesAndDuplicateTimestamps() {
        let date = Date(timeIntervalSince1970: 100)
        let samples = [location(93), location(94), location(95)]
        XCTAssertEqual(CaptureLocationQuality.record(samples, at: date)?.quality, "주변 탐색 참고")
        XCTAssertEqual(CaptureLocationQuality.record(samples, at: date.addingTimeInterval(0.1))?.quality, "위치 오래됨")
        XCTAssertEqual(CaptureLocationQuality.record([location(98), location(98), location(99)], at: date)?.quality, "위치 변동·샘플 부족")
        XCTAssertEqual(CaptureLocationQuality.record([location(97, accuracy: 50), location(98, accuracy: 50), location(99, accuracy: 50)], at: date)?.quality, "넓은 범위로 참고")
        XCTAssertEqual(CaptureLocationQuality.record([location(97, accuracy: 51), location(98, accuracy: 51), location(99, accuracy: 51)], at: date)?.quality, "지도 확인 필요")
    }
    func testGPSSampleCapFutureAndLargeJump() {
        let date = Date(timeIntervalSince1970: 100)
        let many = (0..<30).map { location(94 + Double($0) / 10) }
        XCTAssertEqual(CaptureLocationQuality.record(many + [location(101)], at: date)?.sampleCount, 20)
        XCTAssertEqual(CaptureLocationQuality.record([location(97), location(98), location(99, lat: 38)], at: date)?.quality, "위치 변동·샘플 부족")
        XCTAssertNil(CaptureLocationQuality.record([location(101), location(99, accuracy: -1)], at: date))
    }
    func testCameraProjectionCardinalHeadingsAndRoll() {
        let date = Date()
        // The third row is the device +Z axis in the true-north reference frame.
        for (north, east, degrees) in [(1.0, 0.0, 0.0), (0, 1, 90), (-1, 0, 180), (0, -1, 270)] {
            let matrix = CMRotationMatrix(m11: 0, m12: 0, m13: 1, m21: east, m22: north, m23: 0, m31: -north, m32: east, m33: 0)
            let value = CameraDirectionProjection.project(matrix, measuredAt: date, trueNorth: true, calibrated: true, compassAccuracy: 10)
            XCTAssertEqual(value?.bearing ?? -1, degrees, accuracy: 0.001)
        }
        let northPortrait = CMRotationMatrix(m11: 0, m12: -1, m13: 0, m21: 0, m22: 0, m23: 1, m31: -1, m32: 0, m33: 0)
        XCTAssertEqual(CameraDirectionProjection.project(northPortrait, measuredAt: date, trueNorth: true, calibrated: true, compassAccuracy: 10)?.bearing, 0)
    }
    func testDirectionRejectsSkyGroundUncalibratedAndBadAccuracy() {
        let flat = CMRotationMatrix(m11: 1, m12: 0, m13: 0, m21: 0, m22: 1, m23: 0, m31: 0, m32: 0, m33: 1)
        XCTAssertNil(CameraDirectionProjection.project(flat, measuredAt: Date(), trueNorth: true, calibrated: true, compassAccuracy: 10))
        let upright = CMRotationMatrix(m11: 0, m12: -1, m13: 0, m21: 0, m22: 0, m23: 1, m31: -1, m32: 0, m33: 0)
        XCTAssertNil(CameraDirectionProjection.project(upright, measuredAt: Date(), trueNorth: false, calibrated: true, compassAccuracy: 10))
        XCTAssertNil(CameraDirectionProjection.project(upright, measuredAt: Date(), trueNorth: true, calibrated: false, compassAccuracy: 10))
        XCTAssertNil(CameraDirectionProjection.project(upright, measuredAt: Date(), trueNorth: true, calibrated: true, compassAccuracy: 31))
    }
    func testAIResponseRequiresPhotoBindingAndDoesNotPromoteLegacyRules() {
        let id = UUID()
        let foreign: [String: Any] = ["type": "hydrant", "status": "observed", "observations": [["photoId": UUID().uuidString, "identity": "yes", "markingToTarget": "yes", "vehicleRelation": "yes"]]]
        XCTAssertTrue(NativeVisionClient.parse(["evidenceReview": [foreign]], allowedPhotoIDs: [id]).types.isEmpty)
        XCTAssertTrue(NativeVisionClient.parse(["ruleTypes": ["hydrant"], "scene": ["fireHydrantNear": "yes"]], allowedPhotoIDs: [id]).types.isEmpty)
        let valid: [String: Any] = ["type": "hydrant", "status": "needs_context", "observations": [["photoId": id.uuidString, "identity": "yes", "markingToTarget": "unclear", "vehicleRelation": "unclear"]]]
        let result = NativeVisionClient.parse(["evidenceReview": [valid]], allowedPhotoIDs: [id])
        XCTAssertEqual(result.types, [.hydrant]); XCTAssertEqual(result.observations.first?.target, "unclear")
    }
    func testAIEndpointRejectsCredentialsAndNonHTTPS() {
        for url in ["http://example.com/api/vision", "https://user:password@example.com/api/vision", "https://example.com/api/vision?key=secret"] { XCTAssertThrowsError(try NativeVisionClient.endpointURL(url)) }
        XCTAssertNoThrow(try NativeVisionClient.endpointURL("https://example.com/api/vision"))
    }
    func testNativeBackendSendsPrimaryPairAndSeparateSupplementWithoutLocation() async throws {
        let store = try store(); var c = ZoneCase(); c.body = "전송하지 않는 설명"; c.address = "전송하지 않는 주소"
        c = try store.add(data: image(), source: .prototypeCamera, role: .incident, date: Date(), to: c, slot: .first)
        c = try store.add(data: image(), source: .prototypeCamera, role: .incident, date: Date(), to: c, slot: .second)
        c = try store.add(data: image(), source: .album, role: .sign, date: nil, to: c)
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [EvidenceMockProtocol.self]
        EvidenceMockProtocol.requests = []
        let result = try await NativeVisionClient.analyze(draft: c, store: store, endpoint: "https://example.test/api/vision", session: URLSession(configuration: config))
        XCTAssertEqual(EvidenceMockProtocol.requests.count, 2)
        XCTAssertEqual(EvidenceMockProtocol.requests.first?["photoIds"] as? [String], c.primaryPair.map { $0.id.uuidString })
        XCTAssertEqual((EvidenceMockProtocol.requests.last?["images"] as? [String])?.count, 1)
        XCTAssertEqual((EvidenceMockProtocol.requests.last?["reference"] as? [String: Any])?["photoId"] as? String, c.primaryPair.first?.id.uuidString)
        XCTAssertTrue(EvidenceMockProtocol.requests.allSatisfy { $0["address"] == nil && $0["location"] == nil && $0["body"] == nil })
        XCTAssertEqual(result.recommendedTypes, [.hydrant]); XCTAssertEqual(result.observations.count, 3)
        XCTAssertEqual(c.review.selectedType, .other); XCTAssertEqual(c.address, "전송하지 않는 주소")
    }

    func testFallbackScansOverlappingOriginalWhenFirstPassMissesFacility() throws {
        let format = UIGraphicsImageRendererFormat(); format.scale = 1
        let original = UIGraphicsImageRenderer(size: CGSize(width: 2000, height: 1400), format: format).image { context in UIColor.blue.setFill(); context.fill(CGRect(x: 0, y: 0, width: 2000, height: 1400)) }.jpegData(compressionQuality: 0.9)!
        let object: [String: Any] = ["photos": [["analysisVersion": 2, "observations": [], "detailRequests": []]]]
        let result = try NativeVisionClient.detailImages(object, originals: [original])
        XCTAssertEqual(result.count, 2)
        XCTAssertEqual(result[0]["box"] as? [Double], [0, 0, 1000, 600])
        XCTAssertEqual(result[1]["box"] as? [Double], [0, 400, 1000, 1000])
        XCTAssertEqual(result[0]["reason"] as? String, "overlap_scan")
        XCTAssertEqual(UIImage(data: original)?.size, CGSize(width: 2000, height: 1400))
    }
    func testUserRegionIsOnlySearchHintAndDoesNotMutateOriginal() throws {
        let original = image()
        let result = try NativeVisionClient.detailImages(["photos": [["observations": [], "detailRequests": []]]], originals: [original], regionHints: [["imageIndex": 0, "type": "hydrant", "box": [100.0, 100.0, 600.0, 600.0], "reason": "user_region"]])
        XCTAssertEqual(result.count, 1); XCTAssertEqual(result[0]["reason"] as? String, "user_region")
        XCTAssertEqual(UIImage(data: original)?.size, CGSize(width: 200, height: 200))
    }
    func testDetailCannotUpgradeVehicleLinkOrIndependentPlateReading() {
        let id = UUID().uuidString
        let before: [String: Any] = ["photos": [["photoId": id, "plate": ["text": "12가3456"], "targetLink": ["referencePhotoId": UUID().uuidString, "samePlace": "unclear"], "observations": [["type": "hydrant", "photoId": id, "identity": "unclear", "markingToTarget": "unclear", "vehicleRelation": "unclear"]]]]]
        let after: [String: Any] = ["photos": [["plate": ["text": "99나9999"], "targetLink": ["samePlace": "yes"], "observations": [["type": "hydrant", "photoId": id, "identity": "yes", "markingText": "소화전", "markingToTarget": "yes", "vehicleRelation": "yes"]]]]]
        let merged = NativeVisionClient.mergeDetailEnvelope(before, second: after, requests: [["imageIndex": 0, "type": "hydrant"]])
        let photo = (merged["photos"] as? [[String: Any]])?.first
        let observation = (photo?["observations"] as? [[String: Any]])?.first
        XCTAssertEqual(observation?["identity"] as? String, "yes")
        XCTAssertEqual(observation?["vehicleRelation"] as? String, "unclear")
        XCTAssertEqual(observation?["markingText"] as? String, "소화전")
        XCTAssertEqual((photo?["plate"] as? [String: String])?["text"], "12가3456")
        XCTAssertEqual((photo?["targetLink"] as? [String: Any])?["samePlace"] as? String, "unclear")
        XCTAssertEqual((merged["ruleTypes"] as? [String])?.count, 0)
        let discovered = NativeVisionClient.mergeDetailEnvelope(["photos": [["photoId": id, "observations": []]]], second: after, requests: [["imageIndex": 0, "type": "hydrant"]])
        let newObservation = ((discovered["evidenceReview"] as? [[String: Any]])?.first?["observations"] as? [[String: Any]])?.first
        XCTAssertEqual(newObservation?["identity"] as? String, "yes")
        XCTAssertEqual(newObservation?["markingToTarget"] as? String, "unclear")
    }
    func testNativeStopOCRCannotInventPublicDataNamespace() {
        let id = UUID()
        let response: [String: Any] = ["evidenceReview": [["type": "busstop", "status": "needs_context", "observations": [["photoId": id.uuidString, "identity": "yes", "busStop": ["publicId": "01234", "name": "가상", "readable": true, "publicIdNamespace": "TAGO:forged"]]]]]]
        let parsed = NativeVisionClient.parse(response, allowedPhotoIDs: [id])
        XCTAssertEqual(parsed.observations.first?.busStop?.publicId, "01234")
        XCTAssertNil(parsed.observations.first?.busStop?.publicIdNamespace)
    }

    func testRegionCommitInvalidatesAnalysisButPreservesOriginalAndUserFields() throws {
        let store = try store(), original = image()
        var c = try store.add(data: original, source: .album, role: .incident, date: nil, to: ZoneCase(), slot: .first)
        c.address = "직접 쓴 주소"; c.body = "직접 쓴 설명"; c.review.selectedType = .disabled
        let id = c.evidence[0].id, oldRevision = c.review.revision
        c.review.answers["disabled.identity"] = .init(answer: .yes, photoIDs: [id], revision: oldRevision)
        c.review.aiResult = .init(revision: oldRevision, photoIDs: [id], generatedAt: Date(), recommendedTypes: [.hydrant], observations: [], summary: "이전 분석", model: "synthetic", targetLinks: nil)
        // Editing a sheet-local value alone has no effect until the commit helper is called.
        let region = EvidenceRegion(type: .hydrant, box: [100, 200, 600, 700])
        XCTAssertNil(c.review.regionHints)
        XCTAssertTrue(c.setAnalysisRegion(region, for: id))
        XCTAssertEqual(c.review.revision, oldRevision + 1)
        XCTAssertEqual(c.review.aiResult?.revision, oldRevision)
        XCTAssertEqual(c.review.answer("disabled.identity").answer, .yes)
        XCTAssertEqual(c.review.selectedType, .disabled)
        XCTAssertEqual(c.address, "직접 쓴 주소"); XCTAssertEqual(c.body, "직접 쓴 설명")
        XCTAssertEqual(try store.data(c.evidence[0]), original)
        XCTAssertEqual(c.nativeRegionHints[id]?.first?.box, region.box)
        let restored = try JSONDecoder().decode(ZoneCase.self, from: JSONEncoder().encode(c))
        XCTAssertEqual(restored.nativeRegionHints[id]?.first?.box, region.box)
        XCTAssertFalse(c.setAnalysisRegion(region, for: id))
        XCTAssertEqual(c.review.revision, oldRevision + 1)
        XCTAssertFalse(c.setAnalysisRegion(region, for: UUID()))
        XCTAssertTrue(c.setAnalysisRegion(nil, for: id)); XCTAssertTrue(c.nativeRegionHints.isEmpty)
    }
    func testRegionCoordinatesHandleReverseDragAndRejectInvalidInput() throws {
        XCTAssertEqual(EvidenceRegion.box(from: CGPoint(x: 300, y: 150), to: CGPoint(x: 100, y: 50), within: CGSize(width: 400, height: 200)), [250, 250, 750, 750])
        XCTAssertEqual(EvidenceRegion.box(from: CGPoint(x: -10, y: -10), to: CGPoint(x: 500, y: 250), within: CGSize(width: 400, height: 200)), [0, 0, 1000, 1000])
        XCTAssertNil(EvidenceRegion.box(from: .zero, to: .zero, within: CGSize(width: 400, height: 200)))
        XCTAssertNil(EvidenceRegion.box(from: .zero, to: CGPoint(x: 5, y: 5), within: .zero))
        XCTAssertFalse(EvidenceRegion(type: .hydrant, box: [0, 0, .nan, 100]).isValid)
        var object = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(EvidenceReview())) as? [String: Any])
        object.removeValue(forKey: "regionHints")
        let legacy = try JSONDecoder().decode(EvidenceReview.self, from: JSONSerialization.data(withJSONObject: object))
        XCTAssertNil(legacy.regionHints)
    }

    func testCropRequestsBoundedAndNeverOverwriteOriginal() throws {
        let original = image()
        let request: [String: Any] = ["type": "hydrant", "box": [0.0, 0.0, 500.0, 500.0]]
        let object: [String: Any] = ["photos": [["detailRequests": [request, request, request]]]]
        let result = try NativeVisionClient.detailImages(object, originals: [original])
        XCTAssertEqual(result.count, 2); XCTAssertEqual(result.first?["imageIndex"] as? Int, 0)
        XCTAssertEqual(UIImage(data: original)?.size, CGSize(width: 200, height: 200))
    }
}

private final class EvidenceMockProtocol: URLProtocol, @unchecked Sendable {
    static var requests: [[String: Any]] = []
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        var data = request.httpBody ?? Data()
        if data.isEmpty, let stream = request.httpBodyStream {
            stream.open(); defer { stream.close() }
            let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: 8192); defer { buffer.deallocate() }
            while stream.hasBytesAvailable { let count = stream.read(buffer, maxLength: 8192); if count <= 0 { break }; data.append(buffer, count: count) }
        }
        let body = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        Self.requests.append(body)
        let ids = body["photoIds"] as? [String] ?? []
        let observations = ids.map { ["photoId": $0, "identity": "yes", "markingToTarget": "unclear", "vehicleRelation": "unclear"] }
        let result: [String: Any] = ["evidenceReview": [["type": "hydrant", "status": "needs_context", "observations": observations]], "evidence": "합성 응답", "model": "test-only"]
        let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: try! JSONSerialization.data(withJSONObject: result)); client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
