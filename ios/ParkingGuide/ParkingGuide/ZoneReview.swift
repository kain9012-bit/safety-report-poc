import Foundation
import UIKit
import Combine

enum ZoneAnswer: String, Codable, CaseIterable {
    case yes, no, unknown
    var label: String { switch self { case .yes: "보여요"; case .no: "안 보여요"; case .unknown: "모르겠어요" } }
    var appliesLabel: String { switch self { case .yes: "맞아요"; case .no: "아니에요"; case .unknown: "모르겠어요" } }
}
enum ZoneSituation: String, Codable, CaseIterable {
    case parking, traffic, unknown
    var label: String { switch self { case .parking: "주정차·충전구역 문제"; case .traffic: "운행 중 교통위반"; case .unknown: "어떤 유형인지 모르겠어요" } }
    var route: String { switch self { case .parking: "불법 주정차 → 유형·관할 요건 확인"; case .traffic: "자동차·교통위반 · 상황에 맞는 유형 확인"; case .unknown: "신고 분야 추가 확인" } }
}
enum ZoneRole: String, Codable, CaseIterable {
    case incident, sign, overview
    var label: String { switch self { case .incident: "차량·주차면"; case .sign: "표지 상세"; case .overview: "구역 전경" } }
    var tip: String { switch self {
    case .incident: "차량번호와 차량이 있는 주차면을 함께 담아 주세요."
    case .sign: "전용·겸용 문구와 적용 범위를 읽을 수 있게 담아 주세요."
    case .overview: "차량, 주차구획, 주변 충전시설의 위치 관계를 담아 주세요."
    } }
}
enum ZoneSource: String, Codable {
    case prototypeCamera = "prototype_camera", album, videoFrame = "video_frame", synthetic, unknown
    var label: String { switch self { case .prototypeCamera: "시제품에서 촬영"; case .album: "휴대폰 사진"; case .videoFrame: "영상 추출 장면"; case .synthetic: "합성 예시"; case .unknown: "출처 미확인" } }
}
struct ZoneEvidence: Codable, Identifiable {
    let id: UUID
    var roles: [ZoneRole]
    let source: ZoneSource
    let filename: String
    let takenAt: Date?
    let addedAt: Date
    var primarySlot: PrimarySlot?
    let location: LocationRecord?
    var targetLink: EvidenceTargetLink?
    init(id: UUID, roles: [ZoneRole], source: ZoneSource, filename: String, takenAt: Date? = nil, addedAt: Date, primarySlot: PrimarySlot? = nil, location: LocationRecord? = nil, targetLink: EvidenceTargetLink? = nil) {
        self.id = id; self.roles = roles; self.source = source; self.filename = filename; self.takenAt = takenAt
        self.addedAt = addedAt; self.primarySlot = primarySlot; self.location = location; self.targetLink = targetLink
    }
}
struct ZoneIssue: Identifiable {
    var id: String
    var title: String
    var detail: String
    var target: String
}
struct ZoneCase: Codable, Identifiable {
    var id = UUID()
    var version = 1
    var step = 0
    var createdAt = Date()
    var updatedAt = Date()
    var situation = ZoneSituation.parking
    var dedicatedSign = ZoneAnswer.unknown
    var sharedSign = ZoneAnswer.unknown
    var appliesToBay = ZoneAnswer.unknown
    var address = ""
    var facility = ""
    var level = ""
    var bay = ""
    var body = ""
    var evidence: [ZoneEvidence] = []
    var reviewerNote = ""
    var supplement = ""
    var supplementEdited = false
    var evidenceReview: EvidenceReview?

    static let sourceNote = "시제품 사진과 휴대폰 사진은 공식 안전신문고 촬영본으로 확인되지 않습니다. 실제 신고는 공식 앱의 촬영 방법과 관할 기준을 확인해 주세요."
    var finding: String {
        if appliesToBay == .no { return "표지 적용 주차면 확인 필요" }
        if sharedSign == .yes { return "겸용 안내 관찰 · 운영 근거 미확인" }
        if dedicatedSign == .yes { return "전용·충전 표시 관찰 · 운영 근거 미확인" }
        return "구역 성격 미확인"
    }
    var issues: [ZoneIssue] {
        if evidenceReview != nil {
            var current: [ZoneIssue] = []
            if primaryPair.count < 2 { current.append(.init(id: "primary", title: "기본 사진 두 장 확인", detail: "보완사진과 별도로 기본 사진을 정해 주세요. 사진 없이도 현재 초안은 저장할 수 있습니다.", target: "incident")) }
            for (key, title) in review.selectedType.questions {
                let answer = review.answer(review.selectedType.rawValue + "." + key)
                if answer.answer == .unknown || answer.revision != review.revision || answer.photoIDs.isEmpty {
                    current.append(.init(id: key, title: title, detail: "기존 원본을 먼저 확인하고 이 질문에 필요한 내용만 보완하세요. 다른 정보가 더 보이지 않는다면 모르는 상태로 저장하세요.", target: "incident"))
                }
            }
            if [.hydrant, .busstop, .corner].contains(review.selectedType) { current.append(.init(id: "distance", title: "실제 거리 미확인", detail: "사진의 픽셀 간격·휴대폰 GPS로 실제 거리를 확정하지 않습니다. 거리만 미확인이면 같은 전경의 반복 촬영을 요구하지 않습니다.", target: "location")) }
            if review.selectedType == .evcharging { current.append(.init(id: "shared", title: "일반 자동차 병행주차 안내", detail: review.shared.finding(signature: reviewSignature), target: "zone")) }
            current.append(.init(id: "source", title: "공식 촬영·관할 요건 별도 확인", detail: Self.sourceNote, target: "route"))
            return current
        }
        var result: [ZoneIssue] = []
        if situation != .parking { result.append(.init(id: "route", title: "신고 경로 확인 필요", detail: "이 화면은 충전·전용구역 확인용입니다. 운행 중 위반 등 다른 상황이면 공식 앱에서 해당 신고 분야를 확인해 주세요.", target: "route")) }
        if sharedSign == .yes { result.append(.init(id: "shared", title: "겸용 운영 근거 미확인", detail: "겸용 표시의 적용 범위와 운영 근거는 담당자가 확인해야 합니다. 다른 방해행위는 별도 검토 대상입니다.", target: "zone")) }
        if dedicatedSign != .yes && sharedSign != .yes { result.append(.init(id: "zone", title: "구역 표시 확인 필요", detail: "충전기나 바닥색만으로 구역을 확정하지 않습니다. 전용·겸용 문구를 확인해 주세요.", target: "zone")) }
        if appliesToBay != .yes { result.append(.init(id: "applies", title: "표지 적용 주차면 확인 필요", detail: "안내판이 차량이 있는 칸에 적용되는지 확인해 주세요. 옆 칸의 표지일 수 있습니다.", target: "zone")) }
        if address.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || (level.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && bay.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty) {
            result.append(.init(id: "location", title: "주차면 위치 확인 필요", detail: "주소와 층·기둥번호·주차면 번호 중 확인 가능한 정보를 남겨 주세요. 모르면 그대로 저장할 수 있습니다.", target: "location"))
        }
        for role in ZoneRole.allCases where !evidence.contains(where: { $0.roles.contains(role) }) {
            result.append(.init(id: role.rawValue, title: "\(role.label) 자료 확인 필요", detail: role.tip, target: role.rawValue))
        }
        result.append(.init(id: "source", title: "공식 촬영본·관할 요건 별도 확인", detail: Self.sourceNote, target: "route"))
        return result
    }
    var suggestedSupplement: String {
        let needs = issues.filter { !["source", "route"].contains($0.id) }
        if needs.isEmpty { return "구역·위치·사진 역할을 입력했습니다. 사진의 실제 내용, 구역 운영 근거, 공식 촬영본과 관할 기준은 담당자가 별도로 확인해야 합니다." }
        return "현재 자료에서 다음 사항을 추가 확인해야 합니다.\n" + needs.map { "• \($0.detail)" }.joined(separator: "\n") + "\n기존 자료와 작성한 내용은 유지됩니다."
    }
}

/// Only a completed write may clear a previous save failure.
struct ZoneDraftSaveState {
    var status = "기기에 저장됨"
    var error: String?

    mutating func saved() { status = "기기에 저장됨"; error = nil }
    mutating func failed(_ message: String) { status = "저장 실패"; error = message }

    @MainActor @discardableResult
    mutating func persist(_ draft: ZoneCase, in store: ZoneStore) -> Bool {
        do { try store.save(draft); saved(); return true }
        catch {
            failed("저장을 완료하지 못했습니다. 입력 내용은 화면에 유지됩니다. 다시 저장해 주세요.")
            return false
        }
    }
}

/// Separate storage leaves the existing TrialPhotos index and media untouched.
@MainActor final class ZoneStore: ObservableObject {
    @Published private(set) var cases: [ZoneCase] = []
    @Published var error: String?
    private let folder: URL
    private let writer: (Data, URL) throws -> Void
    private var ready = false
    init(folder: URL? = nil, writer: @escaping (Data, URL) throws -> Void = { data, url in
        try data.write(to: url, options: [.atomic, .completeFileProtection])
    }) {
        self.folder = folder ?? URL.applicationSupportDirectory.appendingPathComponent("ZoneCases", isDirectory: true)
        self.writer = writer
        do {
            try FileManager.default.createDirectory(at: self.folder, withIntermediateDirectories: true)
            var local = self.folder; var values = URLResourceValues(); values.isExcludedFromBackup = true
            try local.setResourceValues(values)
            let index = self.folder.appendingPathComponent("index.json")
            if FileManager.default.fileExists(atPath: index.path) { cases = try JSONDecoder().decode([ZoneCase].self, from: Data(contentsOf: index)) }
            ready = true
        } catch { self.error = "구역 초안을 읽지 못했습니다. 기존 파일은 유지됩니다. \(error.localizedDescription)" }
    }
    func save(_ value: ZoneCase) throws {
        guard ready else { throw CocoaError(.fileReadCorruptFile) }
        var next = value; next.updatedAt = Date()
        var updated = cases.filter { $0.id != next.id }; updated.insert(next, at: 0)
        try writer(JSONEncoder().encode(updated), folder.appendingPathComponent("index.json"))
        cases = updated
    }
    func add(data: Data, source: ZoneSource, role: ZoneRole, date: Date?, to draft: ZoneCase, replacing: UUID? = nil, slot: PrimarySlot? = nil, location: LocationRecord? = nil) throws -> ZoneCase {
        guard ready, data.count > 0, data.count <= 25 * 1024 * 1024, UIImage(data: data) != nil else { throw CocoaError(.fileReadCorruptFile) }
        let old = replacing.flatMap { id in draft.evidence.first { $0.id == id } }
        if replacing != nil && old == nil { throw CocoaError(.fileNoSuchFile) }
        let item = ZoneEvidence(id: UUID(), roles: old?.roles ?? [role], source: source, filename: "\(UUID().uuidString).image", takenAt: date, addedAt: Date(), primarySlot: old?.primarySlot ?? slot ?? .supplemental, location: location)
        let url = folder.appendingPathComponent(item.filename)
        do {
            try data.write(to: url, options: [.atomic, .completeFileProtection])
            var next = draft
            if let replacing, let i = next.evidence.firstIndex(where: { $0.id == replacing }) { next.evidence[i] = item }
            else { next.evidence.append(item) }
            if let assigned = item.primarySlot, assigned != .supplemental {
                for index in next.evidence.indices where next.evidence[index].id != item.id && next.evidence[index].primarySlot == assigned {
                    next.evidence[index].primarySlot = .supplemental
                }
            }
            next.invalidateEvidenceReview()
            try save(next)
            if let old { try? FileManager.default.removeItem(at: folder.appendingPathComponent(old.filename)) }
            return next
        } catch { try? FileManager.default.removeItem(at: url); throw error }
    }
    func remove(_ evidence: ZoneEvidence, from draft: ZoneCase) throws -> ZoneCase {
        var next = draft; next.evidence.removeAll { $0.id == evidence.id }; next.invalidateEvidenceReview()
        try save(next)
        try? FileManager.default.removeItem(at: folder.appendingPathComponent(evidence.filename))
        return next
    }
    func delete(_ draft: ZoneCase) throws {
        guard ready else { throw CocoaError(.fileReadCorruptFile) }
        let updated = cases.filter { $0.id != draft.id }
        try writer(JSONEncoder().encode(updated), folder.appendingPathComponent("index.json"))
        cases = updated
        for item in draft.evidence { try? FileManager.default.removeItem(at: folder.appendingPathComponent(item.filename)) }
    }
    func data(_ evidence: ZoneEvidence) throws -> Data { try Data(contentsOf: folder.appendingPathComponent(evidence.filename)) }
    func image(_ evidence: ZoneEvidence) -> UIImage? { UIImage(contentsOfFile: folder.appendingPathComponent(evidence.filename).path) }
}
