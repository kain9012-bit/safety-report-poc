import XCTest
import UIKit
import ImageIO
import UniformTypeIdentifiers
@testable import ParkingGuide

/// 웹 main 과 같은 5단계 신고서의 규칙 — 웹 followUps.test.ts 와 같은 사례를 iPhone 에서 확인한다.
@MainActor final class ReportFlowTests: XCTestCase {
    private let start = Date(timeIntervalSince1970: 1_791_000_000)

    private func pair(gap: TimeInterval = 65, located: Bool = true) -> ZoneCase {
        var c = ZoneCase(); c.version = 2; c.evidenceReview = EvidenceReview()
        let location = LocationRecord(latitude: 37.5665, longitude: 126.978, accuracy: 8, measuredAt: start, sampleCount: 3, spread: 2, quality: "주변 탐색 참고")
        c.evidence = [
            ZoneEvidence(id: UUID(), roles: [.incident], source: .prototypeCamera, filename: "a", takenAt: start, addedAt: start, primarySlot: .first, location: located ? location : nil),
            ZoneEvidence(id: UUID(), roles: [.incident], source: .prototypeCamera, filename: "b", takenAt: start.addingTimeInterval(gap), addedAt: start, primarySlot: .second, location: located ? location : nil),
        ]
        return c
    }
    private func obs(_ type: EvidenceType, photo: UUID, identity: String = "yes", target: String = "yes", relation: String = "yes", boundary: String? = "yes",
                     text: String = "", zoneKind: String? = nil, notice: NativeSharedNotice? = nil, stop: NativeBusStopPhoto? = nil) -> NativeAIObservation {
        NativeAIObservation(photoID: photo, type: type, identity: identity, target: target, relation: relation, text: text, unknownReasons: [],
                            sharedNotice: notice, busStop: stop, boundary: boundary, chargerToTarget: "unclear", zoneKind: zoneKind)
    }
    private func read(_ c: inout ZoneCase, _ observations: [NativeAIObservation]) {
        var r = c.review
        r.aiResult = NativeAIResult(revision: r.revision, photoIDs: c.evidence.map(\.id), generatedAt: start, recommendedTypes: [], observations: observations, summary: "", model: "test")
        c.evidenceReview = r
    }
    private let generalNotice = NativeSharedNotice(kind: "general_car", text: "일반차 주차 가능 22:00~07:00", bay: "13번", time: "22:00~07:00", conditions: "", issuer: "")

    func testNewOptionalFieldsKeepOldDraftsReadable() throws {
        var old = ZoneCase(); old.address = "이전 주소"; old.body = "이전 내용"
        let data = try JSONEncoder().encode([old])
        let json = String(decoding: data, as: UTF8.self)
        for key in ["plate", "typeSource", "bodyEdited", "supplementAsked", "submittedAt"] { XCTAssertFalse(json.contains("\"\(key)\"")) }
        let decoded = try JSONDecoder().decode([ZoneCase].self, from: data)
        XCTAssertEqual(decoded.first?.address, "이전 주소"); XCTAssertNil(decoded.first?.plate); XCTAssertNil(decoded.first?.reportType)
    }

    func testTypeIsFilledOnlyWhenPhotoEvidenceIsComplete() {
        var c = pair()
        read(&c, [obs(.hydrant, photo: c.evidence[0].id, relation: "unclear", boundary: nil)])
        c.applyPhotoType()
        XCTAssertNil(c.reportType, "차와의 관계가 미확인이면 비워 둔다")
        read(&c, [obs(.hydrant, photo: c.evidence[0].id, boundary: nil)])
        c.applyPhotoType()
        XCTAssertEqual(c.reportType, .hydrant); XCTAssertEqual(c.typeSource, "photo")
        read(&c, [obs(.hydrant, photo: c.evidence[0].id, relation: "unclear", boundary: nil)])
        c.applyPhotoType()
        XCTAssertNil(c.reportType, "근거가 사라지면 자동으로 채운 유형도 비운다")
    }

    func testUserChoiceIsNeverReplacedByPhotoReading() {
        var c = pair(); c.chooseType(.sidewalk)
        read(&c, [obs(.hydrant, photo: c.evidence[0].id, boundary: nil)])
        c.applyPhotoType()
        XCTAssertEqual(c.reportType, .sidewalk); XCTAssertEqual(c.typeSource, "user")
    }

    func testUnlinkedSupplementalPhotoDoesNotFillTheType() {
        var c = pair()
        let extra = ZoneEvidence(id: UUID(), roles: [.incident], source: .prototypeCamera, filename: "c", takenAt: start.addingTimeInterval(200), addedAt: start, primarySlot: .supplemental)
        c.evidence.append(extra)
        read(&c, [obs(.hydrant, photo: c.evidence[0].id, relation: "unclear", boundary: nil), obs(.hydrant, photo: extra.id, boundary: nil)])
        c.applyPhotoType()
        XCTAssertNil(c.reportType)
    }

    func testSupplementIsRequestedOnlyForPhotoSolvableGapsAndOnlyOnce() {
        var c = pair()
        read(&c, [obs(.hydrant, photo: c.evidence[0].id, relation: "unclear", boundary: nil)])
        XCTAssertEqual(ReportEvidence.supplementRequest(c), .init(id: "hydrant:connection", text: "소화전이나 소방용수 표시가 차와 함께 나오게 한 장 더 찍어 주세요"))
        c.supplementAsked = ["hydrant:connection"]
        XCTAssertNil(ReportEvidence.supplementRequest(c))

        var marking = pair()
        read(&marking, [obs(.hydrant, photo: marking.evidence[0].id, identity: "unclear", target: "unclear", relation: "unclear", boundary: nil, text: "빨간 시설")])
        XCTAssertEqual(ReportEvidence.supplementRequest(marking)?.text, "소화전이나 소방용수 표시가 잘 보이게 가까이에서 한 장 더 찍어 주세요")

        var done = pair()
        read(&done, [obs(.hydrant, photo: done.evidence[0].id, boundary: nil)])
        XCTAssertNil(ReportEvidence.supplementRequest(done), "근거가 확인됐으면 거리가 미측정이어도 요청하지 않는다")

        var noCue = pair()
        read(&noCue, [obs(.hydrant, photo: noCue.evidence[0].id, identity: "unclear", target: "unclear", relation: "unclear", boundary: nil)])
        XCTAssertNil(ReportEvidence.supplementRequest(noCue), "보이는 단서가 없으면 사진으로 해결된다고 보지 않는다")

        var other = pair(); other.chooseType(.other)
        read(&other, [obs(.hydrant, photo: other.evidence[0].id, relation: "unclear", boundary: nil)])
        XCTAssertNil(ReportEvidence.supplementRequest(other))
    }

    func testSharedParkingQuestionAndCheckRow() {
        var c = pair(); c.chooseType(.evcharging)
        read(&c, [obs(.evcharging, photo: c.evidence[0].id, zoneKind: "eco_parking", notice: generalNotice)])
        XCTAssertNotNil(ReportEvidence.generalNotice(c)); XCTAssertNil(ReportEvidence.sharedAnswer(c))
        XCTAssertTrue(c.reportChecks.first { $0.id == "shared_parking" }?.detail.contains("위반 유형 확인 단계에서") == true)
        c.answerShared(.sameBay)
        XCTAssertEqual(ReportEvidence.sharedAnswer(c), .sameBay)
        XCTAssertEqual(c.review.shared.timeConditions, "22:00~07:00"); XCTAssertEqual(c.review.shared.scope, "13번")
        XCTAssertEqual(c.reportChecks.first { $0.id == "shared_parking" }?.status, .warn)
        c.answerShared(.differentBay)
        XCTAssertFalse(c.reportChecks.contains { $0.id == "shared_parking" })
        c.invalidateEvidenceReview()
        XCTAssertNil(ReportEvidence.sharedAnswer(c), "사진이 바뀌면 다시 묻는다")

        var timeOnly = pair(); timeOnly.chooseType(.evcharging)
        read(&timeOnly, [obs(.evcharging, photo: timeOnly.evidence[0].id, zoneKind: "eco_parking", notice: NativeSharedNotice(kind: "ev_extra_time", text: "전기차 1시간", bay: "", time: "", conditions: "", issuer: ""))])
        XCTAssertNil(ReportEvidence.generalNotice(timeOnly))
    }

    func testComposedBodyUsesWebWording() {
        var c = pair(); c.address = "서울특별시 중구 세종대로 110"; c.plate = "12가 3456"; c.chooseType(.crossing)
        XCTAssertEqual(c.composedBody, [
            "- 일시: \(ReportRules.stamp(start))", "- 장소: 서울특별시 중구 세종대로 110", "- 위반: 횡단보도 불법 주정차",
            "- 차량: 12가3456", "- 증거: 같은 자리 사진 2장(65초 간격)",
        ].joined(separator: "\n"))
        c.body = "직접 쓴 내용"; c.bodyEdited = true
        XCTAssertEqual(c.reportBody, "직접 쓴 내용")
        var unknownTime = pair(); unknownTime.evidence[1] = ZoneEvidence(id: UUID(), roles: [.incident], source: .album, filename: "x", takenAt: nil, addedAt: start, primarySlot: .second)
        XCTAssertTrue(unknownTime.composedBody.contains("촬영 간격 미확인"))
    }

    func testPreSubmitChecksBlockLikeTheWeb() {
        var c = pair(gap: 1, located: false)
        let ids = Set(c.reportChecks.filter { $0.status == .fail }.map(\.id))
        XCTAssertEqual(ids, ["interval", "plate", "location", "evidence", "address"])
        XCTAssertTrue(c.reportBlocked)
        c = pair(); c.address = "주소"; c.plate = "12가3456"; c.chooseType(.crossing)
        XCTAssertFalse(c.reportBlocked)
        XCTAssertEqual(c.reportChecks.first { $0.id == "evidence" }?.status, .warn, "직접 고른 유형은 노란불로 사진 근거 확인을 권한다")
        XCTAssertTrue(c.reportChecks.first { $0.id == "interval" }?.detail.contains(ReportRules.intervalNote) == true)
    }

    func testDifferentBusStopNumbersWarn() {
        var c = pair(); c.chooseType(.busstop)
        read(&c, [obs(.busstop, photo: c.evidence[0].id, boundary: nil, stop: .init(publicId: "12-345", name: "", readable: true)),
                  obs(.busstop, photo: c.evidence[1].id, boundary: nil, stop: .init(publicId: "12-346", name: "", readable: true))])
        XCTAssertEqual(ReportEvidence.busStopNumbers(c), ["12-345", "12-346"])
        XCTAssertEqual(c.reportChecks.first { $0.id == "busstop_number" }?.status, .warn)
    }

    func testAlbumMetaReadsExifTimeAsKoreaTimeAndLeavesMissingValuesEmpty() throws {
        let format = UIGraphicsImageRendererFormat(); format.scale = 1
        let jpeg = UIGraphicsImageRenderer(size: CGSize(width: 40, height: 30), format: format).jpegData(withCompressionQuality: 0.9) { $0.fill(CGRect(x: 0, y: 0, width: 40, height: 30)) }
        XCTAssertNil(AlbumPhotoMeta(jpeg).takenAt); XCTAssertNil(AlbumPhotoMeta(jpeg).location)
        let output = NSMutableData()
        let source = try XCTUnwrap(CGImageSourceCreateWithData(jpeg as CFData, nil))
        let destination = try XCTUnwrap(CGImageDestinationCreateWithData(output, UTType.jpeg.identifier as CFString, 1, nil))
        let props: [CFString: Any] = [
            kCGImagePropertyExifDictionary: [kCGImagePropertyExifDateTimeOriginal: "2026:10:15 11:03:00"],
            kCGImagePropertyGPSDictionary: [kCGImagePropertyGPSLatitude: 37.5665, kCGImagePropertyGPSLatitudeRef: "N", kCGImagePropertyGPSLongitude: 126.978, kCGImagePropertyGPSLongitudeRef: "E"],
        ]
        CGImageDestinationAddImageFromSource(destination, source, 0, props as CFDictionary)
        XCTAssertTrue(CGImageDestinationFinalize(destination))
        let meta = AlbumPhotoMeta(output as Data)
        XCTAssertEqual(meta.takenAt.map(ReportRules.stamp), "2026-10-15 11:03")
        XCTAssertEqual(meta.location?.latitude ?? 0, 37.5665, accuracy: 0.0001)
        XCTAssertLessThan(meta.location?.accuracy ?? 0, 0, "정확도 기록이 없으면 지어내지 않는다")
    }
}
