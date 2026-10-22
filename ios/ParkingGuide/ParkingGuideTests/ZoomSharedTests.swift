import XCTest
@testable import ParkingGuide

/// 촬영 배율(웹 src/lib/zoom.test.ts)과 친환경차 병행주차 질문(웹 followUps.test.ts)과 같은 사례.
@MainActor final class ZoomSharedTests: XCTestCase {
    private let start = Date(timeIntervalSince1970: 1_791_000_000)

    private func pair() -> ZoneCase {
        var c = ZoneCase(); c.version = 2; c.evidenceReview = EvidenceReview()
        c.evidence = [
            ZoneEvidence(id: UUID(), roles: [.incident], source: .album, filename: "a", takenAt: start, addedAt: start, primarySlot: .first),
            ZoneEvidence(id: UUID(), roles: [.incident], source: .album, filename: "b", takenAt: start.addingTimeInterval(70), addedAt: start, primarySlot: .second),
        ]
        return c
    }
    private func row(_ c: ZoneCase) -> ReportCheck? { c.reportChecks.first { $0.id == "shared_parking" } }

    func testZoomClampAndLabel() {
        XCTAssertEqual(CameraZoom.clamp(0.5), 1)
        XCTAssertEqual(CameraZoom.clamp(1.64), 1.6, accuracy: 0.0001)
        XCTAssertEqual(CameraZoom.clamp(9), 3)
        XCTAssertEqual(CameraZoom.clamp(.nan), 1)
        XCTAssertEqual(CameraZoom.label(2), "2배")
        XCTAssertEqual(CameraZoom.label(1.6), "1.6배")
        XCTAssertEqual(CameraZoom.steps, [1, 2, 3])
    }
    func testCameraModelKeepsZoomInRange() {
        let model = CameraModel()
        model.setZoom(2); XCTAssertEqual(model.zoom, 2)
        model.setZoom(7); XCTAssertEqual(model.zoom, 3)
        model.setZoom(0.2); XCTAssertEqual(model.zoom, 1)
    }

    func testEvAlwaysAsksEvenWithoutNoticeAndRecordsAnswer() {
        var c = pair(); c.chooseType(.evcharging)
        XCTAssertTrue(ReportEvidence.sharedQuestionApplies(c)); XCTAssertNil(ReportEvidence.generalNotice(c)); XCTAssertNil(ReportEvidence.sharedAnswer(c))
        XCTAssertEqual(row(c)?.status, .warn)
        XCTAssertTrue(row(c)?.detail.contains("일반 자동차도 세울 수 있는 칸") == true)
        c.answerShared(.differentBay)
        XCTAssertEqual(ReportEvidence.sharedAnswer(c), .differentBay)
        XCTAssertEqual(c.review.shared.observed, .no); XCTAssertEqual(c.review.shared.source, "user_answer")
        XCTAssertNil(row(c), "없다고 답하면 점검 줄을 만들지 않는다")
        c.answerShared(.unknown)
        XCTAssertEqual(row(c)?.status, .warn)
        c.invalidateEvidenceReview()
        XCTAssertNil(ReportEvidence.sharedAnswer(c), "사진이 바뀌면 다시 묻는다")
    }
    func testOtherTypesAndNoPhotosAreNotAsked() {
        var hydrant = pair(); hydrant.chooseType(.hydrant)
        XCTAssertFalse(ReportEvidence.sharedQuestionApplies(hydrant)); XCTAssertNil(row(hydrant))
        hydrant.answerShared(.sameBay)
        XCTAssertNil(ReportEvidence.sharedAnswer(hydrant))
        var empty = ZoneCase(); empty.version = 2; empty.evidenceReview = EvidenceReview(); empty.chooseType(.evcharging)
        XCTAssertFalse(ReportEvidence.sharedQuestionApplies(empty))
    }
}
