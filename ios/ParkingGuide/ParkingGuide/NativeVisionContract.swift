import Foundation

/// Legacy scene flags combine identity and proximity. Keep them as legacy claims,
/// never convert them into the independent observations of evidence_v2.
struct NativeLegacyPhotoRead: Codable {
    var photoID: UUID
    var evidence: String
    var scene: [String: String]
    var typeGuess: String
}

struct NativeVisionEnvelope {
    var object: [String: Any]
    var format: String
    var legacyReads: [NativeLegacyPhotoRead] = []
    var notes: [String] = []
    var supportsDetails: Bool { format == "evidence_v2" }
}

enum NativeVisionContract {
    static let legacyNote = "기본 분석만 받았습니다. 서버가 구형 응답을 보내 시설 식별·차량 관계·부분 확대 확인은 제공하지 않았습니다. 위반 없음이나 상세 확인 완료를 뜻하지 않습니다."
    static let partialNote = "일부 사진의 분석 응답이 없습니다. 해당 사진의 판단은 미확인으로 남깁니다."

    static func decode(_ raw: [String: Any], photoIDs: [UUID], inputVersion: String) throws -> NativeVisionEnvelope {
        let object = (raw["result"] as? [String: Any]) ?? raw
        func invalid() -> NativeVisionError {
            NativeVisionError(message: "분석 서버의 응답 형식이나 사진 정보가 맞지 않습니다. 기존 결과와 원본은 유지됩니다.")
        }
        guard !photoIDs.isEmpty, Set(photoIDs).count == photoIDs.count, object["error"] == nil else { throw invalid() }
        func binding(_ value: [String: Any], expectedID: UUID? = nil, requireID: Bool = false) throws {
            if let rawID = value["photoId"] {
                guard let string = rawID as? String, let id = UUID(uuidString: string), photoIDs.contains(id), expectedID == nil || expectedID == id else { throw invalid() }
            } else if requireID { throw invalid() }
            if let version = value["inputVersion"] {
                guard let version = version as? String, version == inputVersion else { throw invalid() }
            }
        }
        try binding(object)
        if let version = object["analysisVersion"], (version as? Int) != 2 { throw invalid() }
        let photos = object["photos"] as? [Any]
        if object["photos"] != nil && (photos == nil || photos?.count != photoIDs.count) { throw invalid() }
        if object["evidenceReview"] != nil && !(object["evidenceReview"] is [[String: Any]]) { throw invalid() }
        let summaries = object["evidenceReview"] as? [[String: Any]]
        let hasStructuredPhotos = photos?.contains { (($0 as? [String: Any])?["observations"] != nil || ($0 as? [String: Any])?["analysisVersion"] != nil) } == true
        let modern = object["analysisVersion"] != nil || hasStructuredPhotos || summaries?.contains { ($0["status"] as? String) != "legacy" } == true
        var notes: [String] = []
        if let photos {
            guard photos.contains(where: { $0 is [String: Any] }) else { throw invalid() }
            if photos.contains(where: { $0 is NSNull }) { notes.append(partialNote) }
            for (index, value) in photos.enumerated() {
                if value is NSNull { continue }
                guard let photo = value as? [String: Any] else { throw invalid() }
                try binding(photo, expectedID: photoIDs[index], requireID: modern)
                if let version = photo["analysisVersion"], (version as? Int) != 2 { throw invalid() }
                if modern {
                    guard let observations = photo["observations"] as? [[String: Any]] else { throw invalid() }
                    for observation in observations { try binding(observation, expectedID: photoIDs[index], requireID: true) }
                }
            }
        }
        if modern {
            guard let summaries else { throw invalid() }
            for summary in summaries {
                guard let type = summary["type"] as? String, EvidenceType(rawValue: type) != nil, type != "other",
                      let status = summary["status"] as? String, ["observed", "needs_context", "conflict", "not_observed"].contains(status),
                      let observations = summary["observations"] as? [[String: Any]] else { throw invalid() }
                for observation in observations {
                    try binding(observation, requireID: true)
                    if let rowType = observation["type"] as? String, rowType != type { throw invalid() }
                }
            }
            return .init(object: object, format: "evidence_v2", notes: notes)
        }
        guard let photos else { throw invalid() }
        // 운영(main) 판독은 친환경차충전구역을 'evcharge'로 부른다 — 앱 유형 이름(evcharging)으로 맞춘다
        let aliases = ["evcharge": EvidenceType.evcharging.rawValue]
        let keys = ["onCrosswalk", "onSidewalk", "busStopVisible", "schoolZoneMarking", "intersectionCorner", "fireHydrantNear", "disabledSpace", "disabledPermit", "fireLane", "evChargingSpace", "evVehicle"]
        var legacy: [NativeLegacyPhotoRead] = []
        for (index, value) in photos.enumerated() {
            if value is NSNull { continue }
            guard let photo = value as? [String: Any], let scene = photo["scene"] as? [String: Any],
                  let evidence = photo["evidence"] as? String, let rawGuess = photo["typeGuess"] as? String,
                  case let guess = aliases[rawGuess] ?? rawGuess,
                  guess == "none" || (EvidenceType(rawValue: guess) != nil && guess != "other"),
                  keys.contains(where: { ["yes", "no", "unclear"].contains(scene[$0] as? String ?? "") }) else { throw invalid() }
            let flags = Dictionary(uniqueKeysWithValues: keys.compactMap { key -> (String, String)? in
                guard let flag = scene[key] as? String, ["yes", "no", "unclear"].contains(flag) else { return nil }
                return (key, flag)
            })
            legacy.append(.init(photoID: photoIDs[index], evidence: String(evidence.prefix(1200)), scene: flags, typeGuess: guess))
        }
        notes.insert(legacyNote, at: 0)
        // Preserve exact per-photo claims separately; do not infer from prose or top-level ruleTypes.
        var compatible = object
        compatible["evidenceReview"] = [[String: Any]]()
        compatible["evidence"] = legacy.map { "사진 \((photoIDs.firstIndex(of: $0.photoID) ?? 0) + 1) 기본 분석: \($0.evidence)" }.joined(separator: "\n")
        return .init(object: compatible, format: "legacy", legacyReads: legacy, notes: notes)
    }
}
