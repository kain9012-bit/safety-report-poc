import Foundation
import CoreLocation
import CoreMotion
import Combine
import UIKit

/// Observation and legal eligibility deliberately remain separate.
enum EvidenceType: String, Codable, CaseIterable, Identifiable {
    case hydrant, crossing, corner, busstop, schoolzone, sidewalk, disabled, firelane, evcharging, other
    var id: String { rawValue }
    var label: String { switch self {
    case .hydrant: "소화전"; case .crossing: "횡단보도"; case .corner: "교차로 모퉁이"; case .busstop: "버스정류소"
    case .schoolzone: "어린이보호구역"; case .sidewalk: "인도"; case .disabled: "장애인전용주차구역"
    case .firelane: "소방차전용구역"; case .evcharging: "친환경차 충전구역"; case .other: "기타·직접 확인"
    } }
    var guidance: String { switch self {
    case .hydrant: "차량과 소화전·소방용수시설 표시를 함께 확인해 주세요. 작게 보이면 보관한 원본을 먼저 확대해 보세요."
    case .crossing: "차량과 횡단보도 흰 줄·경계를 함께 확인해 주세요. 정지선만 보이는 경우는 구분해 주세요."
    case .corner: "차량과 만나는 도로·도로 가장자리를 함께 확인해 주세요. 사진만으로 5m를 측정하지 않아요."
    case .busstop: "차량과 같은 쪽 정류소 표지·공개 번호를 확인해 주세요. 반대편 정류소와 구분해 주세요."
    case .schoolzone: "어린이보호구역 글씨·표지가 이 도로에 적용되는지 확인해 주세요. 붉은 바닥이나 숫자 30만으로 확정하지 않아요."
    case .sidewalk: "차량 바퀴·보도 경계·보행 공간을 함께 확인해 주세요. 진입로와 주차구획은 추가 확인해 주세요."
    case .disabled: "장애인 주차 표시가 차량이 있는 칸에 이어지는지 확인해 주세요. 차량 표지의 유효성·탑승 여부는 사진만으로 확정하지 않아요."
    case .firelane: "소방차전용구역 글씨·구획과 차량 위치를 함께 확인해 주세요. 노란 선만으로 확정하지 않아요."
    case .evcharging: "차량이 있는 칸에 표지와 충전기가 각각 연결되는지 확인해 주세요. 일반차 허용 안내가 있으면 적용 칸·시간을 함께 남겨 주세요."
    case .other: "직접 본 내용을 적고 모르는 내용은 그대로 저장하세요. 유형을 모른다고 자료가 삭제되지 않아요."
    } }
    var questions: [(String, String)] {
        if self == .other { return [] }
        var result = [("identity", identityQuestion), ("markingToTarget", "그 표시·경계가 대상 차량이 있는 곳에 적용되나요?"), ("vehicleRelation", relationQuestion)]
        if self == .evcharging { result.append(("chargerToTarget", "충전기가 대상 차량이 있는 칸용인지 확인되나요?")) }
        return result
    }
    private var identityQuestion: String { switch self {
    case .hydrant: "소화전 본체 또는 소방용수시설임을 읽을 수 있는 표시가 보이나요?"
    case .crossing: "주차선·정지선과 구별되는 횡단보도와 경계가 보이나요?"
    case .corner: "도로가 만나는 구조와 실제 도로 가장자리를 확인할 수 있나요?"
    case .busstop: "버스정류소임을 확인할 표지·공개 번호가 보이나요?"
    case .schoolzone: "어린이보호구역이라는 문구·표지가 보이나요?"
    case .sidewalk: "보행 공간과 차도·주차구획의 경계를 확인할 수 있나요?"
    case .disabled: "장애인 주차 그림·문구와 해당 구획이 보이나요?"
    case .firelane: "소방차전용구역 문구와 해당 구획이 보이나요?"
    case .evcharging: "충전구역·전용·우선·겸용 중 어떤 표시인지 읽을 수 있나요?"
    case .other: "표시가 보이나요?"
    } }
    private var relationQuestion: String { switch self {
    case .hydrant, .busstop, .corner: "대상 차량과 확인한 시설·모퉁이가 같은 위치임을 연결할 수 있나요?"
    case .schoolzone: "대상 차량과 표시가 같은 도로·적용 방향에 있나요?"
    default: "차량의 실제 접지 위치·점유 범위를 경계와 함께 확인할 수 있나요?"
    } }
}
enum PrimarySlot: String, Codable, CaseIterable { case first, second, supplemental
    var label: String { switch self { case .first: "기본 사진 1"; case .second: "기본 사진 2"; case .supplemental: "보완 사진" } }
}
struct EvidenceAnswer: Codable { var answer: ZoneAnswer = .unknown; var photoIDs: [UUID] = []; var revision: Int = 0 }
struct LocationRecord: Codable, Equatable {
    var latitude: Double; var longitude: Double; var accuracy: Double; var measuredAt: Date
    var sampleCount: Int; var spread: Double; var quality: String
    var heading: Double?; var headingAccuracy: Double?; var headingMeasuredAt: Date?
    var cameraDirection: CameraDirection?
    var receivedAt: Date? = nil
    var source = "device_location"; var headingSource = "device_top_compass_not_camera"
}
struct SelectedLocation: Codable { var latitude: Double; var longitude: Double; var selectedAt: Date; var source = "user_map" }
struct SharedParkingReview: Codable {
    var observed = ZoneAnswer.unknown
    var kind = "unclear"
    var noticeText = ""
    var appliesToBay = ZoneAnswer.unknown
    var appliesAtPhotoTime = ZoneAnswer.unknown
    var conditionsComplete = ZoneAnswer.unknown
    var conflicting = ZoneAnswer.unknown
    var scope = ""
    var timeConditions = ""
    var source = ""
    var photoIDs: [UUID] = []
    var reviewedSignature: String?
    var photoTimeEvidenceAvailable: Bool?
    func finding(signature: String) -> String {
        if observed != .yes { return "일반차 허용 안내 미확인 · 허용·금지 확정 안 됨" }
        if reviewedSignature != signature { return "안내·차량 위치·사진 시각 재확인 필요" }
        if kind == "ev_extra_time" { return "전기차 시간 안내 · 일반차 허용 근거는 미확인" }
        if conflicting == .yes { return "서로 다른 안내가 있어 확인 필요" }
        if ["general_car", "both"].contains(kind), !noticeText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
           appliesToBay == .yes, appliesAtPhotoTime == .yes, photoTimeEvidenceAvailable == true, conditionsComplete == .yes, conflicting == .no, !photoIDs.isEmpty {
            return "일반차 병행주차 안내의 칸·시각 조건 확인 입력 · 운영 근거·다른 방해행위 별도 확인"
        }
        return "일반차 병행주차 안내 관찰 · 적용 칸·촬영 시각·조건 확인 필요"
    }
}
struct EvidenceTargetLink: Codable {
    var sameVehicle = ZoneAnswer.unknown
    var samePlace = ZoneAnswer.unknown
    var primaryIDs: [UUID] = []
    func usable(for ids: [UUID]) -> Bool { !ids.isEmpty && primaryIDs == ids && sameVehicle == .yes && samePlace == .yes }
}
struct NativeSharedNotice: Codable {
    var kind: String; var text: String; var bay: String; var time: String; var conditions: String; var issuer: String
}
struct NativeBusStopPhoto: Codable {
    var publicId: String; var name: String; var readable: Bool
    var publicIdNamespace: String? = nil
}
struct NativeAIObservation: Codable, Identifiable {
    var id = UUID(); var photoID: UUID; var type: EvidenceType; var identity: String; var target: String; var relation: String; var text: String
    var unknownReasons: [String]
    var sharedNotice: NativeSharedNotice?
    var busStop: NativeBusStopPhoto? = nil
    var boundary: String? = nil
    var chargerToTarget: String? = nil
    var zoneKind: String? = nil
    var identityDetail: String? = nil
}
struct NativeAITargetLink: Codable {
    var referencePhotoID: UUID; var sameVehicle: String; var samePlace: String; var evidence: String
}
/// 바퀴가 닿은 바닥(사진 한 장) — 웹 GroundRead 와 같다. 횡단보도·인도 '위'는 이 답으로만 정한다.
struct NativeGround: Codable, Equatable {
    struct Wheel: Codable, Equatable { var wheel: String; var surface: String }
    /// roadway·crosswalk·sidewalk·both·unclear
    var surface: String
    var wheels: [Wheel]
    /// on·adjacent·apart·none·unclear
    var crosswalkRelation: String
    var evidence: String

    /// 웹 normalizeGround 와 같은 규칙 — 바퀴 답과 전체 답이 어긋나면 전체 답을 모름으로 둔다
    static func normalize(_ raw: Any?) -> NativeGround? {
        guard let r = raw as? [String: Any] else { return nil }
        let wheelSurfaces = ["roadway", "crosswalk_stripe", "sidewalk_block", "curb", "unclear"]
        let wheels: [Wheel] = (r["wheels"] as? [[String: Any]] ?? []).prefix(8).compactMap { w in
            guard let s = w["surface"] as? String, wheelSurfaces.contains(s) else { return nil }
            return Wheel(wheel: String((w["wheel"] as? String ?? "").prefix(40)), surface: s)
        }
        var surface = r["surface"] as? String ?? "unclear"
        if !["roadway", "crosswalk", "sidewalk", "both", "unclear"].contains(surface) { surface = "unclear" }
        let cross = wheels.contains { $0.surface == "crosswalk_stripe" }, side = wheels.contains { $0.surface == "sidewalk_block" }
        let fromWheels = cross && side ? "both" : cross ? "crosswalk" : side ? "sidewalk" : (!wheels.isEmpty && wheels.allSatisfy { $0.surface == "roadway" }) ? "roadway" : "unclear"
        if fromWheels != "unclear" && fromWheels != surface { surface = "unclear" }
        var relation = r["crosswalkRelation"] as? String ?? "unclear"
        if !["on", "adjacent", "apart", "none", "unclear"].contains(relation) { relation = "unclear" }
        return NativeGround(surface: surface, wheels: wheels, crosswalkRelation: relation, evidence: String((r["evidence"] as? String ?? "").prefix(300)))
    }
    /// 횡단보도·인도 '위' — yes/no/unclear
    func on(_ type: EvidenceType) -> String {
        if surface == "unclear" { return "unclear" }
        return surface == "both" || surface == (type == .crossing ? "crosswalk" : "sidewalk") ? "yes" : "no"
    }
}
/// 사진 한 장에서 AI 가 읽은 번호판(웹 PhotoRead.plate 와 같다)
struct NativePlateRead: Codable, Equatable {
    var text: String; var readable: Bool; var confidence: Double
    /// 차가 여러 대라 서버가 대상 차를 정하지 못해 번호를 비운 이유(웹 targetNote 와 같은 말). 분명하거나 이전 판독이면 nil
    var targetNote: String? = nil
    static func normalize(_ raw: Any?, target: Any? = nil) -> NativePlateRead? {
        guard let r = raw as? [String: Any] else { return nil }
        let text = String((r["text"] as? String ?? "").filter { !$0.isWhitespace }.prefix(20))
        let confidence = (r["confidence"] as? NSNumber)?.doubleValue ?? 0
        return NativePlateRead(text: text, readable: r["readable"] as? Bool == true && !text.isEmpty, confidence: confidence.isFinite ? min(1, max(0, confidence)) : 0, targetNote: note(target))
    }
    /// 서버 응답의 target(대상 차) → 안내 문구. src/lib/target.ts targetNote 와 같게 둔다
    static func note(_ target: Any?) -> String? {
        guard let t = target as? [String: Any], let status = t["status"] as? String, status != "clear" else { return nil }
        if status == "none" { return "사진에서 신고할 차를 찾지 못함" }
        switch t["reason"] as? String {
        case "multiple_plates": return "번호판이 보이는 차가 여러 대라 신고할 차를 정하지 못함"
        case "other_plate_only": return "가운데 차의 번호판은 안 보이고 다른 차 번호판만 보임"
        default: return "차가 여러 대라 신고할 차를 정하지 못함"
        }
    }
}
struct NativeAIResult: Codable {
    var revision: Int; var photoIDs: [UUID]; var generatedAt: Date; var recommendedTypes: [EvidenceType]
    var observations: [NativeAIObservation]; var summary: String; var model: String
    var targetLinks: [String: NativeAITargetLink]?
    var responseFormat: String? = nil
    var compatibilityNotes: [String]? = nil
    var legacyReads: [NativeLegacyPhotoRead]? = nil
    /// 사진 ID → 바퀴가 닿은 바닥. 이전 판독에는 없다(그때는 횡단보도·인도 '위'를 확인하지 않은 것으로 본다).
    var grounds: [String: NativeGround]? = nil
    /// 기본 사진 ID → 그 사진에서 읽은 번호판. 이전 판독에는 없다(그때는 판독 결과가 없는 것으로 본다).
    var plates: [String: NativePlateRead]? = nil
}
/// A user-selected search rectangle. It is not an observation or a new photo.
struct EvidenceRegion: Codable {
    var type: EvidenceType
    var box: [Double]
    var selectedAt = Date()
    var source = "user_region"
    var isValid: Bool {
        type != .other && box.count == 4 && box.allSatisfy { $0.isFinite && $0 >= 0 && $0 <= 1000 } && box[2] > box[0] && box[3] > box[1]
    }
    static func box(from start: CGPoint, to end: CGPoint, within size: CGSize) -> [Double]? {
        guard size.width.isFinite, size.height.isFinite, size.width > 0, size.height > 0,
              start.x.isFinite, start.y.isFinite, end.x.isFinite, end.y.isFinite else { return nil }
        func clamp(_ value: CGFloat) -> Double { Double(min(1000, max(0, value))) }
        let x0 = clamp(min(start.x, end.x) / size.width * 1000), x1 = clamp(max(start.x, end.x) / size.width * 1000)
        let y0 = clamp(min(start.y, end.y) / size.height * 1000), y1 = clamp(max(start.y, end.y) / size.height * 1000)
        guard x1 > x0, y1 > y0 else { return nil }
        return [y0, x0, y1, x1]
    }
}

struct EvidenceReview: Codable {
    var revision = 0
    var selectedType = EvidenceType.other
    var selectionSource = "user"
    var answers: [String: EvidenceAnswer] = [:]
    var shared = SharedParkingReview()
    var selectedLocation: SelectedLocation?
    var stopSearch: NativeStopSearch?
    var aiResult: NativeAIResult?
    var regionHints: [String: EvidenceRegion]?
    func answer(_ key: String) -> EvidenceAnswer { answers[key] ?? EvidenceAnswer() }
}
extension ZoneCase {
    var review: EvidenceReview { get { evidenceReview ?? EvidenceReview() } set { evidenceReview = newValue } }
    var reviewSignature: String {
        [String(review.revision), level, bay, evidence.map { "\($0.id)|\($0.takenAt?.timeIntervalSince1970.description ?? "unknown")|\($0.primarySlot?.rawValue ?? "unassigned")" }.joined(separator: ",")].joined(separator: "|")
    }
    /// Fill missing main slots first; additions after both exist remain supplemental.
    var nextCaptureSlot: PrimarySlot {
        if !evidence.contains(where: { $0.primarySlot == .first }) { return .first }
        if !evidence.contains(where: { $0.primarySlot == .second }) { return .second }
        return .supplemental
    }
    var primaryPair: [ZoneEvidence] { [PrimarySlot.first, .second].compactMap { slot in evidence.first { $0.primarySlot == slot } } }
    var primaryPairSummary: String {
        guard primaryPair.count == 2, let first = primaryPair[0].takenAt, let second = primaryPair[1].takenAt else { return "기본 사진 두 장·촬영 시각 확인 필요" }
        let seconds = second.timeIntervalSince(first)
        if seconds < 0 { return "기본 사진 시각 순서 재확인 필요" }
        return "기본 사진 시각 차이 \(Int(seconds))초 · 관할 시간 기준·계속 정차는 별도 확인"
    }
    var manualCandidates: [EvidenceType] {
        EvidenceType.allCases.filter { type in
            !type.questions.isEmpty && type.questions.allSatisfy { key, _ in
                let a = review.answer(type.rawValue + "." + key)
                return a.answer == .yes && a.revision == review.revision && !a.photoIDs.isEmpty && a.photoIDs.allSatisfy { id in evidence.contains { $0.id == id && evidenceEligible($0) } }
            }
        }
    }
    func evidenceEligible(_ photo: ZoneEvidence) -> Bool {
        if primaryPair.contains(where: { $0.id == photo.id }) || photo.targetLink?.usable(for: primaryPair.map(\.id)) == true { return true }
        guard let result = review.aiResult, result.revision == review.revision, let link = result.targetLinks?[photo.id.uuidString] else { return false }
        return link.sameVehicle == "yes" && link.samePlace == "yes" && primaryPair.contains { $0.id == link.referencePhotoID }
    }
    var nativeRegionHints: [UUID: [NativeRegionHint]] {
        var result: [UUID: [NativeRegionHint]] = [:]
        for photo in evidence {
            guard let hint = review.regionHints?[photo.id.uuidString], hint.isValid else { continue }
            result[photo.id] = [NativeRegionHint(type: hint.type, box: hint.box)]
        }
        return result
    }
    @discardableResult mutating func setAnalysisRegion(_ region: EvidenceRegion?, for photoID: UUID) -> Bool {
        guard evidence.contains(where: { $0.id == photoID }), region == nil || region?.isValid == true else { return false }
        var next = review
        let previous = next.regionHints?[photoID.uuidString]
        if previous == nil && region == nil { return false }
        if let previous, let region, previous.type == region.type, previous.box == region.box { return false }
        var hints = next.regionHints ?? [:]
        if let region { hints[photoID.uuidString] = region } else { hints.removeValue(forKey: photoID.uuidString) }
        next.regionHints = hints.isEmpty ? nil : hints
        // Keep typed answers and previous analysis for review; their older revision is no longer current.
        next.revision += 1
        evidenceReview = next
        return true
    }
    mutating func invalidateEvidenceReview() { var next = review; next.revision += 1; evidenceReview = next }
}

/// Location age and sample consistency are quality hints, never distance proof.
enum CaptureLocationQuality {
    static func record(_ samples: [CLLocation], at date: Date, heading: CLHeading? = nil) -> LocationRecord? {
        let valid = samples.filter { $0.timestamp <= date && $0.horizontalAccuracy.isFinite && $0.horizontalAccuracy >= 0 && CLLocationCoordinate2DIsValid($0.coordinate) }.sorted { $0.timestamp < $1.timestamp }
        guard let last = valid.last else { return nil }
        var seen = Set<Date>()
        let unique = Array(valid.filter { date.timeIntervalSince($0.timestamp) <= 10 && seen.insert($0.timestamp).inserted }.suffix(20))
        let spread = unique.map { $0.distance(from: last) }.max() ?? 0
        let fresh = date.timeIntervalSince(last.timestamp) <= 5
        let consistent = unique.count >= 3 && unique.enumerated().allSatisfy { index, a in
            unique.dropFirst(index + 1).allSatisfy { b in a.distance(from: b) <= a.horizontalAccuracy + b.horizontalAccuracy }
        }
        let quality = !fresh ? "위치 오래됨" : last.horizontalAccuracy > 50 ? "지도 확인 필요" : !consistent ? "위치 변동·샘플 부족" : last.horizontalAccuracy <= 20 ? "주변 탐색 참고" : "넓은 범위로 참고"
        let validHeading = heading.flatMap { h -> CLHeading? in h.headingAccuracy >= 0 && h.timestamp <= date && date.timeIntervalSince(h.timestamp) <= 5 ? h : nil }
        return LocationRecord(latitude: last.coordinate.latitude, longitude: last.coordinate.longitude, accuracy: last.horizontalAccuracy, measuredAt: last.timestamp, sampleCount: unique.count, spread: spread, quality: quality, heading: validHeading.map { $0.trueHeading >= 0 ? $0.trueHeading : $0.magneticHeading }, headingAccuracy: validHeading?.headingAccuracy, headingMeasuredAt: validHeading?.timestamp)
    }
}
@MainActor final class CaptureLocation: NSObject, ObservableObject, CLLocationManagerDelegate {
    @Published private(set) var status = "위치 사용 안 함 · 사진은 저장할 수 있어요"
    private let motion = CMMotionManager()
    private var direction: CameraDirection?
    private var directionHistory: [CameraDirection] = []
    private let manager = CLLocationManager(); private var samples: [(value: CLLocation, receivedAt: Date)] = []; private var heading: CLHeading?; private var headingReceivedAt: Date?
    private var expiry: Task<Void, Never>?
    override init() { super.init(); manager.delegate = self; manager.desiredAccuracy = kCLLocationAccuracyBest; manager.headingOrientation = .portrait }
    func start() {
        expiry?.cancel(); samples = []; heading = nil; headingReceivedAt = nil
        if manager.authorizationStatus == .notDetermined { manager.requestWhenInUseAuthorization(); status = "위치 권한 확인 중"; return }
        guard [.authorizedAlways, .authorizedWhenInUse].contains(manager.authorizationStatus) else { status = "위치 권한 없음 · 수동 입력 가능"; return }
        status = "위치 확인 중 · 촬영은 바로 가능"; manager.startUpdatingLocation()
        direction = nil; directionHistory = []
        if motion.isDeviceMotionAvailable, CMMotionManager.availableAttitudeReferenceFrames().contains(.xTrueNorthZVertical) {
            motion.deviceMotionUpdateInterval = 0.1
            motion.startDeviceMotionUpdates(using: .xTrueNorthZVertical, to: .main) { [weak self] sample, _ in
                guard let self, let sample else { return }
                let date = Date(timeIntervalSinceNow: sample.timestamp - ProcessInfo.processInfo.systemUptime)
                let calibrated = (sample.magneticField.accuracy == .medium || sample.magneticField.accuracy == .high) && self.heading.map { $0.trueHeading >= 0 && abs(date.timeIntervalSince($0.timestamp)) <= 1 } == true
                guard var projected = CameraDirectionProjection.project(sample.attitude.rotationMatrix, measuredAt: date, trueNorth: true, calibrated: calibrated, compassAccuracy: self.heading?.headingAccuracy) else { self.direction = nil; self.directionHistory = []; return }
                projected.receivedAt = Date()
                self.directionHistory = self.directionHistory.filter { date.timeIntervalSince($0.measuredAt) <= 1 }
                self.directionHistory.append(projected)
                let stable = self.directionHistory.count >= 2 && self.directionHistory.allSatisfy { value in
                    let difference = abs(value.bearing - projected.bearing)
                    return min(difference, 360 - difference) <= 30
                }
                self.direction = stable ? projected : nil
            }
        }
        if CLLocationManager.headingAvailable() { manager.startUpdatingHeading() }
        expiry = Task { [weak self] in
            try? await Task.sleep(for: .seconds(15)); guard !Task.isCancelled else { return }
            self?.stop(); self?.status = "위치 수신 종료 · 촬영 전 다시 확인 가능"
        }
    }
    func stop() { motion.stopDeviceMotionUpdates(); manager.stopUpdatingLocation(); manager.stopUpdatingHeading(); expiry?.cancel() }
    func snapshot(at date: Date) -> LocationRecord? {
        let eligible = samples.filter { $0.receivedAt <= date }
        let eligibleHeading = headingReceivedAt.map { $0 <= date } == true ? heading : nil
        var record = CaptureLocationQuality.record(eligible.map(\.value), at: date, heading: eligibleHeading)
        let measuredAt = record?.measuredAt
        record?.receivedAt = eligible.last(where: { $0.value.timestamp == measuredAt })?.receivedAt
        if let direction, direction.measuredAt <= date, direction.receivedAt.map({ $0 <= date }) == true, date.timeIntervalSince(direction.measuredAt) <= 1 { record?.cameraDirection = direction }
        return record
    }
    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        if [.authorizedAlways, .authorizedWhenInUse].contains(manager.authorizationStatus), status == "위치 권한 확인 중" { start() }
    }
    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        let received = Date()
        for location in locations where !samples.contains(where: { $0.value.timestamp == location.timestamp }) { samples.append((location, received)) }
        samples.sort { $0.value.timestamp < $1.value.timestamp }
        let latest = samples.last?.value.timestamp
        samples = Array(samples.filter { received.timeIntervalSince($0.value.timestamp) <= 10 || $0.value.timestamp == latest }.suffix(20))
        if let value = snapshot(at: Date()) { status = "\(value.quality) · 단말 보고 오차 \(Int(value.accuracy))m" }
    }
    func locationManager(_ manager: CLLocationManager, didUpdateHeading newHeading: CLHeading) { heading = newHeading; headingReceivedAt = Date() }
    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) { status = "위치 확인 실패 · 촬영·수동 입력 가능"; stop() }
}

struct CameraDirection: Codable, Equatable {
    var bearing: Double; var measuredAt: Date; var horizontalProjection: Double
    var accuracy: Double? = nil
    var reference: String? = nil
    var receivedAt: Date? = nil
    var source = "rear_camera_optical_axis_true_north"
    var status = "estimated_not_field_validated"
}
enum CameraDirectionProjection {
    /// CMAttitude maps reference axes into device coordinates. The rear camera looks
    /// along device -Z; its reference vector is Rᵀ(0,0,-1). Reference +Y points west.
    static func project(_ matrix: CMRotationMatrix, measuredAt: Date, trueNorth: Bool, calibrated: Bool, compassAccuracy: Double?) -> CameraDirection? {
        guard trueNorth, calibrated, let accuracy = compassAccuracy, accuracy >= 0, accuracy <= 30 else { return nil }
        let north = -matrix.m31, east = matrix.m32
        let horizontal = hypot(north, east)
        guard north.isFinite, east.isFinite, horizontal >= 0.25, horizontal <= 1.01 else { return nil }
        let degrees = (atan2(east, north) * 180 / .pi + 360).truncatingRemainder(dividingBy: 360)
        return .init(bearing: degrees, measuredAt: measuredAt, horizontalProjection: horizontal, accuracy: accuracy, reference: "true")
    }
}
