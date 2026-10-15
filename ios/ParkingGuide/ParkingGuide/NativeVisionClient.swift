import Foundation
import UIKit

struct NativeVisionError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}
struct NativeRegionHint { var type: EvidenceType; var box: [Double] }
@MainActor enum NativeVisionClient {
    static func endpointURL(_ raw: String) throws -> URL {
        guard let url = URL(string: raw.trimmingCharacters(in: .whitespacesAndNewlines)), url.scheme == "https", url.host != nil, url.user == nil, url.password == nil, url.query == nil, url.fragment == nil else { throw NativeVisionError(message: "사용할 HTTPS 분석 서버 주소를 확인해 주세요. 기존 자료는 유지됩니다.") }
        return url
    }
    static func analyze(draft: ZoneCase, store: ZoneStore, endpoint: String, session: URLSession = .shared, regionHints: [UUID: [NativeRegionHint]] = [:]) async throws -> NativeAIResult {
        let url = try endpointURL(endpoint)
        let primaryIDs = Set(draft.primaryPair.map(\.id))
        var groups: [[ZoneEvidence]] = []
        if !draft.primaryPair.isEmpty { groups.append(draft.primaryPair) }
        groups += draft.evidence.filter { !primaryIDs.contains($0.id) }.map { [$0] }
        guard !groups.isEmpty else { throw NativeVisionError(message: "보관한 사진이 없습니다.") }
        var observations: [NativeAIObservation] = []; var candidates: [EvidenceType] = []; var summaries: [String] = []; var models: [String] = []; var links: [String: NativeAITargetLink] = [:]
        var formats: Set<String> = []; var legacyReads: [NativeLegacyPhotoRead] = []; var notes: [String] = []
        for group in groups {
            try Task.checkCancellation()
            let images = try group.map { photo -> String in
                guard let image = UIImage(data: try store.data(photo)) else { throw NativeVisionError(message: "보관 사진을 읽을 수 없습니다. 원본은 유지됩니다.") }
                let scale = min(1, 1280 / max(image.size.width, image.size.height))
                let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
                let format = UIGraphicsImageRendererFormat(); format.scale = 1
                let derivative = UIGraphicsImageRenderer(size: size, format: format).image { _ in image.draw(in: CGRect(origin: .zero, size: size)) }
                guard let jpeg = derivative.jpegData(compressionQuality: 0.86) else { throw NativeVisionError(message: "분석용 사진을 준비하지 못했습니다.") }
                return "data:image/jpeg;base64," + jpeg.base64EncodedString()
            }
            var request = URLRequest(url: url); request.httpMethod = "POST"; request.timeoutInterval = 60
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            var payload: [String: Any] = ["images": images, "photoIds": group.map { $0.id.uuidString }, "inputVersion": String(draft.review.revision)]
            if group.count == 1, !primaryIDs.contains(group[0].id), let reference = draft.primaryPair.first, let referenceImage = UIImage(data: try store.data(reference)) {
                let scale = min(1, 1280 / max(referenceImage.size.width, referenceImage.size.height))
                let format = UIGraphicsImageRendererFormat(); format.scale = 1
                let size = CGSize(width: referenceImage.size.width * scale, height: referenceImage.size.height * scale)
                let derivative = UIGraphicsImageRenderer(size: size, format: format).image { _ in referenceImage.draw(in: CGRect(origin: .zero, size: size)) }
                if let jpeg = derivative.jpegData(compressionQuality: 0.86) { payload["reference"] = ["dataUrl": "data:image/jpeg;base64," + jpeg.base64EncodedString(), "photoId": reference.id.uuidString] }
            }
            request.httpBody = try JSONSerialization.data(withJSONObject: payload)
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode), data.count < 2_000_000 else { throw NativeVisionError(message: "분석 서버가 응답하지 못했습니다. 설정·통신을 확인해 다시 시도하세요. 기존 결과와 자료는 유지됩니다.") }
            guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw NativeVisionError(message: "분석 응답을 읽지 못했습니다.") }
            try Task.checkCancellation()
            let decoded = try NativeVisionContract.decode(object, photoIDs: group.map(\.id), inputVersion: String(draft.review.revision))
            formats.insert(decoded.format); legacyReads += decoded.legacyReads; notes += decoded.notes
            var envelope = decoded.object
            let hints: [[String: Any]] = group.enumerated().flatMap { index, photo in (regionHints[photo.id] ?? []).map { ["imageIndex": index, "type": $0.type.rawValue, "box": $0.box, "reason": "user_region"] as [String: Any] } }
            let details = decoded.supportsDetails ? try detailImages(envelope, originals: group.map { try store.data($0) }, regionHints: hints) : []
            if !details.isEmpty {
                try Task.checkCancellation()
                payload["detailImages"] = details
                request.httpBody = try JSONSerialization.data(withJSONObject: payload)
                do {
                    guard (request.httpBody?.count ?? 0) <= 3_950_000 else { throw NativeVisionError(message: "부분 사진 전송량 상한") }
                    let (detailData, detailResponse) = try await session.data(for: request)
                    guard let http = detailResponse as? HTTPURLResponse, (200..<300).contains(http.statusCode), detailData.count < 2_000_000,
                          let detailObject = try JSONSerialization.jsonObject(with: detailData) as? [String: Any] else { throw NativeVisionError(message: "부분 확인 응답 없음") }
                    let decodedDetail = try NativeVisionContract.decode(detailObject, photoIDs: group.map(\.id), inputVersion: String(draft.review.revision))
                    guard decodedDetail.supportsDetails else { throw NativeVisionError(message: "부분 확인 응답 형식 불일치") }
                    notes += decodedDetail.notes
                    envelope = mergeDetailEnvelope(envelope, second: decodedDetail.object, requests: details)
                } catch {
                    try Task.checkCancellation()
                    summaries.append("원본 부분 확인을 완료하지 못했습니다. 전체 사진 분석만 보관하고 불명확한 내용은 남깁니다.")
                }
            }
            let parsed = parse(envelope, allowedPhotoIDs: Set(group.map(\.id)))
            observations += parsed.observations
            if decoded.supportsDetails, group.count == 1, let reads = envelope["photos"] as? [[String: Any]], let link = reads.first?["targetLink"] as? [String: Any],
               let referenceID = (link["referencePhotoId"] as? String).flatMap(UUID.init(uuidString:)), referenceID == draft.primaryPair.first?.id {
                links[group[0].id.uuidString] = .init(referencePhotoID: referenceID, sameVehicle: link["sameVehicle"] as? String ?? "unclear", samePlace: link["samePlace"] as? String ?? "unclear", evidence: String((link["evidence"] as? String ?? "").prefix(1200)))
            }
            if group.allSatisfy({ photo in draft.evidenceEligible(photo) || links[photo.id.uuidString].map { $0.sameVehicle == "yes" && $0.samePlace == "yes" && $0.referencePhotoID == draft.primaryPair.first?.id } == true }) { candidates += parsed.types }
            if let summary = envelope["evidence"] as? String { summaries.append(String(summary.prefix(1200))) }
            if let model = envelope["model"] as? String { models.append(model) }
        }
        let uniqueNotes = notes.reduce(into: [String]()) { if !$0.contains($1) { $0.append($1) } }
        let types = EvidenceType.allCases.filter { candidates.contains($0) }
        return NativeAIResult(revision: draft.review.revision, photoIDs: draft.evidence.map(\.id), generatedAt: Date(), recommendedTypes: types, observations: observations, summary: (uniqueNotes + summaries).joined(separator: "\n"), model: Array(Set(models)).sorted().joined(separator: ","), targetLinks: links, responseFormat: formats.count == 1 ? formats.first : "mixed", compatibilityNotes: uniqueNotes, legacyReads: legacyReads)
    }
    static func detailImages(_ object: [String: Any], originals: [Data], regionHints: [[String: Any]] = []) throws -> [[String: Any]] {
        guard let photos = object["photos"] as? [Any] else { return [] }
        var planned: [[String: Any]] = Array(regionHints.prefix(2))
        for (index, raw) in photos.enumerated() where originals.indices.contains(index) {
            guard let photo = raw as? [String: Any] else { continue }
            for request in photo["detailRequests"] as? [[String: Any]] ?? [] {
                var next = request; next["imageIndex"] = index; planned.append(next)
            }
        }
        // A tiny hydrant missed in the thumbnail still receives a bounded original-region scan.
        for (index, raw) in photos.enumerated() where originals.indices.contains(index) && planned.count < 2 {
            guard let photo = raw as? [String: Any], let original = UIImage(data: originals[index]), max(original.size.width, original.size.height) > 1280 else { continue }
            let observations = photo["observations"] as? [[String: Any]] ?? []
            if observations.contains(where: { $0["type"] as? String == "hydrant" && $0["identity"] as? String == "yes" }) { continue }
            let boxes: [[Double]] = original.size.width >= original.size.height ? [[0, 0, 1000, 600], [0, 400, 1000, 1000]] : [[0, 0, 600, 1000], [400, 0, 1000, 1000]]
            for box in boxes where planned.count < 2 { planned.append(["imageIndex": index, "type": "hydrant", "box": box, "reason": "overlap_scan"]) }
        }
        var details: [[String: Any]] = []
        for request in planned {
            if details.count == 2 { break }
            guard let index = request["imageIndex"] as? Int, originals.indices.contains(index), let original = UIImage(data: originals[index]),
                  let type = request["type"] as? String, EvidenceType(rawValue: type) != nil, type != "other",
                  let box = request["box"] as? [Double], box.count == 4, box.allSatisfy({ $0.isFinite && $0 >= 0 && $0 <= 1000 }), box[2] > box[0], box[3] > box[1] else { continue }
            let area = CGRect(x: box[1] * original.size.width / 1000, y: box[0] * original.size.height / 1000, width: (box[3] - box[1]) * original.size.width / 1000, height: (box[2] - box[0]) * original.size.height / 1000)
            guard area.width >= 24, area.height >= 24, area.width * area.height < original.size.width * original.size.height * 0.85 else { continue }
            let scale = min(1, 1280 / max(area.width, area.height))
            let format = UIGraphicsImageRendererFormat(); format.scale = 1
            let crop = UIGraphicsImageRenderer(size: CGSize(width: area.width * scale, height: area.height * scale), format: format).image { _ in
                original.draw(in: CGRect(x: -area.minX * scale, y: -area.minY * scale, width: original.size.width * scale, height: original.size.height * scale))
            }
            guard let jpeg = crop.jpegData(compressionQuality: 0.9) else { continue }
            details.append(["imageIndex": index, "type": type, "box": box, "reason": request["reason"] as? String ?? "small", "dataUrl": "data:image/jpeg;base64," + jpeg.base64EncodedString()])
        }
        return details
    }

    /// Keep independent whole-scene plate/spatial observations. A detail cannot establish a new relation.
    static func mergeDetailEnvelope(_ first: [String: Any], second: [String: Any], requests: [[String: Any]]) -> [String: Any] {
        guard let firstPhotos = first["photos"] as? [Any], let secondPhotos = second["photos"] as? [Any] else { return first }
        func tri(_ raw: Any?) -> String { let value = raw as? String ?? "unclear"; return ["yes", "no"].contains(value) ? value : "unclear" }
        func opposite(_ a: Any?, _ b: Any?) -> Bool { (tri(a) == "yes" && tri(b) == "no") || (tri(a) == "no" && tri(b) == "yes") }
        var photos: [Any] = firstPhotos
        for (index, raw) in firstPhotos.enumerated() {
            guard var photo = raw as? [String: Any], secondPhotos.indices.contains(index), let detailPhoto = secondPhotos[index] as? [String: Any] else { continue }
            let relevant = requests.filter { $0["imageIndex"] as? Int == index }
            let types = Set(relevant.compactMap { $0["type"] as? String })
            let detailObservations = detailPhoto["observations"] as? [[String: Any]] ?? []
            var observations = photo["observations"] as? [[String: Any]] ?? []
            for beforeIndex in observations.indices {
                var before = observations[beforeIndex]
                guard let type = before["type"] as? String, types.contains(type), let after = detailObservations.first(where: { $0["type"] as? String == type }) else { continue }
                var unknown = before["unknownReasons"] as? [String] ?? []
                if opposite(before["identity"], after["identity"]) { before["identity"] = "unclear"; unknown.append("전체 장면과 원본 부분의 관찰이 달라 재확인 필요") }
                else if tri(after["identity"]) != "unclear" { before["identity"] = tri(after["identity"]) }
                for key in ["identityDetail", "markingText"] { if let text = after[key] as? String, !text.isEmpty { before[key] = text } }
                if let stop = after["busStop"] { before["busStop"] = stop }
                if let kind = after["zoneKind"] as? String, kind != "unclear" { before["zoneKind"] = kind }
                for key in ["markingToTarget", "vehicleRelation", "boundary", "chargerToTarget"] {
                    if opposite(before[key], after[key]) { before[key] = "unclear"; unknown.append("전체 장면과 원본 부분의 관찰이 달라 재확인 필요") }
                }
                if var notice = after["sharedNotice"] as? [String: Any] { notice["targetBayRelation"] = (before["sharedNotice"] as? [String: Any])?["targetBayRelation"] ?? "unclear"; notice["legalPermission"] = "unverified"; before["sharedNotice"] = notice }
                unknown += after["unknownReasons"] as? [String] ?? []
                before["unknownReasons"] = Array(Set(unknown)).sorted(); observations[beforeIndex] = before
            }
            for after in detailObservations {
                guard let type = after["type"] as? String, types.contains(type), !observations.contains(where: { $0["type"] as? String == type }) else { continue }
                var discovered = after
                discovered["photoId"] = photo["photoId"]; discovered["inputVersion"] = photo["inputVersion"]
                for key in ["markingToTarget", "vehicleRelation", "chargerToTarget"] { discovered[key] = "unclear" }
                if var notice = discovered["sharedNotice"] as? [String: Any] { notice["targetBayRelation"] = "unclear"; discovered["sharedNotice"] = notice }
                discovered["unknownReasons"] = (discovered["unknownReasons"] as? [String] ?? []) + ["원본 부분에서 새 후보 발견 · 전체 장면과 대상 연결 재확인 필요"]
                observations.append(discovered)
            }
            photo["observations"] = observations; photo["detailReview"] = "completed"
            photo["detailRegions"] = relevant.map { request in request.filter { $0.key != "dataUrl" } }; photo["detailRequests"] = []
            photos[index] = photo
        }
        let all = photos.compactMap { $0 as? [String: Any] }.flatMap { $0["observations"] as? [[String: Any]] ?? [] }
        let boundaries = Set(["crossing", "sidewalk", "corner", "disabled", "firelane", "evcharging"])
        var summaries: [[String: Any]] = []
        for type in EvidenceType.allCases where type != .other {
            let observations = all.filter { $0["type"] as? String == type.rawValue }
            if observations.isEmpty { continue }
            let linked = observations.filter { !(($0["unknownReasons"] as? [String] ?? []).contains("기본 사진과 같은 대상·장소 연결 미확인")) }
            var keys = ["identity", "markingToTarget", "vehicleRelation"]
            if boundaries.contains(type.rawValue) { keys.append("boundary") }
            if type == .evcharging && linked.contains(where: { $0["zoneKind"] as? String == "charging" }) { keys.append("chargerToTarget") }
            let conflict = keys.contains { key in linked.contains { tri($0[key]) == "yes" } && linked.contains { tri($0[key]) == "no" } } || linked.contains { ($0["unknownReasons"] as? [String] ?? []).contains("전체 장면과 원본 부분의 관찰이 달라 재확인 필요") }
            let complete = linked.contains { value in
                guard ["identity", "markingToTarget", "vehicleRelation"].allSatisfy({ tri(value[$0]) == "yes" }) else { return false }
                if boundaries.contains(type.rawValue), tri(value["boundary"]) != "yes" { return false }
                if type == .evcharging { guard let kind = value["zoneKind"] as? String, kind != "unclear" else { return false }; if kind == "charging" && tri(value["chargerToTarget"]) != "yes" { return false } }
                return true
            }
            summaries.append(["type": type.rawValue, "status": conflict ? "conflict" : complete ? "observed" : "needs_context", "observations": observations, "legalStatus": "unverified", "distance": "unverified"])
        }
        var result = first; result["photos"] = photos; result["evidenceReview"] = summaries
        result["ruleTypes"] = summaries.filter { $0["status"] as? String == "observed" }.compactMap { $0["type"] as? String }
        return result
    }
    static func parse(_ object: [String: Any], allowedPhotoIDs: Set<UUID>) -> (observations: [NativeAIObservation], types: [EvidenceType]) {
        var rows: [NativeAIObservation] = []; var types: [EvidenceType] = []
        guard let summaries = object["evidenceReview"] as? [[String: Any]] else { return ([], []) }
        func tri(_ raw: Any?) -> String { let value = raw as? String; return ["yes", "no"].contains(value ?? "") ? value! : "unclear" }
        for summary in summaries {
            guard let rawType = summary["type"] as? String, let type = EvidenceType(rawValue: rawType), type != .other,
                  let observations = summary["observations"] as? [[String: Any]] else { continue }
            var hasEvidence = false
            for value in observations {
                guard let rawID = value["photoId"] as? String, let photoID = UUID(uuidString: rawID), allowedPhotoIDs.contains(photoID) else { continue }
                var notice: NativeSharedNotice?
                if let raw = value["sharedNotice"] as? [String: Any] {
                    func text(_ key: String) -> String { String((raw[key] as? String ?? "").prefix(1500)) }
                    notice = .init(kind: text("kind"), text: text("text"), bay: text("bayText"), time: text("timeText"), conditions: text("otherConditions"), issuer: text("issuer"))
                }
                var stop: NativeBusStopPhoto?
                if type == .busstop, let raw = value["busStop"] as? [String: Any] {
                    let id = String((raw["publicId"] as? String ?? "").prefix(80)), name = String((raw["name"] as? String ?? "").prefix(160))
                    stop = .init(publicId: id, name: name, readable: (raw["readable"] as? Bool == true) && (!id.isEmpty || !name.isEmpty))
                }
                rows.append(.init(photoID: photoID, type: type, identity: tri(value["identity"]), target: tri(value["markingToTarget"]), relation: tri(value["vehicleRelation"]), text: String((value["markingText"] as? String ?? "").prefix(1500)), unknownReasons: Array((value["unknownReasons"] as? [String] ?? []).prefix(12)), sharedNotice: notice, busStop: stop, boundary: tri(value["boundary"]), chargerToTarget: tri(value["chargerToTarget"]), zoneKind: value["zoneKind"] as? String, identityDetail: String((value["identityDetail"] as? String ?? "").prefix(400))))
                if tri(value["identity"]) == "yes" { hasEvidence = true }
            }
            if hasEvidence, ["observed", "needs_context", "conflict"].contains(summary["status"] as? String ?? "") { types.append(type) }
        }
        return (rows, types)
    }
}
