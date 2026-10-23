import XCTest
@testable import ParkingGuide

/// 유형이 여럿 보일 때 추천 — 웹 src/lib/choose.test.ts 와 같은 사례.
/// 단속 시간 안 → 사진만으로 확인 → 과태료가 무거운 쪽 → 사진 판독 순서.
@MainActor final class RecommendOrderTests: XCTestCase {
    private func kst(_ y: Int, _ m: Int, _ d: Int, _ h: Int) -> Date {
        var calendar = Calendar(identifier: .gregorian); calendar.timeZone = TimeZone(identifier: "Asia/Seoul")!
        return calendar.date(from: DateComponents(year: y, month: m, day: d, hour: h))!
    }
    private lazy var weekday10 = kst(2026, 10, 7, 10)
    private lazy var saturday10 = kst(2026, 10, 10, 10)

    private func pair(at start: Date) -> ZoneCase {
        var c = ZoneCase(); c.version = 2; c.evidenceReview = EvidenceReview()
        c.evidence = [
            ZoneEvidence(id: UUID(), roles: [.incident], source: .album, filename: "a", takenAt: start, addedAt: start, primarySlot: .first),
            ZoneEvidence(id: UUID(), roles: [.incident], source: .album, filename: "b", takenAt: start.addingTimeInterval(70), addedAt: start, primarySlot: .second),
        ]
        return c
    }
    private func full(_ type: EvidenceType, _ photo: UUID) -> NativeAIObservation {
        NativeAIObservation(photoID: photo, type: type, identity: "yes", target: "yes", relation: "yes", text: "", unknownReasons: [], sharedNotice: nil, busStop: nil, boundary: "yes", chargerToTarget: "unclear", zoneKind: nil)
    }
    /// 첫 사진 바퀴가 횡단보도 흰 줄 위 + 함께 보인 다른 유형
    private func crossingWith(_ other: EvidenceType, at start: Date) -> ZoneCase {
        var c = pair(at: start)
        let a = c.primaryPair[0].id
        var r = c.review
        let ground = NativeGround(surface: "crosswalk", wheels: [.init(wheel: "앞", surface: "crosswalk_stripe")], crosswalkRelation: "on", evidence: "합성")
        r.aiResult = NativeAIResult(revision: r.revision, photoIDs: c.evidence.map(\.id), generatedAt: start, recommendedTypes: [], observations: [full(other, a)],
                                    summary: "", model: "test", grounds: [a.uuidString: ground])
        c.evidenceReview = r
        return c
    }

    func testBothConfirmedByPhotoPicksTheHeavierFine() {
        var c = crossingWith(.schoolzone, at: weekday10)
        XCTAssertEqual(Set(ReportEvidence.confidentTypes(c)), [.crossing, .schoolzone])
        let options = ReportEvidence.rankedTypes(c)
        XCTAssertEqual(options.map(\.type), [.schoolzone, .crossing])
        XCTAssertTrue(options[0].recommended)
        XCTAssertTrue(ReportEvidence.recommendLine(options).contains("둘 다 사진으로 확인되어, 더 무거운 어린이보호구역을 추천합니다"))
        c.applyPhotoType()
        XCTAssertEqual(c.reportType, .schoolzone, "여럿이면 추천 유형을 채운다(웹과 같은 기본값)")
        XCTAssertEqual(c.typeSource, "photo")
        XCTAssertTrue(c.officerLines.contains("- 함께 보인 위반: 횡단보도(사진 판독, 확인 필요)"))
    }
    func testOutsideEnforcementHoursFallsBackToTheOtherType() {
        let c = crossingWith(.schoolzone, at: saturday10)
        let options = ReportEvidence.rankedTypes(c)
        XCTAssertEqual(options.first?.type, .crossing)
        XCTAssertFalse(options.first { $0.type == .schoolzone }!.enforceable)
        XCTAssertTrue(ReportEvidence.recommendLine(options).contains("지금 단속 시간이 아니어서"))
    }
    func testPhotoOnlyConfirmationBeatsAHigherFine() {
        var c = crossingWith(.hydrant, at: weekday10)
        let options = ReportEvidence.rankedTypes(c)
        XCTAssertEqual(options.map(\.type), [.crossing, .hydrant], "소화전(8만 원)보다 사진만으로 확인되는 횡단보도(4만 원)가 먼저")
        XCTAssertTrue(options[1].reasons.contains("소화전과의 거리(5m)는 사진만으로 재지 못합니다"))
        XCTAssertEqual(ReportEvidence.recommendLine(options), "사진만으로 확인되는 횡단보도를 추천합니다.")
        c.applyPhotoType()
        XCTAssertEqual(c.reportType, .crossing)
    }
    func testTiersAndJosaMatchWeb() {
        let c = pair(at: weekday10)
        XCTAssertEqual(ReportEvidence.evidenceTier(.crossing, c), 0)
        XCTAssertEqual(ReportEvidence.evidenceTier(.schoolzone, c), 0)
        XCTAssertEqual(ReportEvidence.evidenceTier(.disabled, c), 1, "표지가 없는 것까지 보이지 않으면 따로 확인")
        XCTAssertEqual(ReportEvidence.evidenceTier(.firelane, c), 1)
        XCTAssertEqual(ReportEvidence.evidenceTier(.evcharging, c), 1)
        XCTAssertEqual(ReportEvidence.josa("어린이보호구역", "을", "를"), "어린이보호구역을")
        XCTAssertEqual(ReportEvidence.josa("횡단보도", "을", "를"), "횡단보도를")
    }
}
