import Foundation

// 웹 main 과 같은 5단계 신고서의 규칙(2026-10-15 결정: 화면은 팀원 main, 개선 로직은 뒤에서).
// 웹의 src/lib/rules.ts · compose.ts · followUps.ts · evidence.ts 와 같은 뜻으로 맞춘다.

enum ReportRules {
    /// 실제 기준(1분). 웹과 같이 지금은 시험용 간격을 쓴다 — 웹 rules.ts INTERVAL_SEC 와 같이 바꾼다.
    static let minIntervalSeconds = 60
    static let testIntervalSeconds = 3
    static var intervalSeconds: Int { min(testIntervalSeconds, minIntervalSeconds) }
    static var intervalNote: String {
        intervalSeconds < minIntervalSeconds ? " (테스트용 \(intervalSeconds)초 기준 · 실제 기준 \(minIntervalSeconds)초)" : ""
    }
    static let bodyMin = 5
    static let bodyMax = 900
    /// 하던 신고를 앱을 열 때 이어서 여는 기간(웹 RESUME_MAX_MS)
    static let resumeWindow: TimeInterval = 36 * 60 * 60
    static let steps = ["유형", "발생지역", "차량번호", "내용", "점검·제출"]
    /// 빨간불 항목을 고치는 단계(웹 fixStep) — 0 유형(사진 칸 포함)·1 발생지역·2 차량번호·3 내용
    static func fixStep(_ id: String) -> Int {
        switch id {
        case "address", "location": 1
        case "plate", "vehicle": 2
        case "body": 3
        default: 0
        }
    }

    static func isValidPlate(_ raw: String) -> Bool {
        let plate = raw.filter { !$0.isWhitespace }
        return plate.range(of: #"^(?:[가-힣]{2})?\d{2,3}[가-힣]\d{4}$"#, options: .regularExpression) != nil
    }

    private static func formatter(_ pattern: String) -> DateFormatter {
        let f = DateFormatter()
        f.locale = Locale(identifier: "ko_KR"); f.timeZone = TimeZone(identifier: "Asia/Seoul"); f.dateFormat = pattern
        return f
    }
    /// 2026-10-15 11:03 (한국 시각)
    static func stamp(_ date: Date) -> String { formatter("yyyy-MM-dd HH:mm").string(from: date) }
    /// 11:03:23 (한국 시각)
    static func clock(_ date: Date) -> String { formatter("HH:mm:ss").string(from: date) }
}

extension EvidenceType {
    /// 웹 VIOLATION_LABEL 과 같은 신고서 이름
    var reportLabel: String { switch self {
    case .hydrant: "소화전 5m 이내"; case .crossing: "횡단보도"; case .corner: "교차로 모퉁이 5m 이내"
    case .busstop: "버스정류소 10m 이내"; case .schoolzone: "어린이보호구역"; case .sidewalk: "인도"
    case .disabled: "장애인전용주차구역"; case .firelane: "소방차전용구역"; case .evcharging: "친환경차 충전·전용구역"
    case .other: "기타 · 직접 확인"
    } }
    /// 웹 SHOW_IN_PHOTO — 무엇이 사진에 나오게 찍어야 하는가(조사까지 붙여 둔다)
    var showInPhoto: String? { switch self {
    case .busstop: "정류장 표지판이나 승강장이"; case .crossing: "횡단보도 흰 줄무늬와 차 바퀴가"
    case .schoolzone: "어린이보호구역 문구·표지가"; case .corner: "교차로 모퉁이가"; case .sidewalk: "보도 위에 올라선 바퀴가"
    case .hydrant: "소화전이나 소방용수 표시가"; case .disabled: "장애인구역 표시와 차 앞유리(표지 자리)가"
    case .firelane: "소방차 전용구역 빗금이나 글씨가"; case .evcharging: "충전기·충전구역 표시와 번호판 색이"
    case .other: nil
    } }
}

/// 사진 근거 요약 — 웹 evidence.summarizeEvidence 와 같은 규칙. 한 사진 안에서 연결이 확인돼야 '확인'이다.
enum ReportEvidence {
    enum Status: String { case observed, needsContext = "needs_context", conflict, notObserved = "not_observed" }
    struct Summary { var type: EvidenceType; var status: Status; var observations: [NativeAIObservation] }
    static let boundaryTypes: Set<EvidenceType> = [.crossing, .sidewalk, .corner, .disabled, .firelane, .evcharging]
    static let conflictReason = "전체 장면과 원본 부분의 관찰이 달라 재확인 필요"

    /// 지금 사진(같은 판독 버전)으로 받은 관찰 중, 기본 사진이거나 기본 사진과 연결이 확인된 사진의 것만 쓴다.
    static func observations(_ draft: ZoneCase) -> [NativeAIObservation] {
        guard let result = draft.review.aiResult, result.revision == draft.review.revision else { return [] }
        return result.observations.filter { o in draft.evidence.first { $0.id == o.photoID }.map(draft.evidenceEligible) == true }
    }
    private static func complete(_ o: NativeAIObservation) -> Bool {
        guard o.identity == "yes", o.target == "yes", o.relation == "yes" else { return false }
        if boundaryTypes.contains(o.type), o.boundary != "yes" { return false }
        if o.type == .evcharging {
            guard let kind = o.zoneKind, kind != "unclear", !kind.isEmpty else { return false }
            if kind == "charging", o.chargerToTarget != "yes" { return false }
        }
        return true
    }
    /// 지금 사진(같은 판독 버전)의 바닥 답 중, 기본 사진이거나 기본 사진과 연결이 확인된 사진의 것만 쓴다
    static func grounds(_ draft: ZoneCase, primaryOnly: Bool = false) -> [NativeGround] {
        guard let result = draft.review.aiResult, result.revision == draft.review.revision, let grounds = result.grounds else { return [] }
        let photos = primaryOnly ? draft.primaryPair : draft.evidence.filter(draft.evidenceEligible)
        return photos.compactMap { grounds[$0.id.uuidString] }
    }
    /// 웹 CROSSWALK_ADJACENT_NOTE 와 같은 문구
    static let crosswalkAdjacentNote = "차가 횡단보도 바로 앞에 서 있는 것으로 보여요(바퀴는 횡단보도 밖). 횡단보도로부터 10m 이내도 정차·주차 금지 장소지만, 거리는 사진으로 확인하지 않았어요."
    /// 횡단보도 바로 앞(바퀴는 횡단보도 밖)으로 읽힌 기본 사진이 있는가 — 유형으로 정하지 않고 따로 알린다(웹 crosswalkAdjacent)
    static func crosswalkAdjacent(_ draft: ZoneCase) -> Bool {
        let g = grounds(draft, primaryOnly: true)
        return g.contains { $0.crosswalkRelation == "adjacent" } && !g.contains { $0.on(.crossing) == "yes" }
    }
    /// 횡단보도·인도 — 표시 관찰은 보여 주기만 하고, 상태는 바퀴가 닿은 바닥 답으로만 정한다(웹 groundSummary)
    private static func groundSummary(_ type: EvidenceType, _ draft: ZoneCase, _ obs: [NativeAIObservation]) -> Summary? {
        let answers = grounds(draft).map { $0.on(type) }
        let yes = answers.contains("yes"), no = answers.contains("no")
        if !yes && obs.isEmpty { return nil }
        let status: Status = yes && no ? .conflict : yes ? .observed : no ? .notObserved : .needsContext
        return Summary(type: type, status: status, observations: obs)
    }
    static func summarize(_ draft: ZoneCase) -> [Summary] {
        let all = observations(draft)
        return EvidenceType.allCases.compactMap { type in
            let obs = all.filter { $0.type == type }
            if type == .crossing || type == .sidewalk { return groundSummary(type, draft, obs) }
            guard !obs.isEmpty else { return nil }
            func values(_ key: KeyPath<NativeAIObservation, String?>) -> [String] { obs.compactMap { $0[keyPath: key] } }
            let fields: [[String]] = [obs.map(\.identity), obs.map(\.target), obs.map(\.relation)]
                + (boundaryTypes.contains(type) ? [values(\.boundary)] : [])
                + (type == .evcharging && obs.contains { $0.zoneKind == "charging" } ? [values(\.chargerToTarget)] : [])
            let conflict = fields.contains { $0.contains("yes") && $0.contains("no") } || obs.contains { $0.unknownReasons.contains(conflictReason) }
            let status: Status = conflict ? .conflict : obs.contains(where: complete) ? .observed
                : obs.allSatisfy { $0.identity == "no" } ? .notObserved : .needsContext
            return Summary(type: type, status: status, observations: obs)
        }
    }
    /// 사진에서 표시·대상 차량·경계가 모두 확인된 유형 — 유형을 자동으로 채우는 유일한 근거
    static func confidentTypes(_ draft: ZoneCase) -> [EvidenceType] { summarize(draft).filter { $0.status == .observed }.map(\.type) }

    // MARK: 유형이 여럿 보일 때 추천 — 웹 lib/choose.ts rankTypes 와 같은 순서(2026-10-23 자문단 결론)
    // 단속 시간 안 → 사진만으로 확인되는 유형 → 사진 판독 순서. 과태료로는 고르지 않는다(정보로만 보인다).
    // 한 번 세운 차에 위반이 겹치면 담당 공무원이 가장 무거운 과태료 하나를 매기므로(질서위반행위규제법 제13조 제1항)
    // 신고 유형을 무거운 쪽으로 고를 까닭이 없고, 고르지 않은 유형은 '함께 보인 위반'으로 알린다(officerLines).
    struct TypeOption: Equatable { var type: EvidenceType; var recommended: Bool; var enforceable: Bool; var tier: Int; var reasons: [String] }
    /// 승용 과태료(원) — 웹 localRules FINE_KRW
    static let fineWon: [EvidenceType: Int] = [
        .hydrant: 80_000, .corner: 40_000, .busstop: 40_000, .crossing: 40_000, .schoolzone: 120_000, .sidewalk: 40_000,
        .disabled: 100_000, .firelane: 500_000, .evcharging: 100_000, .other: 40_000,
    ]
    /// 사진만으로는 확인되지 않아 따로 볼 것 — 웹 CHECK_NOTE. 여기 없는 유형은 사진만으로 확인된다
    static let checkNote: [EvidenceType: String] = [
        .hydrant: "소화전과의 거리(5m)는 사진만으로 재지 못합니다", .corner: "모퉁이와의 거리(5m)는 사진만으로 재지 못합니다",
        .busstop: "정류소와의 거리(10m)는 사진만으로 재지 못합니다", .firelane: "과태료 대상 건물(2018. 8. 10. 이후 허가)인지 따로 확인해야 합니다",
        .evcharging: "일반 자동차도 세울 수 있는 칸인지 따로 확인해야 합니다", .disabled: "앞유리에 장애인자동차표지가 없는지 확인되지 않았습니다",
        .other: "사진 자동 판독 대상이 아닙니다",
    ]
    /// 사진 판독 순서(웹 SCENE_TO_TYPE) — 위 → 옆 → 구역 안
    static let sceneOrder: [EvidenceType] = [.crossing, .sidewalk, .hydrant, .busstop, .corner, .firelane, .disabled, .evcharging, .schoolzone]
    /// 0: 사진만으로 확인된다, 1: 따로 확인할 것이 남는다(웹 evidenceTier). 장애인전용구역은 앞유리에 표지가 없는 것까지 보여야 0
    static func evidenceTier(_ type: EvidenceType, _ draft: ZoneCase) -> Int {
        if type == .disabled {
            let flags = (draft.review.aiResult?.legacyReads ?? []).compactMap { $0.scene["disabledPermit"] }
            return flags.contains("no") && !flags.contains("yes") ? 0 : 1
        }
        return checkNote[type] == nil ? 0 : 1
    }
    /// 단속 시간 — 전국 기준(어린이보호구역 평일 오전 8시~오후 8시)만 본다. 지역 규정은 웹(localRules)에만 있다
    static func enforceable(_ type: EvidenceType, at date: Date?) -> Bool {
        guard type == .schoolzone, let date else { return true }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Asia/Seoul")!
        return (2...6).contains(calendar.component(.weekday, from: date)) && (8..<20).contains(calendar.component(.hour, from: date))
    }
    static func rankedTypes(_ draft: ZoneCase) -> [TypeOption] {
        let at = draft.primaryPair.first?.takenAt
        let rows = confidentTypes(draft).map { type in
            (type: type, enf: enforceable(type, at: at), tier: evidenceTier(type, draft), fine: fineWon[type] ?? 0,
             order: sceneOrder.firstIndex(of: type) ?? sceneOrder.count)
        }
        let sorted = rows.sorted { a, b in
            if a.enf != b.enf { return a.enf }
            if a.tier != b.tier { return a.tier < b.tier }
            return a.order < b.order
        }
        return sorted.enumerated().map { i, row in
            var reasons: [String] = []
            if !row.enf { reasons.append("지금은 단속 시간이 아닙니다(평일 오전 8시~오후 8시)") }
            reasons.append(row.tier == 0 ? "사진만으로 확인됩니다" : checkNote[row.type] ?? "따로 확인할 것이 있습니다")
            reasons.append("과태료 승용 \(row.fine / 10_000)만 원")
            return TypeOption(type: row.type, recommended: i == 0 && row.enf, enforceable: row.enf, tier: row.tier, reasons: reasons)
        }
    }
    /// 받침에 맞는 조사(웹 josa)
    static func josa(_ word: String, _ withFinal: String, _ withoutFinal: String) -> String {
        guard let last = word.unicodeScalars.last, (0xAC00...0xD7A3).contains(last.value) else { return "\(word)\(withFinal)(\(withoutFinal))" }
        return word + ((last.value - 0xAC00) % 28 == 0 ? withoutFinal : withFinal)
    }
    /// 추천 이유 한 문장(웹 recommendLine). 과태료로 고르지 않으므로 과태료를 말하지 않는다
    static func recommendLine(_ options: [TypeOption]) -> String {
        guard let top = options.first(where: \.recommended) else { return "보이는 유형 모두 지금은 단속 시간이 아닙니다." }
        let rest = options.filter { $0.type != top.type }
        guard let second = rest.first else { return "\(josa(top.type.reportLabel, "으로", "로")) 신고합니다." }
        let pick = josa(top.type.reportLabel, "을", "를")
        if !second.enforceable { return "\(josa(second.type.reportLabel, "은", "는")) 지금 단속 시간이 아니어서 \(pick) 골라 두었습니다." }
        let also = "\(rest.map(\.type.reportLabel).joined(separator: "·"))도 보여 담당 공무원에게 함께 알립니다."
        if top.tier < second.tier { return "사진만으로 확인되는 \(pick) 골라 두었습니다. \(also)" }
        return "사진 판독 순서(위 → 옆 → 구역 안)로 \(pick) 골라 두었습니다. \(also)"
    }
    /// 자동으로 채울 유형 — 하나면 그것, 여럿이면 추천 유형(없으면 사진 판독 순서의 첫 유형). 웹 App autoType 과 같다
    static func autoType(_ draft: ZoneCase) -> EvidenceType? {
        let confident = confidentTypes(draft)
        guard confident.count > 1 else { return confident.first }
        return rankedTypes(draft).first(where: \.recommended)?.type ?? sceneOrder.first(where: confident.contains)
    }

    struct Supplement: Equatable { var id: String; var text: String }
    /// 보완 촬영 — 사진으로 해결되는 부족 사유일 때만, 한 번에 하나, 같은 사유는 한 번만(웹 followUps.supplementRequest)
    static func supplementRequest(_ draft: ZoneCase) -> Supplement? {
        guard draft.primaryPair.count == 2, draft.reportType != .other else { return nil }
        let asked = Set(draft.supplementAsked ?? [])
        for summary in summarize(draft) where draft.reportType == nil || draft.reportType == summary.type {
            guard summary.status == .needsContext || summary.status == .conflict else { continue }
            let obs = summary.observations
            guard obs.contains(where: { $0.identity == "yes" || !$0.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }) else { continue }
            let identity = obs.contains { $0.identity == "yes" }
            let connection = obs.contains { o in
                o.target == "yes" && o.relation == "yes" && (!boundaryTypes.contains(o.type) || o.boundary == "yes")
                    && (o.type != .evcharging || o.zoneKind != "charging" || o.chargerToTarget == "yes")
            }
            let role = summary.status == .conflict || (identity && !connection) ? "connection" : "marking"
            let id = "\(summary.type.rawValue):\(role)"
            guard !asked.contains(id), let what = summary.type.showInPhoto else { continue }
            return Supplement(id: id, text: role == "marking" ? "\(what) 잘 보이게 가까이에서 한 장 더 찍어 주세요" : "\(what) 차와 함께 나오게 한 장 더 찍어 주세요")
        }
        return nil
    }

    enum SharedScope: String, CaseIterable { case sameBay = "same_bay", differentBay = "different_bay", unknown
        var label: String { switch self { case .sameBay: "있어요"; case .differentBay: "없어요"; case .unknown: "모르겠어요" } }
    }
    /// 병행주차 질문 — 친환경차 충전·전용구역 유형이면 사진에 안내가 보이지 않아도 늘 한 번 묻는다(2026-10-22 결정, 웹 sharedParkingQuestion)
    static func sharedQuestionApplies(_ draft: ZoneCase) -> Bool { draft.reportType == .evcharging && !draft.primaryPair.isEmpty }
    /// 사진에서 읽은 '일반 자동차도 주차할 수 있다' 안내(있으면 질문에 그 사실을 알리고 기록에 남긴다)
    static func generalNotice(_ draft: ZoneCase) -> (observation: NativeAIObservation, notice: NativeSharedNotice)? {
        guard draft.reportType == .evcharging else { return nil }
        for o in observations(draft) where o.type == .evcharging {
            if let n = o.sharedNotice, n.kind == "general_car" || n.kind == "both" { return (o, n) }
        }
        return nil
    }
    /// 지금 사진 기준으로 받은 답. 사진이 바뀌었으면 nil(다시 묻는다)
    static func sharedAnswer(_ draft: ZoneCase) -> SharedScope? {
        let s = draft.review.shared
        guard s.reviewedSignature == draft.reviewSignature, s.source == "photo_ai_user_answer" || s.source == "user_answer" else { return nil }
        switch s.appliesToBay { case .yes: return .sameBay; case .no: return .differentBay; case .unknown: return .unknown }
    }
    /// 병행주차 질문에 아직 답하지 않았다('모르겠어요'도 답이다, 웹 sharedAnswerNeeded)
    static func sharedPending(_ draft: ZoneCase) -> Bool { sharedQuestionApplies(draft) && sharedAnswer(draft) == nil }
    /// 답하기 전에는 위반 유형 확인 단계를 떠나거나 제출하지 못한다 — 가려던 단계 대신 갈 단계(웹 ReportSteps held)
    static func allowedStep(_ draft: ZoneCase, to next: Int) -> Int { next > 0 && sharedPending(draft) ? 0 : next }
    /// 사진에서 읽은 정류소 공개 번호 — 서로 다르면 대상 정류소를 정할 수 없다
    static func busStopNumbers(_ draft: ZoneCase) -> [String] {
        var seen: [String] = []
        for o in observations(draft) where o.type == .busstop {
            if let stop = o.busStop, stop.readable { let id = stop.publicId.trimmingCharacters(in: .whitespaces); if !id.isEmpty && !seen.contains(id) { seen.append(id) } }
        }
        return seen
    }
}

/// 차량번호 — AI 판독과 신고인이 입력한 번호의 관계(웹 src/lib/plateCheck.ts 와 같은 규칙).
/// AI 가 확실히 못 읽으면 신고인이 사진을 보고 입력한 번호로 내고 담당자가 다시 본다(주황).
/// AI 가 확실히 읽은 번호와 어긋나면 사진을 보고 확인해야 낼 수 있고, 확인해도 주황으로 남긴다.
struct PlateStatus: Equatable {
    enum Kind { case match, empty, unreadable, conflict }
    enum Conflict { case entered, reads }
    var kind: Kind
    var conflict: Conflict? = nil
    /// 신고인이 입력한 번호(공백 제거)
    var entered: String
    /// 두 장에서 읽힌 번호(읽힌 것만)
    var reads: [String]
    var confirmed: Bool
    var reason: String? = nil

    static let confidenceFloor = 0.8
    private static func clean(_ text: String?) -> String { (text ?? "").filter { !$0.isWhitespace } }

    /// photos: 기본 사진 두 장의 판독(못 읽은 장은 nil). 판독 결과가 없으면 nil.
    static func make(plate: String?, confirmedFor: String?, photos: [NativePlateRead?]?) -> PlateStatus {
        let entered = clean(plate)
        let confirmed = !entered.isEmpty && clean(confirmedFor) == entered
        let readable = (photos ?? []).compactMap { $0 }.filter(\.readable)
        let reads = readable.map(\.text)
        let valid = reads.count == 2 && reads.allSatisfy(ReportRules.isValidPlate)
        let confident = !readable.isEmpty && readable.map(\.confidence).min()! >= confidenceFloor
        let sure = valid && confident
        let trustedMatch = sure && reads[0] == reads[1]
        if trustedMatch && entered == reads[0] { return .init(kind: .match, entered: entered, reads: reads, confirmed: confirmed) }
        if sure && reads[0] != reads[1] { return .init(kind: .conflict, conflict: .reads, entered: entered, reads: reads, confirmed: confirmed) }
        if trustedMatch { return entered.isEmpty ? .init(kind: .empty, entered: entered, reads: reads, confirmed: confirmed) : .init(kind: .conflict, conflict: .entered, entered: entered, reads: reads, confirmed: confirmed) }
        let reason = photos == nil ? "판독 결과 없음"
            : reads.isEmpty ? "번호판을 읽지 못함"
            : reads.count == 1 ? "한 장에서만 읽힘(\(reads[0]))"
            : !valid ? "읽은 값이 번호판 형식과 다름(\(reads.joined(separator: " / ")))"
            : !confident ? "확신도가 기준(\(Int(confidenceFloor * 100))%) 미만"
            : "두 장 번호판 일치를 확정할 수 없음"
        return .init(kind: .unreadable, entered: entered, reads: reads, confirmed: confirmed, reason: reason)
    }
}

struct ReportCheck: Identifiable, Equatable {
    enum Status { case pass, warn, fail }
    var id: String; var label: String; var status: Status; var detail: String
}

extension ZoneCase {
    /// 신고서의 유형. 아직 정하지 않았으면 nil. 이전 초안은 고른 유형이 있으면 직접 고른 것으로 본다.
    var reportType: EvidenceType? {
        if typeSource == nil && review.selectedType == .other && review.selectionSource == "user" { return nil }
        return review.selectedType
    }
    var typeChosenByUser: Bool { typeSource == "user" || (typeSource == nil && reportType != nil) }

    /// 직접 고른 유형은 그대로 둔다. 사진에서 확인된 유형이 하나면 그것을, 여럿이면 추천 유형을 채우고, 근거가 사라지면 다시 비운다.
    mutating func applyPhotoType() {
        guard !typeChosenByUser else { return }
        if let type = ReportEvidence.autoType(self) {
            if reportType != type { var r = review; r.selectedType = type; r.selectionSource = "photo"; evidenceReview = r }
            typeSource = "photo"
        } else if typeSource == "photo" {
            var r = review; r.selectedType = .other; r.selectionSource = "user"; evidenceReview = r
            typeSource = nil
        }
    }
    mutating func chooseType(_ type: EvidenceType) {
        var r = review; r.selectedType = type; r.selectionSource = "user"; evidenceReview = r
        typeSource = "user"
    }
    /// 신고인의 답과 사진에서 읽은 안내(있으면)를 함께 기록한다. 법적 허용 여부는 정하지 않는다(웹 answerSharedParking)
    mutating func answerShared(_ scope: ReportEvidence.SharedScope) {
        guard ReportEvidence.sharedQuestionApplies(self) else { return }
        var s = review.shared
        if let (observation, notice) = ReportEvidence.generalNotice(self) {
            s.observed = .yes; s.kind = notice.kind; s.noticeText = notice.text; s.scope = notice.bay; s.timeConditions = notice.time
            s.source = "photo_ai_user_answer"; s.photoIDs = [observation.photoID]
        } else {
            s.observed = .no; s.kind = "unclear"; s.noticeText = ""; s.scope = ""; s.timeConditions = ""
            s.source = "user_answer"; s.photoIDs = []
        }
        s.appliesToBay = scope == .sameBay ? .yes : scope == .differentBay ? .no : .unknown
        s.reviewedSignature = reviewSignature
        var r = review; r.shared = s; evidenceReview = r
    }

    var intervalSeconds: Double? {
        guard primaryPair.count == 2, let a = primaryPair[0].takenAt, let b = primaryPair[1].takenAt else { return nil }
        return b.timeIntervalSince(a)
    }
    var locatedPhoto: LocationRecord? { primaryPair.compactMap(\.location).first }

    /// 기본 사진 두 장에서 AI 가 읽은 번호판(못 읽은 장은 nil). 지금 사진의 판독이 없으면 nil.
    var photoPlates: [NativePlateRead?]? {
        guard let result = review.aiResult, result.revision == review.revision, let plates = result.plates, primaryPair.count == 2 else { return nil }
        return primaryPair.map { plates[$0.id.uuidString] }
    }
    var plateStatus: PlateStatus { .make(plate: plate, confirmedFor: plateConfirmedFor, photos: photoPlates) }
    /// '1장 12가3456(확신 92%), 2장 못 읽음' (웹 perPhotoReads)
    var perPhotoReads: String {
        guard let photos = photoPlates else { return "판독 결과 없음" }
        return photos.enumerated().map { i, p in
            if let p, p.readable { return "\(i + 1)장 \(p.text)(확신 \(Int((p.confidence * 100).rounded()))%)" }
            return "\(i + 1)장 못 읽음"
        }.joined(separator: ", ")
    }
    /// 담당자에게 함께 가는 차량번호 줄(웹 officerLines 의 '- 차량번호:'). 두 장 판독·입력이 같으면 nil.
    var officerPlateLine: String? {
        let ps = plateStatus
        if ps.kind == .match { return nil }
        let from = ps.confirmed ? "신고인이 사진 보고 확인" : "신고인 직접 입력"
        let why = ps.kind == .conflict ? "AI 판독과 다름" : ps.kind == .empty ? "차량번호 빈칸" : "AI가 확실히 읽지 못함"
        return "- 차량번호: \(ps.entered.isEmpty ? "빈칸" : "\(ps.entered)(\(from))") · AI 판독: \(perPhotoReads) — \(why), 사진으로 번호 확인 필요"
    }

    /// 웹 composeBody 와 같은 개조식. 없는 값은 줄째로 뺀다. 판독 근거는 신고 내용에 붙이지 않는다.
    var composedBody: String {
        guard let first = primaryPair.first ?? evidence.first else { return "" }
        var lines = [first.takenAt.map { "- 일시: \(ReportRules.stamp($0))" } ?? "- 일시: 촬영 시각 미확인"]
        let address = self.address.trimmingCharacters(in: .whitespacesAndNewlines)
        if !address.isEmpty { lines.append("- 장소: \(address)") }
        else if let at = locatedPhoto { lines.append(String(format: "- 장소: 좌표 %.5f, %.5f 부근", at.latitude, at.longitude)) }
        lines.append("- 위반: " + (reportType.map { "\($0.reportLabel) 불법 주정차" } ?? "불법 주정차"))
        if let plate = plate?.filter({ !$0.isWhitespace }), ReportRules.isValidPlate(plate) { lines.append("- 차량: \(plate)") }
        if primaryPair.count == 2 {
            lines.append("- 증거: 같은 자리 사진 2장(" + (intervalSeconds.map { "\(Int($0))초 간격" } ?? "촬영 간격 미확인") + ")")
        }
        return lines.joined(separator: "\n")
    }
    var reportBody: String { bodyEdited == true ? body : composedBody }

    /// 웹 제출 전 점검 중 iPhone에서 잴 수 있는 항목. 빨간불이 있으면 사유와 불수용 안내를 보여 준 뒤에만 낸다.
    /// 접수 기한·촬영시각 표시·지역 규정·두 사진 겹침은 아직 iPhone에 연결하지 않았다.
    var reportChecks: [ReportCheck] {
        var out: [ReportCheck] = []
        let need = Double(ReportRules.intervalSeconds)
        if let gap = intervalSeconds {
            out.append(.init(id: "interval", label: "1분 간격 두 장", status: gap >= need ? .pass : .fail,
                             detail: (gap >= need ? "\(Int(gap))초 간격으로 찍혔습니다." : "\(Int(gap))초 간격입니다. \(Int(need))초 이상이어야 합니다.") + ReportRules.intervalNote))
        } else {
            out.append(.init(id: "interval", label: "1분 간격 두 장", status: .fail, detail: primaryPair.count < 2 ? "사진이 두 장 필요합니다." : "촬영 시각을 알 수 없는 사진이 있어 확인할 수 없습니다."))
        }
        let plate = (self.plate ?? "").filter { !$0.isWhitespace }
        out.append(.init(id: "plate", label: "차량번호", status: ReportRules.isValidPlate(plate) ? .pass : .fail,
                         detail: plate.isEmpty ? "차량번호가 비어 있습니다." : ReportRules.isValidPlate(plate) ? "\(plate) — 형식이 맞습니다." : "\(plate) — 번호판 형식과 다릅니다. 다시 확인해 주세요."))
        out.append(vehicleCheck)
        let at = locatedPhoto
        let accuracy = at.flatMap { $0.accuracy.isFinite && $0.accuracy >= 0 ? $0.accuracy : nil }
        out.append(.init(id: "location", label: "위치 특정", status: at == nil ? .fail : accuracy == nil || accuracy! > 30 ? .warn : .pass,
                         detail: at == nil ? "좌표가 없습니다. 위치 권한을 켜고 다시 찍어 주세요."
                         : accuracy.map { "좌표 정확도 약 \(Int($0))m." } ?? "좌표는 있으나 정확도를 알 수 없습니다."))
        let type = reportType
        let confident = ReportEvidence.confidentTypes(self)
        out.append(.init(id: "evidence", label: "위반유형 사진 증거",
                         status: type == nil ? .fail : (type != .other && confident.contains(type!)) ? .pass : .warn,
                         detail: type == nil ? "위반유형이 비어 있습니다. 위반 장소가 사진에 보이게 찍거나 유형을 골라 주세요."
                         : (type != .other && confident.contains(type!)) ? "사진에서 위반 장소의 근거를 찾았습니다."
                         : "직접 고른 유형입니다. 그 근거(표지판·노면 표시 등)가 사진에 보이는지 확인해 주세요."))
        if ReportEvidence.sharedQuestionApplies(self) {
            let answer = ReportEvidence.sharedAnswer(self)
            if answer != .differentBay {
                out.append(.init(id: "shared_parking", label: "일반 자동차 주차 안내", status: .warn, detail:
                    answer == .sameBay ? "이 칸에 일반 자동차도 주차할 수 있다는 안내가 있다고 답했습니다. 안내의 시간·조건에 해당하면 신고 대상이 아닐 수 있습니다."
                    : answer == .unknown ? "일반 자동차 주차 안내가 이 칸에 적용되는지 확인하지 못했습니다. 안내의 시간·조건에 해당하면 신고 대상이 아닐 수 있습니다."
                    : ReportEvidence.generalNotice(self) != nil ? "사진에 일반 자동차 주차 안내가 보입니다. 위반 유형 확인 단계에서 이 칸에 적용되는지 답해 주세요."
                    : "친환경차 충전구역 중에는 일반 자동차도 세울 수 있는 칸이 있습니다. 위반 유형 확인 단계에서 이 칸에 그런 안내가 있는지 답해 주세요."))
            }
        }
        let stops = type == .busstop ? ReportEvidence.busStopNumbers(self) : []
        if stops.count > 1 {
            out.append(.init(id: "busstop_number", label: "정류소 표지", status: .warn, detail: "사진에서 서로 다른 정류소 번호가 읽혔습니다(\(stops.joined(separator: " / "))). 차 옆 정류소 표지가 사진에 보이는지 확인해 주세요."))
        }
        let address = self.address.trimmingCharacters(in: .whitespacesAndNewlines)
        out.append(.init(id: "address", label: "발생지역", status: !address.isEmpty ? .pass : at != nil ? .warn : .fail,
                         detail: !address.isEmpty ? address : at != nil ? "주소가 아직 없고 좌표만 있습니다." : "발생지역이 없습니다. 주소를 넣어 주세요."))
        let body = reportBody.trimmingCharacters(in: .whitespacesAndNewlines)
        out.append(.init(id: "body", label: "내용", status: body.count >= ReportRules.bodyMin ? .pass : .fail,
                         detail: body.count >= ReportRules.bodyMin ? "\(reportBody.count)자" : "\(ReportRules.bodyMin)자 이상 적어야 합니다."))
        return out
    }
    /// 빨간불 — 막지는 않고, 제출할 때 사유와 불수용될 수 있다는 안내를 먼저 보여 준다(웹 precheck blocked)
    var reportReds: [ReportCheck] { reportChecks.filter { $0.status == .fail } }
    var reportBlocked: Bool { !reportReds.isEmpty }
    /// 담당자에게 함께 가는 확인 사항 — 차량번호 줄과, 빨간불 안내를 보고 그대로 낸 항목(웹 officerLines)
    var officerLines: [String] {
        var lines: [String] = []
        if let plate = officerPlateLine { lines.append(plate) }
        // 한 번 세운 차에 함께 보인 다른 위반 — 겹치면 가장 무거운 과태료 하나를 매기므로 담당자가 알아야 한다(웹 officerLines)
        if let type = reportType {
            let also = ReportEvidence.confidentTypes(self).filter { $0 != type }
            if !also.isEmpty { lines.append("- 함께 보인 위반: \(also.map(\.reportLabel).joined(separator: ", "))(사진 판독, 확인 필요)") }
        }
        if let reds = submittedWithReds, !reds.isEmpty { lines.append("- 고지 후 제출: 빨간불(\(reds.joined(separator: ", ")))과 불수용될 수 있다는 안내를 보고 신고인이 그대로 제출") }
        return lines
    }

    /// 같은 차 — 웹 precheck 'vehicle' 과 같은 세 단계(초록·주황·빨강)와 문구
    var vehicleCheck: ReportCheck {
        let ps = plateStatus
        let confirmedNote = "신고인이 사진을 보고 확인했습니다. 담당자가 사진으로 번호를 한 번 더 확인합니다."
        let detail: String
        switch ps.kind {
        case .match: detail = "두 장에서 따로 읽은 번호와 입력한 차량번호가 같습니다."
        case .empty: detail = "차량번호가 비어 있습니다. 두 장에서 읽은 번호는 \(ps.reads[0])입니다. 사진을 보고 입력해 주세요."
        case .conflict:
            detail = (ps.conflict == .reads ? "두 장에서 읽은 번호가 다릅니다(\(ps.reads.joined(separator: " / ")))." : "입력한 차량번호(\(ps.entered))가 두 장에서 읽은 번호(\(ps.reads[0]))와 다릅니다.")
                + " " + (ps.confirmed ? confirmedNote : "사진을 보고 확인해 주세요. 확인하지 않고 내면 불수용될 가능성이 높습니다.")
        case .unreadable:
            detail = ReportRules.isValidPlate(ps.entered)
                ? "사진에서 번호판을 확실히 읽지 못했습니다(\(ps.reason ?? "")). 신고인이 입력한 번호로 내고, 담당자가 사진으로 번호를 한 번 더 확인합니다."
                : "사진에서 번호판을 확실히 읽지 못했습니다(\(ps.reason ?? "")). 사진을 보고 차량번호를 바르게 입력해 주세요."
        }
        return .init(id: "vehicle", label: "두 장 번호판 일치", status: ps.kind == .match ? .pass : ps.kind == .conflict && !ps.confirmed ? .fail : .warn, detail: detail)
    }
    /// 판독이 두 장에서 같은 번호를 확실히 읽었고 칸이 비었으면 채운다(웹 자동 입력과 같이 — 사람이 넣은 번호는 덮어쓰지 않는다)
    mutating func applyPhotoPlate() {
        let ps = plateStatus
        if ps.kind == .empty { plate = ps.reads[0] }
    }
}
