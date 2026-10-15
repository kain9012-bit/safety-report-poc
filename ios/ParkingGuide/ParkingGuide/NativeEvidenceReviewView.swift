import SwiftUI
import MapKit

struct NativeEvidenceReviewView: View {
    @Binding var draft: ZoneCase
    let store: ZoneStore
    let save: () -> Void
    @AppStorage("evidenceVisionEndpoint") private var endpoint = ""
    @State private var analysisTask: Task<Void, Never>?
    @State private var status = ""
    @State private var analyzing = false
    @State private var mapOpen = false
    @State private var typeToInspect = EvidenceType.other
    @State private var transmissionConfirmed = false
    @State private var regionPhoto: ZoneEvidence?
    @State private var sharedDraft: SharedParkingReview?
    @State private var sharedEditSignature: String?
    @State private var sharedEditCaseID: UUID?

    private var inspected: EvidenceType { typeToInspect == .other ? draft.review.selectedType : typeToInspect }
    private func change(_ update: (inout EvidenceReview) -> Void) {
        var value = draft.review; update(&value); draft.review = value; save()
    }
    private func reviewBinding<T>(_ key: WritableKeyPath<EvidenceReview, T>) -> Binding<T> { Binding(get: { draft.review[keyPath: key] }, set: { value in change { $0[keyPath: key] = value } }) }
    private func sharedBinding<T>(_ key: WritableKeyPath<SharedParkingReview, T>) -> Binding<T> {
        Binding(get: { (sharedDraft ?? draft.review.shared)[keyPath: key] }, set: { value in
            guard var candidate = sharedDraft else { return }
            candidate[keyPath: key] = value; candidate.reviewedSignature = nil; sharedDraft = candidate
        })
    }
    private func beginSharedEditing() {
        sharedDraft = draft.review.shared; sharedEditSignature = draft.reviewSignature; sharedEditCaseID = draft.id
    }
    private func cancelSharedEditing() {
        sharedDraft = nil; sharedEditSignature = nil; sharedEditCaseID = nil
    }
    private func commitSharedEditing() {
        guard var candidate = sharedDraft, sharedEditCaseID == draft.id else {
            cancelSharedEditing(); status = "기록이 바뀌어 편집 내용을 적용하지 않았어요."; return
        }
        let currentSignature = draft.reviewSignature
        let sameContext = sharedEditSignature == currentSignature
        let timesKnown = draft.primaryPair.count == 2 && draft.primaryPair.allSatisfy { $0.takenAt != nil }
        candidate.reviewedSignature = sameContext ? currentSignature : nil
        candidate.photoTimeEvidenceAvailable = sameContext && timesKnown
        change { $0.shared = candidate }
        cancelSharedEditing()
        status = sameContext ? "미확인 항목을 포함해 병행주차 확인 내용을 적용했습니다." : "편집 중 사진·칸·촬영 시각이 바뀌었어요. 작성 내용은 보존했으며 적용 조건은 다시 확인해야 합니다."
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("유형 확인").font(.headline)
            Picker("유형", selection: reviewBinding(\.selectedType)) {
                ForEach(EvidenceType.allCases) { type in Text(type.label).tag(type) }
            }.pickerStyle(.menu)
            if let result = draft.review.aiResult {
                if result.revision != draft.review.revision {
                    Text("사진이 바뀌어 이전 분석은 다시 확인해야 해요.").font(.caption).foregroundStyle(.secondary)
                } else if !result.recommendedTypes.isEmpty {
                    Text("사진에서 찾은 후보: " + result.recommendedTypes.map(\.label).joined(separator: ", ")).font(.subheadline)
                    Text("유형이 맞는지 확인해 주세요.").font(.caption).foregroundStyle(.secondary)
                } else { Text("사진만으로 유형을 정하기 어려워요. 직접 선택할 수 있어요.").font(.caption).foregroundStyle(.secondary) }
            } else { Text("유형을 직접 선택할 수 있어요. 사진 AI 분석은 추가 확인에서 선택할 수 있습니다.").font(.caption).foregroundStyle(.secondary) }
            DisclosureGroup("추가 확인 · 선택") {
            VStack(alignment: .leading, spacing: 18) {
            Text(draft.review.selectedType.guidance).font(.subheadline)
            if !draft.manualCandidates.isEmpty {
                Text("직접 연결한 사진 근거의 후보: " + draft.manualCandidates.map(\.label).joined(separator: ", ")).font(.subheadline)
            }
            Picker("다른 유형 근거도 확인", selection: $typeToInspect) {
                Text("현재 선택 유형").tag(EvidenceType.other)
                ForEach(EvidenceType.allCases.filter { $0 != .other }) { type in Text(type.label).tag(type) }
            }.pickerStyle(.menu)
            ForEach(inspected.questions, id: \.0) { key, title in
                answerQuestion(type: inspected, key: key, title: title)
            }
            if inspected != .other {
                Text("이 답변은 사용자가 직접 확인한 내용이에요. 시설·구역과 차량의 관계 확인이며, 거리·시간·허용 여부는 별도 확인이 필요해요. 안 보이는 것을 없는 것으로 확정하지 않아요.").font(.caption).foregroundStyle(.secondary)
            }
            if draft.review.selectedType == .evcharging || inspected == .evcharging { sharedParking }
            DisclosureGroup("위치 기록·차량 위치 선택") {
                VStack(alignment: .leading, spacing: 10) {
                    if let location = draft.primaryPair.compactMap(\.location).first {
                        Text("사진 촬영 위치: \(location.latitude, specifier: "%.5f"), \(location.longitude, specifier: "%.5f")")
                        Text("\(location.quality) · 단말 보고 오차 \(Int(location.accuracy))m · \(location.sampleCount)개 시각").font(.caption)
                        if let direction = location.cameraDirection { Text("후면 카메라 촬영 방향 추정: \(Int(direction.bearing))° · 실제 기기 정확도 미검증").font(.caption) }
                        else { Text("촬영 방향 품질 미확인 · 후보 제외나 거리 판단에 사용하지 않아요.").font(.caption) }
                    } else { Text("촬영 위치 없음 · 사진·주소는 계속 저장할 수 있어요.").font(.caption) }
                    if let position = draft.review.selectedLocation { Text("사용자 지정 차량 위치: \(position.latitude, specifier: "%.5f"), \(position.longitude, specifier: "%.5f")").font(.caption) }
                    Button("지도에서 차량 위치 선택") { mapOpen = true }.buttonStyle(.bordered)
                    Text("지도는 위치를 설명하는 참고 자료예요. 건물 층·개별 칸·정확한 거리를 확인한 결과가 아니며 직접 쓴 주소는 바뀌지 않아요.").font(.caption).foregroundStyle(.secondary)
                }.padding(.vertical, 10)
            }
            if draft.review.selectedType == .busstop || inspected == .busstop { NativeBusStopReviewView(draft: $draft, endpoint: endpoint, save: save) }
            DisclosureGroup("원본에서 작은 표시·글씨의 부분 지정") { regionControls }
            DisclosureGroup("서버 설정·사진 AI 분석 · 선택 사항") { aiControls }
            if !status.isEmpty { Text(status).font(.caption).foregroundStyle(.secondary) }
            if let result = draft.review.aiResult {
                resultView(result)
            }
            }.padding(.top, 12)
            }
        }.padding(16).background(.white, in: RoundedRectangle(cornerRadius: 14)).overlay(RoundedRectangle(cornerRadius: 14).stroke(ReportAppearance.border))
        .sheet(isPresented: $mapOpen) {
            EvidenceMapPicker(photo: draft.primaryPair.compactMap(\.location).first, selected: draft.review.selectedLocation) { position in
                change { $0.selectedLocation = position }
            }
        }
        .sheet(item: $regionPhoto) { photo in
            if let data = try? store.data(photo), let image = UIImage(data: data) {
                NativeEvidenceRegionPicker(image: image, existing: draft.review.regionHints?[photo.id.uuidString], initialType: inspected, canAnalyze: transmissionConfirmed && !endpoint.isEmpty) { region, runAnalysis in
                    guard draft.evidence.contains(where: { $0.id == photo.id }) else { status = "사진이 바뀌어 영역을 적용하지 않았어요. 현재 사진에서 다시 지정해 주세요."; return }
                    analysisTask?.cancel(); analyzing = false
                    if draft.setAnalysisRegion(region, for: photo.id) { save() }
                    status = "부분 확인 영역을 적용했어요. 이전 분석은 다시 확인하고 원본·작성 내용은 유지합니다."
                    if runAnalysis { analyze() }
                }
            } else {
                VStack(spacing: 12) { Text("보관 원본을 열지 못했어요. 기존 자료는 유지됩니다."); Button("닫기") { regionPhoto = nil } }.padding()
            }
        }
        .onChange(of: draft.id) { _, _ in cancelSharedEditing() }
        .onDisappear { analysisTask?.cancel(); analyzing = false }
    }
    private func answerQuestion(type: EvidenceType, key: String, title: String) -> some View {
        let answerKey = type.rawValue + "." + key
        let current = draft.review.answer(answerKey)
        return VStack(alignment: .leading, spacing: 9) {
            Text(title).font(.subheadline.weight(.medium))
            Picker(title, selection: Binding(get: { current.answer }, set: { answer in
                change { value in var item = value.answer(answerKey); item.answer = answer; item.revision = value.revision; value.answers[answerKey] = item }
            })) { ForEach(ZoneAnswer.allCases, id: \.self) { Text($0 == .yes ? "확인했어요" : $0 == .no ? "아니에요" : "모르겠어요").tag($0) } }.pickerStyle(.segmented)
            if current.answer != .unknown {
                Text(current.revision == draft.review.revision ? "이 답변의 사진 근거 선택" : "사진이 바뀌었어요. 기존 답변을 보존했으며 다시 확인해 주세요.").font(.caption)
                ForEach(Array(draft.evidence.enumerated()), id: \.element.id) { index, photo in
                    Button {
                        change { value in
                            var answer = value.answer(answerKey)
                            if answer.photoIDs.contains(photo.id) { answer.photoIDs.removeAll { $0 == photo.id } } else { answer.photoIDs.append(photo.id) }
                            answer.revision = value.revision; value.answers[answerKey] = answer
                        }
                    } label: { Label("사진 \(index + 1) · \(photo.primarySlot?.label ?? "역할 미지정")", systemImage: current.photoIDs.contains(photo.id) ? "checkmark.square.fill" : "square").font(.caption).frame(minHeight: 36) }
                }
                if current.photoIDs.isEmpty { Text("근거 사진 미연결 · 유형 확인 완료로 취급하지 않아요.").font(.caption).foregroundStyle(.secondary) }
            }
        }
    }
    private var sharedParking: some View {
        VStack(alignment: .leading, spacing: 12) {
            Divider()
            Text("일반 자동차 병행주차 안내 확인").font(.headline)
            Text("보관한 기록: " + draft.review.shared.finding(signature: draft.reviewSignature)).font(.subheadline.weight(.medium))
            if sharedDraft == nil {
                Button("기록 확인·수정") { beginSharedEditing() }.buttonStyle(.bordered)
            }
            if let observation = draft.review.aiResult?.observations.first(where: { $0.sharedNotice?.text.isEmpty == false }), let notice = observation.sharedNotice {
                Text("AI가 읽은 안내: " + notice.text).font(.caption)
                Text("적용 범위: " + notice.bay + " · 시간: " + notice.time).font(.caption)
                Button("AI 원문을 편집 후보로 가져오기") {
                    if sharedDraft == nil { beginSharedEditing() }
                    var candidate = sharedDraft ?? draft.review.shared
                    candidate.observed = .yes; candidate.kind = ["general_car", "ev_extra_time", "both", "other"].contains(notice.kind) ? notice.kind : "unclear"
                    candidate.noticeText = notice.text; candidate.scope = notice.bay
                    candidate.timeConditions = [notice.time, notice.conditions].filter { !$0.isEmpty }.joined(separator: " · ")
                    candidate.source = notice.issuer; candidate.photoIDs = [observation.photoID]
                    candidate.appliesToBay = .unknown; candidate.appliesAtPhotoTime = .unknown
                    candidate.conditionsComplete = .unknown; candidate.conflicting = .unknown
                    candidate.reviewedSignature = nil; candidate.photoTimeEvidenceAvailable = nil
                    sharedDraft = candidate
                }.buttonStyle(.bordered).disabled(draft.review.aiResult?.revision != draft.review.revision)
            }
            if sharedDraft != nil {
                Text("편집 중인 내용은 아래 기록 버튼을 눌러야 반영됩니다. 취소하면 보관한 답변을 그대로 유지해요.").font(.caption).foregroundStyle(.secondary)
                if sharedEditSignature != draft.reviewSignature {
                    Text("편집 중 사진·칸·촬영 시각이 바뀌었어요. 저장하더라도 적용 여부는 재확인 상태로 남깁니다.").font(.caption).foregroundStyle(.orange)
                }
                Text("이 차량이 있는 칸에 일반 자동차도 주차할 수 있다는 안내가 있나요?").font(.subheadline)
                Picker("일반차 안내", selection: sharedBinding(\.observed)) {
                    Text("있어요").tag(ZoneAnswer.yes); Text("보이지 않아요").tag(ZoneAnswer.no); Text("확인 어려워요").tag(ZoneAnswer.unknown)
                }.pickerStyle(.segmented)
                if sharedDraft?.observed == .yes {
                    Picker("안내 대상", selection: sharedBinding(\.kind)) {
                        Text("미확인").tag("unclear"); Text("일반 자동차 허용").tag("general_car"); Text("전기차 시간 연장만").tag("ev_extra_time"); Text("두 가지 모두").tag("both"); Text("다른 안내").tag("other")
                    }
                    TextField("읽은 안내 원문", text: sharedBinding(\.noticeText), axis: .vertical).textFieldStyle(.roundedBorder)
                    TextField("적용 층·주차면·차량 조건", text: sharedBinding(\.scope), axis: .vertical).textFieldStyle(.roundedBorder)
                    TextField("요일·시간·기간·휴일·거주자 조건", text: sharedBinding(\.timeConditions), axis: .vertical).textFieldStyle(.roundedBorder)
                    TextField("게시 주체·자료 출처 (확인한 경우)", text: sharedBinding(\.source)).textFieldStyle(.roundedBorder)
                    sharedQuestion("그 안내가 차량이 있는 칸에 적용되나요?", \.appliesToBay)
                    sharedQuestion("기본 사진 각각의 촬영 시각이 안내 조건에 맞나요?", \.appliesAtPhotoTime)
                    sharedQuestion("잘리거나 읽지 못한 조건이 없나요?", \.conditionsComplete)
                    sharedQuestion("서로 충돌하는 안내가 있나요?", \.conflicting)
                    ForEach(draft.primaryPair) { photo in
                        Text("\(photo.primarySlot?.label ?? "기본 사진") · " + koreanPhotoTime(photo.takenAt)).font(.caption)
                    }
                    Text("현재 시각이나 업로드 시각 대신 촬영 시각을 확인하세요. 자정·요일·휴일·유효 기간 경계와 두 사진 사이 조건 변경이 불명확하면 ‘모르겠어요’를 남기세요.").font(.caption).foregroundStyle(.secondary)
                    ForEach(Array(draft.evidence.enumerated()), id: \.element.id) { index, photo in
                        Button {
                            guard var candidate = sharedDraft else { return }
                            if candidate.photoIDs.contains(photo.id) { candidate.photoIDs.removeAll { $0 == photo.id } } else { candidate.photoIDs.append(photo.id) }
                            candidate.reviewedSignature = nil; sharedDraft = candidate
                        } label: { Label("안내 근거: 사진 \(index + 1)", systemImage: sharedDraft?.photoIDs.contains(photo.id) == true ? "checkmark.square.fill" : "square").font(.caption).frame(minHeight: 36) }
                    }
                }
                Button("미확인 내용도 함께 기록") { commitSharedEditing() }.buttonStyle(.borderedProminent)
                Button("취소 · 보관한 답변 유지") {
                    cancelSharedEditing(); status = "병행주차 기록 편집을 취소했어요. 보관한 답변은 바뀌지 않았습니다."
                }.buttonStyle(.bordered)
            }
            Text("공용·무료·고장 안내나 전기차 시간 연장은 일반차 허용과 달라요. 표지가 있어도 법적 허용·신고 불가를 확정하지 않으며 옆 칸·진입 방해·장애인구역 조건도 따로 확인해요.").font(.caption).foregroundStyle(.secondary)
        }
    }
    private func koreanPhotoTime(_ date: Date?) -> String {
        guard let date else { return "촬영 시각 미확인" }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ko_KR")
        formatter.timeZone = TimeZone(identifier: "Asia/Seoul")
        formatter.dateFormat = "yyyy-MM-dd HH:mm:ss '한국 시각'"
        return formatter.string(from: date)
    }
    private func sharedQuestion(_ title: String, _ key: WritableKeyPath<SharedParkingReview, ZoneAnswer>) -> some View {
        VStack(alignment: .leading) {
            Text(title).font(.caption)
            Picker(title, selection: sharedBinding(key)) {
                Text("맞아요").tag(ZoneAnswer.yes); Text("아니에요").tag(ZoneAnswer.no); Text("모르겠어요").tag(ZoneAnswer.unknown)
            }.pickerStyle(.segmented)
        }
    }
    private var regionControls: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("원본에서 확인할 부분을 끌어서 지정하세요. 지정은 검색 위치를 알려 주는 입력이며 AI 확인이나 새 촬영으로 처리하지 않아요.").font(.caption).foregroundStyle(.secondary)
            ForEach(Array(draft.evidence.enumerated()), id: \.element.id) { index, photo in
                VStack(alignment: .leading, spacing: 6) {
                    Button("사진 \(index + 1) · \(photo.primarySlot?.label ?? "역할 미지정") 부분 지정") { regionPhoto = photo }.buttonStyle(.bordered)
                    if let hint = draft.review.regionHints?[photo.id.uuidString] {
                        Text("저장한 부분: " + hint.type.label).font(.caption)
                        Button("이 사진의 부분 지정 해제") {
                            analysisTask?.cancel(); analyzing = false
                            if draft.setAnalysisRegion(nil, for: photo.id) { save() }
                            status = "부분 지정을 해제했어요. 원본·기존 답변은 유지하고 분석은 다시 확인합니다."
                        }.font(.caption)
                    }
                }
            }
            if draft.evidence.isEmpty { Text("사진을 보관한 뒤 부분을 지정할 수 있어요.").font(.caption) }
        }.padding(.vertical, 10)
    }
    private var aiControls: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("분석할 때만 보관 사진의 축소본을 설정한 서버와 서버의 AI 제공자에게 전송합니다. 위치·주소·작성 내용은 보내지 않아요. 원본은 기기에 유지됩니다.").font(.caption)
            TextField("https://내-서버/api/vision", text: $endpoint).textContentType(.URL).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled().textFieldStyle(.roundedBorder)
            Text("본인이 운영·신뢰하는 중계 서버 주소를 입력하세요. API 키는 앱에 입력·보관하지 않습니다. 서버가 설정되지 않아도 수동 확인·촬영·저장할 수 있습니다.").font(.caption).foregroundStyle(.secondary)
            Toggle("사진을 이 서버로 보내 분석", isOn: $transmissionConfirmed).font(.subheadline)
            Button(analyzing ? "분석 중…" : "보관 사진의 근거 분석") { analyze() }.buttonStyle(.borderedProminent).disabled(analyzing || !transmissionConfirmed || draft.evidence.isEmpty)
            if analyzing { Button("분석 취소 · 자료 유지") { analysisTask?.cancel(); analyzing = false; status = "분석을 취소했습니다. 기존 자료와 선택은 유지됩니다." }.buttonStyle(.bordered) }
            Text("기본 사진 쌍을 함께 분석하고 보완사진은 따로 분석합니다. 보완사진은 시간 간격·계속 정차 증명으로 합치지 않아요.").font(.caption)
        }.padding(.vertical, 10)
    }
    private func resultView(_ result: NativeAIResult) -> some View {
        VStack(alignment: .leading, spacing: 9) {
            Text(result.revision == draft.review.revision ? "사진 AI 근거" : "이전 사진의 분석 · 다시 분석 필요").font(.headline)
            Text(result.summary).font(.caption)
            ForEach(result.observations) { value in
                Text("\(value.type.label): 식별 \(triLabel(value.identity)) · 대상 연결 \(triLabel(value.target)) · 차량 관계 \(triLabel(value.relation))").font(.caption)
                if let photo = draft.evidence.first(where: { $0.id == value.photoID }), !draft.evidenceEligible(photo) { Text("이 사진의 대상 차량·장소 연결 미확인 · 추천에 합치지 않았어요.").font(.caption) }
                if !value.text.isEmpty { Text(value.text).font(.caption) }
                if !value.unknownReasons.isEmpty { Text("미확인: " + value.unknownReasons.joined(separator: " · ")).font(.caption).foregroundStyle(.secondary) }
            }
            if result.revision == draft.review.revision {
                ForEach(result.recommendedTypes, id: \.self) { type in
                    Button("\(type.label) 후보를 내가 선택") { change { $0.selectedType = type; $0.selectionSource = "user_after_ai" } }.buttonStyle(.bordered)
                }
            }
            Text("추천은 관찰 근거의 후보입니다. 거리·지역 접수 요건·주차 허용·위반 여부는 미확인입니다.").font(.caption).foregroundStyle(.secondary)
        }
    }
    private func triLabel(_ raw: String) -> String { raw == "yes" ? "보임" : raw == "no" ? "아님" : "미확인" }
    private func analyze() {
        analysisTask?.cancel()
        let captured = draft; let address = endpoint
        analyzing = true; status = "원본을 유지하면서 사진 근거를 확인합니다."
        analysisTask = Task { @MainActor in
            do {
                let result = try await NativeVisionClient.analyze(draft: captured, store: store, endpoint: address, regionHints: captured.nativeRegionHints)
                try Task.checkCancellation()
                guard draft.review.revision == captured.review.revision, draft.evidence.map(\.id) == captured.evidence.map(\.id) else {
                    analyzing = false; status = "분석 중 사진이 바뀌어 이전 응답을 적용하지 않았습니다."; return
                }
                change { $0.aiResult = result }; status = "분석 결과를 보관했습니다. 선택한 유형·주소·내용은 유지됩니다."
            } catch {
                if !Task.isCancelled { status = error.localizedDescription }
            }
            if !Task.isCancelled { analyzing = false }
        }
    }
}

private struct NativeEvidenceRegionPicker: View {
    @Environment(\.dismiss) private var dismiss
    let image: UIImage
    let canAnalyze: Bool
    let apply: (EvidenceRegion, Bool) -> Void
    @State private var type: EvidenceType
    @State private var box: [Double]?
    init(image: UIImage, existing: EvidenceRegion?, initialType: EvidenceType, canAnalyze: Bool, apply: @escaping (EvidenceRegion, Bool) -> Void) {
        self.image = image; self.canAnalyze = canAnalyze; self.apply = apply
        _type = State(initialValue: existing?.type ?? (initialType == .other ? .hydrant : initialType))
        _box = State(initialValue: existing?.isValid == true ? existing?.box : nil)
    }
    private var valid: Bool {
        guard let box, EvidenceRegion(type: type, box: box).isValid else { return false }
        let width = (box[3] - box[1]) / 1000 * image.size.width, height = (box[2] - box[0]) / 1000 * image.size.height
        return width >= 24 && height >= 24 && width * height < image.size.width * image.size.height * 0.85
    }
    private func commit(analyze: Bool) {
        guard valid, let box else { return }
        apply(EvidenceRegion(type: type, box: box), analyze); dismiss()
    }
    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 12) {
                Text("확인할 부분의 한쪽 모서리에서 반대쪽 모서리까지 끌어 주세요. 취소하면 저장된 영역은 바뀌지 않아요.").font(.subheadline)
                Picker("확인할 표시", selection: $type) {
                    ForEach(EvidenceType.allCases.filter { $0 != .other }) { value in Text(value.label).tag(value) }
                }.pickerStyle(.menu)
                GeometryReader { geometry in
                    let ratio = image.size.width / max(1, image.size.height)
                    let width = min(geometry.size.width, geometry.size.height * ratio)
                    let size = CGSize(width: width, height: width / max(0.001, ratio))
                    ZStack(alignment: .topLeading) {
                        Image(uiImage: image).resizable().frame(width: size.width, height: size.height)
                        if let box, box.count == 4 {
                            Rectangle().fill(.orange.opacity(0.15)).overlay(Rectangle().stroke(.orange, lineWidth: 3))
                                .frame(width: CGFloat(box[3] - box[1]) / 1000 * size.width, height: CGFloat(box[2] - box[0]) / 1000 * size.height)
                                .offset(x: CGFloat(box[1]) / 1000 * size.width, y: CGFloat(box[0]) / 1000 * size.height)
                        }
                    }.frame(width: size.width, height: size.height).contentShape(Rectangle())
                        .gesture(DragGesture(minimumDistance: 0).onChanged { value in box = EvidenceRegion.box(from: value.startLocation, to: value.location, within: size) })
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }.frame(minHeight: 220)
                if !valid { Text("너무 작거나 사진 전체에 가까운 영역은 제외해요. 확인할 표시 주변을 다시 지정해 주세요.").font(.caption).foregroundStyle(.secondary) }
                Text("원본 전체와 이 부분을 함께 확인합니다. 잘린 부분만으로 차량·장소 연결이나 거리를 확인하지 않아요.").font(.caption).foregroundStyle(.secondary)
                Button("영역만 저장") { commit(analyze: false) }.buttonStyle(.bordered).disabled(!valid)
                Button("영역 적용 후 사진 분석") { commit(analyze: true) }.buttonStyle(.borderedProminent).disabled(!valid || !canAnalyze)
                if !canAnalyze { Text("바로 분석하려면 서버 설정과 사진 전송 선택을 먼저 확인하세요. 영역만 저장할 수도 있어요.").font(.caption).foregroundStyle(.secondary) }
            }.padding().navigationTitle("원본 부분 지정").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("취소") { dismiss() } } }
        }
    }
}

private struct EvidenceMapPicker: View {
    @Environment(\.dismiss) private var dismiss
    let photo: LocationRecord?
    let selected: SelectedLocation?
    let apply: (SelectedLocation) -> Void
    @State private var position: MapCameraPosition
    @State private var center: CLLocationCoordinate2D
    init(photo: LocationRecord?, selected: SelectedLocation?, apply: @escaping (SelectedLocation) -> Void) {
        self.photo = photo; self.selected = selected; self.apply = apply
        let point = CLLocationCoordinate2D(latitude: selected?.latitude ?? photo?.latitude ?? 37.5665, longitude: selected?.longitude ?? photo?.longitude ?? 126.9780)
        _center = State(initialValue: point)
        _position = State(initialValue: .region(MKCoordinateRegion(center: point, span: MKCoordinateSpan(latitudeDelta: 0.005, longitudeDelta: 0.005))))
    }
    var body: some View {
        NavigationStack {
            VStack(spacing: 12) {
                Text("지도를 움직여 가운데 표시를 차량 위치에 놓으세요. ‘위치 적용’을 누르기 전까지 초안은 바뀌지 않아요.").font(.subheadline).padding(.horizontal)
                if photo == nil && selected == nil { Text("위치 정보가 없어 서울 중심에서 시작합니다. 현재 내 위치가 아닙니다.").font(.caption).foregroundStyle(.secondary) }
                Map(position: $position) {
                    if let photo { Marker("사진 촬영 위치", coordinate: CLLocationCoordinate2D(latitude: photo.latitude, longitude: photo.longitude)).tint(.blue) }
                    if let selected { Marker("저장한 차량 위치", coordinate: CLLocationCoordinate2D(latitude: selected.latitude, longitude: selected.longitude)).tint(.orange) }
                }.overlay { Image(systemName: "plus.circle.fill").font(.largeTitle).foregroundStyle(.orange) }
                .onMapCameraChange { context in center = context.region.center }
                HStack {
                    if let photo { Button("사진 위치로 이동") { position = .region(MKCoordinateRegion(center: CLLocationCoordinate2D(latitude: photo.latitude, longitude: photo.longitude), span: MKCoordinateSpan(latitudeDelta: 0.005, longitudeDelta: 0.005))) } }
                    Button("위치 적용") { apply(.init(latitude: center.latitude, longitude: center.longitude, selectedAt: Date())); dismiss() }.buttonStyle(.borderedProminent)
                }.padding()
                Text("Apple 지도 · 사용자 지정 위치는 사진의 촬영 위치·주소를 덮어쓰지 않습니다.").font(.caption).padding(.horizontal)
            }.navigationTitle("차량 위치 선택").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("취소") { dismiss() } } }
        }
    }
}

struct NativePhotoInspector: View {
    let image: UIImage
    @State private var zoom = 1.0
    @State private var previousZoom = 1.0
    var body: some View {
        GeometryReader { geometry in
            ScrollView([.horizontal, .vertical]) {
                Image(uiImage: image).resizable().scaledToFit().frame(width: max(geometry.size.width, geometry.size.width * zoom))
                    .gesture(MagnifyGesture().onChanged { value in zoom = min(6, max(1, previousZoom * value.magnification)) }.onEnded { _ in previousZoom = zoom })
                    .onTapGesture(count: 2) { zoom = zoom > 1 ? 1 : 3; previousZoom = zoom }
            }
        }.overlay(alignment: .bottom) { Text("두 손가락 또는 두 번 눌러 원본 확대 · 확대는 새 글자나 화질을 만들지 않아요").font(.caption).padding().background(.regularMaterial) }
    }
}
