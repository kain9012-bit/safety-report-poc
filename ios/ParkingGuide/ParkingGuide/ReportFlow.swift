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
    static func summarize(_ draft: ZoneCase) -> [Summary] {
        let all = observations(draft)
        return EvidenceType.allCases.compactMap { type in
            let obs = all.filter { $0.type == type }
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
    /// 친환경차 충전·전용구역에서 '일반 자동차도 주차할 수 있다'는 안내가 사진에 보일 때만 묻는다
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
        guard s.reviewedSignature == draft.reviewSignature, s.observed == .yes else { return nil }
        switch s.appliesToBay { case .yes: return .sameBay; case .no: return .differentBay; case .unknown: return .unknown }
    }
    /// 사진에서 읽은 정류소 공개 번호 — 서로 다르면 대상 정류소를 정할 수 없다
    static func busStopNumbers(_ draft: ZoneCase) -> [String] {
        var seen: [String] = []
        for o in observations(draft) where o.type == .busstop {
            if let stop = o.busStop, stop.readable { let id = stop.publicId.trimmingCharacters(in: .whitespaces); if !id.isEmpty && !seen.contains(id) { seen.append(id) } }
        }
        return seen
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

    /// 직접 고른 유형은 그대로 둔다. 사진에서 확인된 유형이 하나뿐일 때만 채우고, 근거가 사라지면 다시 비운다.
    mutating func applyPhotoType() {
        guard !typeChosenByUser else { return }
        let confident = ReportEvidence.confidentTypes(self)
        if confident.count == 1, let type = confident.first {
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
    mutating func answerShared(_ scope: ReportEvidence.SharedScope) {
        guard let (observation, notice) = ReportEvidence.generalNotice(self) else { return }
        var s = review.shared
        s.observed = .yes; s.kind = notice.kind; s.noticeText = notice.text; s.scope = notice.bay; s.timeConditions = notice.time
        s.appliesToBay = scope == .sameBay ? .yes : scope == .differentBay ? .no : .unknown
        s.source = "photo_ai_user_answer"; s.photoIDs = [observation.photoID]; s.reviewedSignature = reviewSignature
        var r = review; r.shared = s; evidenceReview = r
    }

    var intervalSeconds: Double? {
        guard primaryPair.count == 2, let a = primaryPair[0].takenAt, let b = primaryPair[1].takenAt else { return nil }
        return b.timeIntervalSince(a)
    }
    var locatedPhoto: LocationRecord? { primaryPair.compactMap(\.location).first }

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

    /// 웹 제출 전 점검 중 iPhone에서 잴 수 있는 항목. 빨간불이 하나라도 있으면 제출하지 않는다.
    /// 접수 기한·촬영시각 표시·지역 규정·번호판 판독 대조·두 사진 겹침은 아직 iPhone에 연결하지 않았다.
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
        if ReportEvidence.generalNotice(self) != nil {
            let answer = ReportEvidence.sharedAnswer(self)
            if answer != .differentBay {
                out.append(.init(id: "shared_parking", label: "일반 자동차 주차 안내", status: .warn, detail:
                    answer == .sameBay ? "이 칸에 일반 자동차도 주차할 수 있다는 안내가 있다고 답했습니다. 안내의 시간·조건에 해당하면 신고 대상이 아닐 수 있습니다."
                    : answer == .unknown ? "일반 자동차 주차 안내가 이 칸에 적용되는지 확인하지 못했습니다. 안내의 시간·조건에 해당하면 신고 대상이 아닐 수 있습니다."
                    : "사진에 일반 자동차 주차 안내가 보입니다. 위반 유형 확인 단계에서 이 칸에 적용되는지 답해 주세요."))
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
    var reportBlocked: Bool { reportChecks.contains { $0.status == .fail } }
}
