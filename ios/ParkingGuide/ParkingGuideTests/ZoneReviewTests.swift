import XCTest
import UIKit
@testable import ParkingGuide

@MainActor final class ZoneReviewTests: XCTestCase {
    private var roots: [URL] = []
    override func tearDown() { for root in roots { try? FileManager.default.removeItem(at: root) }; roots = []; super.tearDown() }
    private func root() throws -> URL {
        let path = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: path, withIntermediateDirectories: true); roots.append(path); return path
    }
    private func photo() throws -> Data {
        let image = UIGraphicsImageRenderer(size: CGSize(width: 24, height: 24)).image { context in UIColor.blue.setFill(); context.fill(CGRect(x: 0, y: 0, width: 24, height: 24)) }
        return try XCTUnwrap(image.pngData())
    }
    func testUnknownAndDifferentBayStayUnverified() {
        var c = ZoneCase()
        XCTAssertEqual(c.finding, "구역 성격 미확인")
        XCTAssertEqual(c.issues.map(\.id), ["zone", "applies", "location", "incident", "sign", "overview", "source"])
        c.sharedSign = .yes; c.appliesToBay = .no
        XCTAssertEqual(c.finding, "표지 적용 주차면 확인 필요")
        XCTAssertTrue(c.issues.contains { $0.id == "shared" })
    }
    func testRouteCorrectionDoesNotUpgradeProvenance() {
        var c = ZoneCase(); c.situation = .traffic
        c.evidence = [.init(id: UUID(), roles: [.incident], source: .album, filename: "sample", addedAt: Date())]
        XCTAssertTrue(c.issues.contains { $0.id == "route" }); c.situation = .parking
        XCTAssertFalse(c.issues.contains { $0.id == "route" }); XCTAssertTrue(c.issues.contains { $0.id == "source" })
        XCTAssertEqual(c.evidence[0].source, .album)
    }
    func testSharedAndRolesAreIndependentFromEligibility() {
        var c = ZoneCase(); c.sharedSign = .yes; c.dedicatedSign = .yes; c.appliesToBay = .yes
        c.address = "합성 주소"; c.bay = "A-17"
        c.evidence = [.init(id: UUID(), roles: ZoneRole.allCases, source: .album, filename: "sample", addedAt: Date())]
        XCTAssertEqual(c.finding, "겸용 안내 관찰 · 운영 근거 미확인")
        XCTAssertEqual(c.issues.map(\.id), ["shared", "source"])
        XCTAssertTrue(c.suggestedSupplement.contains("다른 방해행위는 별도 검토"))
    }
    func testSignEvidenceDoesNotReplaceIncidentEvidence() {
        var c = ZoneCase(); c.evidence = [.init(id: UUID(), roles: [.sign], source: .album, filename: "sample", addedAt: Date())]
        XCTAssertFalse(c.issues.contains { $0.id == "sign" }); XCTAssertTrue(c.issues.contains { $0.id == "incident" }); XCTAssertTrue(c.issues.contains { $0.id == "overview" })
    }
    func testSaveRestoreAndOriginalBytes() throws {
        let folder = try root(); let store = ZoneStore(folder: folder); var c = ZoneCase()
        c.address = "합성 주소"; c.body = "직접 작성"; c.reviewerNote = "검토 메모"; c.step = 2
        let data = try photo(); c = try store.add(data: data, source: .album, role: .sign, date: nil, to: c)
        let restored = try XCTUnwrap(ZoneStore(folder: folder).cases.first)
        XCTAssertEqual(restored.address, c.address); XCTAssertEqual(restored.body, c.body); XCTAssertEqual(restored.reviewerNote, c.reviewerNote); XCTAssertEqual(restored.step, 2)
        XCTAssertNil(restored.evidence[0].takenAt)
        XCTAssertEqual(try Data(contentsOf: folder.appendingPathComponent(restored.evidence[0].filename)), data)
    }
    func testFailedReplacementAndDeletionKeepOriginalAndTypedFields() throws {
        let folder = try root(); var fail = false
        let store = ZoneStore(folder: folder, writer: { data, url in if fail { throw CocoaError(.fileWriteOutOfSpace) }; try data.write(to: url, options: .atomic) })
        var c = ZoneCase(); c.address = "보존 주소"; c.body = "보존 내용"; c.supplement = "수동 안내문"; c.supplementEdited = true
        c = try store.add(data: photo(), source: .prototypeCamera, role: .incident, date: Date(), to: c)
        let old = try XCTUnwrap(c.evidence.first); let before = try FileManager.default.contentsOfDirectory(atPath: folder.path).sorted()
        fail = true
        XCTAssertThrowsError(try store.add(data: photo(), source: .album, role: .sign, date: nil, to: c, replacing: old.id))
        XCTAssertThrowsError(try store.remove(old, from: c)); XCTAssertThrowsError(try store.delete(c))
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: folder.path).sorted(), before)
        let restored = try XCTUnwrap(ZoneStore(folder: folder).cases.first)
        XCTAssertEqual(restored.evidence[0].id, old.id); XCTAssertEqual(restored.address, "보존 주소"); XCTAssertEqual(restored.body, "보존 내용"); XCTAssertEqual(restored.supplement, "수동 안내문")
    }
    func testSuccessfulReplacementPreservesRolesAndCommitsBeforeDeleting() throws {
        let folder = try root(); let store = ZoneStore(folder: folder)
        var c = try store.add(data: photo(), source: .prototypeCamera, role: .incident, date: Date(), to: ZoneCase())
        c.evidence[0].roles = [.incident, .overview]; try store.save(c)
        let old = c.evidence[0]
        let next = try store.add(data: photo(), source: .album, role: .sign, date: nil, to: c, replacing: old.id)
        XCTAssertEqual(next.evidence.count, 1); XCTAssertEqual(next.evidence[0].roles, [.incident, .overview])
        XCTAssertFalse(FileManager.default.fileExists(atPath: folder.appendingPathComponent(old.filename).path))
        XCTAssertNotNil(store.image(next.evidence[0]))
    }
    func testInvalidImportAndCorruptIndexNeverOverwritePreviousFiles() throws {
        let folder = try root(); let store = ZoneStore(folder: folder)
        XCTAssertThrowsError(try store.add(data: Data("invalid".utf8), source: .album, role: .sign, date: nil, to: ZoneCase()))
        let bad = Data("corrupt index".utf8); try bad.write(to: folder.appendingPathComponent("index.json"))
        let broken = ZoneStore(folder: folder); XCTAssertNotNil(broken.error); XCTAssertThrowsError(try broken.save(ZoneCase()))
        XCTAssertEqual(try Data(contentsOf: folder.appendingPathComponent("index.json")), bad)
    }

    func testDiscardingFailedPhotoImportCannotHideUnsavedTextAndRetryRecovers() throws {
        let folder = try root(); var fail = false
        let store = ZoneStore(folder: folder, writer: { data, url in
            if fail { throw CocoaError(.fileWriteOutOfSpace) }
            try data.write(to: url, options: .atomic)
        })
        var draft = ZoneCase(); draft.address = "기존 주소"; draft.body = "기존 내용"
        draft = try store.add(data: photo(), source: .prototypeCamera, role: .incident, date: Date(), to: draft)
        let original = draft.evidence[0]
        let originalBytes = try Data(contentsOf: folder.appendingPathComponent(original.filename))
        var saveState = ZoneDraftSaveState()

        draft.address = "새로 입력한 주소"; draft.body = "새로 입력한 내용"
        fail = true
        XCTAssertFalse(saveState.persist(draft, in: store))
        XCTAssertThrowsError(try store.add(data: photo(), source: .album, role: .sign, date: nil, to: draft, replacing: original.id))
        saveState.failed("사진 저장 실패")

        // Cancelling the pending photo retries the text draft, instead of assuming it was saved.
        XCTAssertFalse(saveState.persist(draft, in: store))
        XCTAssertEqual(saveState.status, "저장 실패")
        XCTAssertNotNil(saveState.error)
        XCTAssertEqual(draft.address, "새로 입력한 주소")
        XCTAssertEqual(draft.body, "새로 입력한 내용")
        XCTAssertEqual(draft.evidence[0].id, original.id)
        let previous = try XCTUnwrap(ZoneStore(folder: folder).cases.first)
        XCTAssertEqual(previous.address, "기존 주소")
        XCTAssertEqual(previous.evidence[0].id, original.id)
        XCTAssertEqual(try Data(contentsOf: folder.appendingPathComponent(original.filename)), originalBytes)

        fail = false
        XCTAssertTrue(saveState.persist(draft, in: store))
        XCTAssertEqual(saveState.status, "기기에 저장됨")
        XCTAssertNil(saveState.error)
        let restored = try XCTUnwrap(ZoneStore(folder: folder).cases.first)
        XCTAssertEqual(restored.address, "새로 입력한 주소")
        XCTAssertEqual(restored.body, "새로 입력한 내용")
        XCTAssertEqual(restored.evidence[0].id, original.id)
    }
}
