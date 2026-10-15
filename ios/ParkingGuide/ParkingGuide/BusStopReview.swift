import SwiftUI
import CoreLocation

struct NativeBusStop: Codable, Identifiable {
    var id: String; var name: String; var lat: Double; var lng: Double
    var source: String?; var regionCode: String?; var publicId: String?; var publicIdNamespace: String?
    var identity: String { [source ?? "unknown", regionCode ?? "unknown", id].map { "\($0.utf8.count):\($0)" }.joined(separator: "|") }
}
struct NativeStopSearch: Codable {
    var stops: [NativeBusStop]
    var latitude: Double; var longitude: Double; var queriedAt: Date
    var partial: Bool; var sourceUpdatedAt: String?
    var selectedIdentity: String?
    var selectedStop: NativeBusStop? = nil
    var selectionSignature: String? = nil
    var querySignature: String? = nil
}
struct NativeStopContext {
    var photoID: UUID?
    var capturedAt: Date?
    var latitude: Double; var longitude: Double
    var role: String
    var location: LocationRecord?
    var photoEvidence: NativeBusStopPhoto?
    var conflictingNumbers: Bool
    var exactPhotoContext: Bool
}
struct NativeStopCandidate: Identifiable {
    var stop: NativeBusStop; var distance: Double; var bearing: Double
    var directionDifference: Double?
    var numberMatch = "unknown"
    var reasons: [String] = []; var conflicts: [String] = []
    var id: String { stop.identity }
}
enum NativeStopMatcher {
    static func context(_ draft: ZoneCase) -> NativeStopContext? {
        let primary = draft.primaryPair
        let observations = draft.review.aiResult?.revision == draft.review.revision ? (draft.review.aiResult?.observations ?? []).filter { observation in
            observation.type == .busstop && observation.busStop?.readable == true && draft.evidence.contains { $0.id == observation.photoID && draft.evidenceEligible($0) }
        } : []
        let observation = observations.first { o in primary.contains { $0.id == o.photoID } } ?? observations.first
        let evidencePhoto = observation.flatMap { o in draft.evidence.first { $0.id == o.photoID } }
        let photo = evidencePhoto?.location != nil ? evidencePhoto : primary.first { $0.location != nil }
        let selected = draft.review.selectedLocation
        guard let latitude = selected?.latitude ?? photo?.location?.latitude, let longitude = selected?.longitude ?? photo?.location?.longitude,
              CLLocationCoordinate2DIsValid(.init(latitude: latitude, longitude: longitude)) else { return nil }
        let numbers = Set(observations.compactMap { $0.busStop?.publicId.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty })
        return .init(photoID: evidencePhoto?.id, capturedAt: evidencePhoto?.takenAt, latitude: latitude, longitude: longitude, role: selected == nil ? "photo" : "manual_vehicle", location: selected == nil ? photo?.location : nil, photoEvidence: observation?.busStop, conflictingNumbers: numbers.count > 1, exactPhotoContext: selected == nil && evidencePhoto?.id != nil && evidencePhoto?.id == photo?.id)
    }
    static func signature(_ draft: ZoneCase) -> String {
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
        let observationData = (try? encoder.encode(draft.review.aiResult)) ?? Data()
        let selectedData = (try? encoder.encode(draft.review.selectedLocation)) ?? Data()
        let photoLocations = (try? encoder.encode(draft.evidence.map(\.location))) ?? Data()
        return [draft.reviewSignature, selectedData.base64EncodedString(), photoLocations.base64EncodedString(), observationData.base64EncodedString()].joined(separator: "|")
    }
    static func difference(_ a: Double, _ b: Double) -> Double { let value = abs(a - b).truncatingRemainder(dividingBy: 360); return min(value, 360 - value) }
    static func bearing(latitude: Double, longitude: Double, stop: NativeBusStop) -> Double {
        let rad = Double.pi / 180, delta = (stop.lng - longitude) * rad
        let east = sin(delta) * cos(stop.lat * rad)
        let north = cos(latitude * rad) * sin(stop.lat * rad) - sin(latitude * rad) * cos(stop.lat * rad) * cos(delta)
        return (atan2(east, north) / rad + 360).truncatingRemainder(dividingBy: 360)
    }
    static func candidates(_ search: NativeStopSearch, context: NativeStopContext) -> [NativeStopCandidate] {
        let at = CLLocation(latitude: context.latitude, longitude: context.longitude)
        return search.stops.map { stop in
            let distance = at.distance(from: CLLocation(latitude: stop.lat, longitude: stop.lng))
            let bearing = bearing(latitude: context.latitude, longitude: context.longitude, stop: stop)
            let origin = context.role == "photo" ? "촬영 위치" : "사용자가 지정한 차량 위치"
            var result = NativeStopCandidate(stop: stop, distance: distance, bearing: bearing, reasons: ["\(origin)에서 자료 좌표까지 지도상 약 \(Int(distance))m · 차량의 10m 이내 여부 미확인"])
            if let photo = context.photoEvidence, photo.readable, !photo.publicId.isEmpty, let publicID = stop.publicId, !publicID.isEmpty {
                let sameText = photo.publicId.trimmingCharacters(in: .whitespacesAndNewlines) == publicID.trimmingCharacters(in: .whitespacesAndNewlines)
                let sameNamespace = photo.publicIdNamespace?.isEmpty == false && photo.publicIdNamespace == stop.publicIdNamespace
                result.numberMatch = sameNamespace ? (sameText ? "match" : "different") : (sameText ? "text_only" : "unknown")
                if result.numberMatch == "match" { result.reasons.insert("사진 공개 번호와 확인된 번호 체계가 일치해요.", at: 0) }
                else if result.numberMatch == "text_only" { result.reasons.insert("번호 글자는 같지만 지역·번호 체계 연결은 미확인이에요.", at: 0) }
            }
            if let photo = context.photoEvidence, !photo.name.isEmpty, photo.name == stop.name { result.reasons.append("사진 이름과 같아요. 동명 정류소가 있을 수 있어요.") }
            if context.exactPhotoContext, context.role == "photo", let location = context.location, location.quality == "주변 탐색 참고", location.accuracy >= 0, location.accuracy < distance,
               let direction = location.cameraDirection, direction.reference == "true", let accuracy = direction.accuracy, accuracy.isFinite, accuracy >= 0, accuracy <= 30,
               direction.horizontalProjection >= 0.25, direction.horizontalProjection <= 1.01,
               let capturedAt = context.capturedAt, direction.measuredAt <= capturedAt, capturedAt.timeIntervalSince(direction.measuredAt) <= 1,
               direction.receivedAt.map({ $0 <= capturedAt }) == true,
               location.measuredAt <= capturedAt, capturedAt.timeIntervalSince(location.measuredAt) <= 5 {
                let difference = difference(direction.bearing, bearing); result.directionDifference = difference
                if difference <= 30 { result.reasons.append("품질을 확인한 촬영 방향과 비슷해요. 실제 사진 가시성은 별도 확인해요.") }
                if result.numberMatch == "match" && difference > 90 { result.conflicts.append("사진 번호와 촬영 방향이 달라 재확인이 필요해요.") }
            } else { result.reasons.append("위치·방향 품질 또는 같은 사진 연결이 부족해 방향은 순위에 반영하지 않았어요.") }
            if context.conflictingNumbers { result.conflicts.append("사진에서 서로 다른 번호가 읽혀 대상 정류소를 확인해야 해요.") }
            if search.partial { result.reasons.append("일부 자료여서 빠진 후보가 있을 수 있어요.") }
            return result
        }.sorted { a, b in
            let aMatch = a.numberMatch == "match" ? 2 : a.numberMatch == "text_only" ? 1 : 0, bMatch = b.numberMatch == "match" ? 2 : b.numberMatch == "text_only" ? 1 : 0
            if aMatch != bMatch { return aMatch > bMatch }
            if (a.directionDifference ?? 361) != (b.directionDifference ?? 361) { return (a.directionDifference ?? 361) < (b.directionDifference ?? 361) }
            return a.distance == b.distance ? a.id < b.id : a.distance < b.distance
        }.map { candidate in
            var value = candidate
            if candidate.numberMatch == "match", search.stops.filter({ $0.publicId == candidate.stop.publicId && $0.publicIdNamespace == candidate.stop.publicIdNamespace }).count > 1 { value.conflicts.append("같은 번호 체계에 일치 후보가 여러 개 있어요.") }
            return value
        }
    }
    static func selectionCurrent(_ search: NativeStopSearch, draft: ZoneCase) -> Bool {
        guard search.selectionSignature == signature(draft), let identity = search.selectedIdentity, let chosen = search.selectedStop,
              let current = search.stops.first(where: { $0.identity == identity }), current.lat == chosen.lat, current.lng == chosen.lng,
              current.publicId == chosen.publicId, current.publicIdNamespace == chosen.publicIdNamespace else { return false }
        return context(draft)?.conflictingNumbers != true
    }
}
@MainActor enum NativeStopClient {
    static func fetch(endpoint: String, latitude: Double, longitude: Double, session: URLSession = .shared) async throws -> NativeStopSearch {
        let base = try NativeVisionClient.endpointURL(endpoint)
        guard latitude.isFinite, longitude.isFinite, (-90...90).contains(latitude), (-180...180).contains(longitude) else { throw NativeVisionError(message: "조회할 위치를 확인해 주세요.") }
        var url = URLComponents(url: base.deletingLastPathComponent().appendingPathComponent("stops"), resolvingAgainstBaseURL: false)!
        url.queryItems = [.init(name: "lat", value: String(latitude)), .init(name: "lng", value: String(longitude))]
        var request = URLRequest(url: url.url!); request.timeoutInterval = 15
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode), data.count < 2_000_000,
              let object = try JSONSerialization.jsonObject(with: data) as? [String: Any], let stops = object["stops"] as? [[String: Any]] else {
            throw NativeVisionError(message: "정류소 자료를 불러오지 못했습니다. 기존 사진·후보는 유지합니다. 정류소가 없다는 뜻은 아닙니다.")
        }
        let decoded = try JSONDecoder().decode([NativeBusStop].self, from: JSONSerialization.data(withJSONObject: stops))
        let coverage = object["coverage"] as? [String: Any]
        return .init(stops: decoded.filter { $0.lat.isFinite && $0.lng.isFinite && (-90...90).contains($0.lat) && (-180...180).contains($0.lng) && !$0.id.isEmpty }, latitude: latitude, longitude: longitude, queriedAt: Date(), partial: coverage?["partial"] as? Bool ?? true, sourceUpdatedAt: coverage?["sourceUpdatedAt"] as? String)
    }
}
struct NativeBusStopReviewView: View {
    @Binding var draft: ZoneCase
    let endpoint: String
    let save: () -> Void
    @State private var status = ""
    @State private var busy = false
    @State private var showAll = false
    @State private var task: Task<Void, Never>?
    private var context: NativeStopContext? { NativeStopMatcher.context(draft) }
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("정류소 후보 대조").font(.headline)
            Text("사진의 정류소 이름·공개 번호·도로 쪽을 후보와 대조하세요. 가장 가까운 정류소를 자동 선택하지 않아요.").font(.caption)
            Button(busy ? "정류소 조회 중…" : "이 위치를 서버에 보내 정류소 후보 조회") { search() }.buttonStyle(.bordered).disabled(busy || context == nil)
            if context == nil { Text("기본 사진의 촬영 위치를 기록하거나 지도에서 차량 위치를 선택하면 후보를 조회할 수 있어요.").font(.caption) }
            if let photo = context?.photoEvidence { Text("사진 공개 번호: \(photo.publicId.isEmpty ? "미확인" : photo.publicId) · \(photo.name)").font(.caption) }
            if let search = draft.review.stopSearch {
                Text("TAGO 조회 \(search.queriedAt.formatted(date: .abbreviated, time: .standard)) · 원자료 갱신일 \(search.sourceUpdatedAt ?? "미제공")").font(.caption)
                Text(search.partial ? "일부 자료만 조회됨 · 목록에 없다고 정류소가 없는 것은 아니에요." : "조회 응답 수신 완료 · 현장 완전성 미확인").font(.caption)
                if search.stops.isEmpty { Text("조회된 후보가 없어요. 사진 근거와 수동 입력은 유지됩니다.").font(.caption) }
                if search.querySignature != NativeStopMatcher.signature(draft) { Text("사진·위치·근거가 바뀌었어요. 이전 후보를 보존했으며 다시 조회·대조가 필요해요.").font(.caption).foregroundStyle(.orange) }
                if search.selectedIdentity != nil { Text("사용자 선택: \(search.selectedStop?.name ?? search.selectedIdentity ?? "") · 거리 미확인" + (NativeStopMatcher.selectionCurrent(search, draft: draft) ? "" : " · 재확인 필요")).font(.caption.weight(.medium)) }
                if let context {
                    let candidates = NativeStopMatcher.candidates(search, context: context)
                    ForEach(Array(candidates.prefix(showAll ? candidates.count : 3))) { candidate in
                        Button { select(candidate.stop) } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                Label(candidate.stop.name, systemImage: search.selectedIdentity == candidate.id ? "checkmark.circle.fill" : "circle")
                                Text("공개 번호 \(candidate.stop.publicId ?? "미제공") · \(candidate.stop.publicIdNamespace ?? "번호 체계 미확인")").font(.caption)
                                Text((candidate.conflicts + candidate.reasons).joined(separator: " · ")).font(.caption)
                            }.frame(maxWidth: .infinity, alignment: .leading).padding(8)
                        }.buttonStyle(.bordered)
                    }
                    if candidates.count > 3 { Button(showAll ? "상위 3개만 보기" : "전체 후보 \(candidates.count)개 보기") { showAll.toggle() } }
                }
                Button("선택 해제 · 후보 미확인") { var review = draft.review; review.stopSearch?.selectedIdentity = nil; review.stopSearch?.selectedStop = nil; review.stopSearch?.selectionSignature = nil; draft.review = review; save() }
            }
            if !status.isEmpty { Text(status).font(.caption) }
            Text("조회 시각과 자료 갱신일은 달라요. 좌표 간 거리는 법적 10m 측정이 아니며 사진 번호를 내부 자료 ID와 비교하지 않아요. 이 선택은 주소·유형을 바꾸지 않아요.").font(.caption).foregroundStyle(.secondary)
        }.onDisappear { task?.cancel(); busy = false }
    }
    private func select(_ stop: NativeBusStop) {
        var review = draft.review
        review.stopSearch?.selectedIdentity = stop.identity; review.stopSearch?.selectedStop = stop
        review.stopSearch?.selectionSignature = NativeStopMatcher.signature(draft)
        draft.review = review; save()
    }
    private func search() {
        guard let context else { return }
        task?.cancel(); busy = true; status = ""
        let signature = NativeStopMatcher.signature(draft), address = endpoint
        task = Task { @MainActor in
            do {
                var result = try await NativeStopClient.fetch(endpoint: address, latitude: context.latitude, longitude: context.longitude)
                try Task.checkCancellation()
                guard NativeStopMatcher.signature(draft) == signature, endpoint == address else { busy = false; status = "사진·위치·설정이 바뀌어 이전 조회 결과를 적용하지 않았어요."; return }
                result.querySignature = signature
                result.selectedIdentity = draft.review.stopSearch?.selectedIdentity
                result.selectedStop = draft.review.stopSearch?.selectedStop
                result.selectionSignature = draft.review.stopSearch?.selectionSignature
                var review = draft.review; review.stopSearch = result; draft.review = review; save()
            } catch { if !Task.isCancelled { status = error.localizedDescription } }
            if !Task.isCancelled { busy = false }
        }
    }
}
