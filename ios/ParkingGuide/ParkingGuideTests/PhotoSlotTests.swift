import XCTest
import UIKit
@testable import ParkingGuide

/// 신고서 사진 칸의 바꾸기·넣기·지우기 — 웹 src/lib/replacement.test.ts 와 같은 사례를 iPhone 에서 확인한다.
@MainActor final class PhotoSlotTests: XCTestCase {
    private final class Failing { var on = false }
    private var folders: [URL] = []
    private let start = Date(timeIntervalSince1970: 1_791_000_000)
    override func tearDown() { folders.forEach { try? FileManager.default.removeItem(at: $0) }; folders = []; super.tearDown() }

    private func store(_ failing: Failing? = nil) -> (ZoneStore, URL) {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString); folders.append(folder)
        let store = ZoneStore(folder: folder) { data, url in
            if failing?.on == true { throw CocoaError(.fileWriteOutOfSpace) }
            try data.write(to: url, options: [.atomic])
        }
        return (store, folder)
    }
    private func image(_ color: UIColor = .blue) -> Data {
        let format = UIGraphicsImageRendererFormat(); format.scale = 1
        return UIGraphicsImageRenderer(size: CGSize(width: 40, height: 30), format: format).image { context in color.setFill(); context.fill(CGRect(x: 0, y: 0, width: 40, height: 30)) }.pngData()!
    }
    private func exists(_ folder: URL, _ photo: ZoneEvidence) -> Bool { FileManager.default.fileExists(atPath: folder.appendingPathComponent(photo.filename).path) }
    /// 기본 두 장(65초 간격) + 보완사진 한 장
    private func pairWithSupplement(_ store: ZoneStore) throws -> ZoneCase {
        var c = ZoneCase(); c.version = 2; c.evidenceReview = EvidenceReview(); c.address = "수동 주소"; c.supplementAsked = ["hydrant:connection"]
        c = try store.add(data: image(), source: .prototypeCamera, role: .incident, date: start, to: c, slot: .first)
        c = try store.add(data: image(), source: .prototypeCamera, role: .incident, date: start.addingTimeInterval(65), to: c, slot: .second)
        c = try store.add(data: image(), source: .prototypeCamera, role: .incident, date: start.addingTimeInterval(200), to: c, slot: .supplemental)
        return c
    }

    func testReplacingKeepsTheOtherPhotoAndOrdersByTakenTime() throws {
        let (store, folder) = store(); let c = try pairWithSupplement(store)
        let (first, second, supplement) = (c.primaryPair[0], c.primaryPair[1], c.evidence[2])
        let next = try store.replacePrimary(data: image(.red), source: .album, date: start.addingTimeInterval(300), location: nil, replacing: first.id, in: c)
        // 1번째를 더 늦은 사진으로 바꾸면 남은 사진이 1번째, 새 사진이 2번째가 된다
        XCTAssertEqual(next.primaryPair.map(\.id).first, second.id)
        XCTAssertEqual(next.primaryPair[1].source, .album)
        XCTAssertEqual(next.intervalSeconds, 235)
        // 보완사진은 함께 빠지고 보완 요청 기록도 비운다. 다시 판독해야 한다.
        XCTAssertEqual(next.evidence.count, 2); XCTAssertNil(next.supplementAsked)
        XCTAssertGreaterThan(next.review.revision, c.review.revision)
        XCTAssertEqual(next.formOpened, true); XCTAssertEqual(next.address, "수동 주소")
        XCTAssertFalse(exists(folder, first)); XCTAssertFalse(exists(folder, supplement)); XCTAssertTrue(exists(folder, second))
        XCTAssertEqual(store.cases.first?.evidence.map(\.id), next.evidence.map(\.id))
    }

    func testFailedSaveKeepsOldPhotosAndRemovesTheNewFile() throws {
        let failing = Failing(); let (store, folder) = store(failing); let c = try pairWithSupplement(store)
        let before = Set((try FileManager.default.contentsOfDirectory(atPath: folder.path)))
        failing.on = true
        XCTAssertThrowsError(try store.replacePrimary(data: image(.red), source: .album, date: nil, location: nil, replacing: c.primaryPair[0].id, in: c))
        XCTAssertThrowsError(try store.removePrimary(c.primaryPair[0], from: c))
        XCTAssertEqual(Set(try FileManager.default.contentsOfDirectory(atPath: folder.path)), before)
        XCTAssertEqual(store.cases.first?.evidence.map(\.id), c.evidence.map(\.id))
    }

    func testAddingIntoTheEmptySlotMakesTwoAndRefusesAThird() throws {
        let (store, _) = store()
        var c = ZoneCase(); c.version = 2; c.evidenceReview = EvidenceReview()
        c = try store.add(data: image(), source: .album, role: .incident, date: start, to: c, slot: .first)
        c = try store.replacePrimary(data: image(.red), source: .prototypeCamera, date: start.addingTimeInterval(70), location: nil, replacing: nil, in: c)
        XCTAssertEqual(c.primaryPair.count, 2); XCTAssertEqual(c.intervalSeconds, 70)
        XCTAssertThrowsError(try store.replacePrimary(data: image(), source: .album, date: nil, location: nil, replacing: nil, in: c))
        XCTAssertThrowsError(try store.replacePrimary(data: image(), source: .album, date: nil, location: nil, replacing: UUID(), in: c))
    }

    func testPhotoWithoutTakenTimeGoesSecondWithoutInventingTime() throws {
        let (store, _) = store(); let c = try pairWithSupplement(store)
        let next = try store.replacePrimary(data: image(.red), source: .album, date: nil, location: nil, replacing: c.primaryPair[1].id, in: c)
        XCTAssertEqual(next.primaryPair[0].id, c.primaryPair[0].id); XCTAssertNil(next.primaryPair[1].takenAt); XCTAssertNil(next.intervalSeconds)
    }

    func testRemovingMovesTheRemainingPhotoToFirst() throws {
        let (store, folder) = store(); let c = try pairWithSupplement(store)
        let next = try store.removePrimary(c.primaryPair[0], from: c)
        XCTAssertEqual(next.evidence.map(\.id), [c.primaryPair[1].id]); XCTAssertEqual(next.evidence.first?.primarySlot, .first)
        XCTAssertFalse(exists(folder, c.primaryPair[0])); XCTAssertFalse(exists(folder, c.evidence[2]))
        XCTAssertEqual(next.reportChecks.first { $0.id == "interval" }?.detail, "사진이 두 장 필요합니다.")
    }

    func testFormOpenedIsOptionalForOldDrafts() throws {
        let data = try JSONEncoder().encode([ZoneCase()])
        XCTAssertFalse(String(decoding: data, as: UTF8.self).contains("formOpened"))
        XCTAssertNil(try JSONDecoder().decode([ZoneCase].self, from: data).first?.formOpened)
    }
}
