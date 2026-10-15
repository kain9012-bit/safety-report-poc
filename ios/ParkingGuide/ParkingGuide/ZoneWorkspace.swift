import SwiftUI
import PhotosUI

private let zoneAccent = ReportAppearance.blue

struct ZoneLibrary: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var store: ZoneStore
    @State private var startWithCapture = false
    @State private var selected: ZoneCase?
    @State private var deleting: ZoneCase?
    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                ReportPrototypeNotice()
                ReportPageHeader(title: "보관한 초안", onBack: { dismiss() })
                ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    ZoneCard("사진으로 시작하기") {
                        Button {
                            var value = ZoneCase(); value.version = 2; value.evidenceReview = EvidenceReview()
                            do { try store.save(value); startWithCapture = true; selected = value }
                            catch { store.error = "초안을 만들지 못했습니다. 다시 시도해 주세요." }
                        } label: { Label("사진부터 찍기", systemImage: "plus").frame(maxWidth: .infinity).frame(minHeight: 44) }
                            .buttonStyle(ReportButtonStyle(primary: true))
                        Text("사진과 작성 내용은 기기에 보관됩니다.").font(.caption).foregroundStyle(.secondary)
                    }
                    Text("보관한 초안 \(store.cases.count)건").font(.headline)
                    if store.cases.isEmpty { Text("아직 초안이 없어요.").foregroundStyle(.secondary) }
                    ForEach(store.cases) { item in
                        ZoneCard(item.facility.isEmpty ? "사진 근거·유형 확인" : item.facility) {
                            Text(item.review.selectedType.label).font(.subheadline)
                            Text(item.address.isEmpty ? "주소 미입력 · 자료 \(item.evidence.count)장" : "\(item.address) · 자료 \(item.evidence.count)장").font(.caption).foregroundStyle(.secondary)
                            HStack {
                                Button("이어서 확인") { startWithCapture = false; selected = item }.buttonStyle(ReportButtonStyle()).frame(minHeight: 44)
                                Spacer()
                                Button("삭제", role: .destructive) { deleting = item }.frame(minHeight: 44)
                            }
                        }
                    }
                    Text("초안은 이 기기에만 보관합니다. 직접 삭제하기 전까지 자동 정리하지 않습니다.").font(.caption).foregroundStyle(.secondary)
                }.padding(20)
                }.background(ReportAppearance.canvas)
            }.toolbar(.hidden, for: .navigationBar)
                .fullScreenCover(item: $selected) { value in ZoneWorkspace(initial: value, store: store, startWithCapture: startWithCapture) }
                .confirmationDialog("이 초안과 자료를 삭제할까요?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible) {
                    Button("초안과 자료 삭제", role: .destructive) {
                        if let deleting { do { try store.delete(deleting) } catch { store.error = "삭제하지 못했습니다. 기존 자료를 유지합니다." } }
                        deleting = nil
                    }
                }
                .alert("초안 보관함 확인", isPresented: Binding(get: { store.error != nil }, set: { if !$0 { store.error = nil } })) { Button("확인") { store.error = nil } } message: { Text(store.error ?? "") }
        }.tint(zoneAccent).preferredColorScheme(.light)
    }
}

struct ZoneWorkspace: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var store: ZoneStore
    @State private var draft: ZoneCase
    let startWithCapture: Bool
    @State private var openedInitialCamera = false
    @State private var saveState = ZoneDraftSaveState()
    @State private var reviewer = false
    @State private var cameraOpen = false
    @State private var pickerOpen = false
    @State private var photoItem: PhotosPickerItem?
    @State private var role = ZoneRole.incident
    @State private var slot = PrimarySlot.supplemental
    @State private var replacing: UUID?
    @State private var busy = false
    @State private var pendingData: Data?
    @State private var deleting: ZoneEvidence?
    @State private var viewing: ZoneEvidence?
    @State private var pendingExample: String?
    @State private var resetSupplement = false
    @State private var jumpTarget: String?
    @Environment(\.scenePhase) private var scenePhase

    init(initial: ZoneCase, store: ZoneStore, startWithCapture: Bool = false) {
        self.store = store; self.startWithCapture = startWithCapture; _draft = State(initialValue: initial)
    }
    private func preparePhoto() {
        role = .incident; slot = draft.nextCaptureSlot; replacing = nil
    }
    private func persist() {
        saveState.persist(draft, in: store)
    }
    private func field<T>(_ keyPath: WritableKeyPath<ZoneCase, T>) -> Binding<T> {
        Binding(get: { draft[keyPath: keyPath] }, set: { draft[keyPath: keyPath] = $0; persist() })
    }
    private func go(_ step: Int) { draft.step = step; persist() }
    private func close() { if saveState.persist(draft, in: store) { dismiss() } }
    private func addImported() {
        guard let data = pendingData else { return }
        do { draft = try store.add(data: data, source: .album, role: role, date: nil, to: draft, replacing: replacing, slot: slot); pendingData = nil; saveState.saved() }
        catch { saveState.failed("사진을 저장하지 못했습니다. 기존 사진과 입력은 유지됩니다. 같은 사진을 다시 저장하거나 취소해 주세요.") }
    }
    private func applyExample(_ kind: String) {
        draft.dedicatedSign = kind == "shared" ? .yes : .unknown
        draft.sharedSign = kind == "shared" ? .yes : .unknown
        draft.appliesToBay = kind == "shared" ? .yes : .unknown
        draft.situation = kind == "wrong-route" ? .traffic : .parking
        go(1)
    }
    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                ReportPrototypeNotice()
                ReportPageHeader(title: "주정차 신고 도우미", status: saveState.status, disabled: busy || pendingData != nil, onBack: close)
                ReportStepStrip(labels: ["사진 촬영", "촬영본 확인", "기기에 보관"], current: draft.step, disabled: busy || pendingData != nil, onSelect: go)
                ScrollViewReader { proxy in
                    ScrollView {
                        VStack(alignment: .leading, spacing: 18) {
                            Color.clear.frame(height: 0).id("top")
                            if let error = saveState.error { ZoneCard("저장·자료 확인") { Text(error).font(.subheadline).foregroundStyle(.red); if pendingData == nil { Button("다시 저장") { persist() }.buttonStyle(ReportButtonStyle()) } } }
                            if pendingData != nil {
                                ZoneCard("새 사진 저장 대기") {
                                    if let data = pendingData, let image = UIImage(data: data) { Image(uiImage: image).resizable().scaledToFit().frame(maxHeight: 180) }
                                    Button("같은 사진 저장 재시도") { addImported() }.buttonStyle(ReportButtonStyle(primary: true))
                                    Button("취소 · 원본 유지") { pendingData = nil; persist() }.buttonStyle(ReportButtonStyle())
                                }
                            }
                            Group {
                                if draft.step == 0 { primaryPhotos }
                                if draft.step == 1 { observation }
                                if draft.step == 2 { summary }
                                if !draft.evidence.isEmpty {
                                    DisclosureGroup("사진 관리 · 원본 보기·교체") { evidenceList }.padding(.vertical, 6)
                                }
                            }.disabled(busy || pendingData != nil)
                            Text("모르는 항목은 비워 두어도 저장할 수 있어요.").font(.caption).foregroundStyle(.secondary)
                        }.padding(20)
                    }.background(ReportAppearance.canvas)
                        .onChange(of: draft.step) { _, _ in proxy.scrollTo("top", anchor: .top) }
                        .onChange(of: jumpTarget) { _, value in if let value { DispatchQueue.main.async { withAnimation { proxy.scrollTo(value, anchor: .top) }; jumpTarget = nil } } }
                }
            }
            .toolbar(.hidden, for: .navigationBar)
            .toolbar {
                ToolbarItemGroup(placement: .keyboard) { Spacer(); Button("입력 완료") { UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil) } }
            }
            .safeAreaInset(edge: .bottom) {
                HStack(spacing: 12) {
                    if draft.step > 0 { Button("이전") { go(draft.step - 1) }.buttonStyle(ReportButtonStyle()).frame(minHeight: 48) }
                    Button { if draft.step < 2 { go(draft.step + 1) } else { close() } } label: { Text(draft.step < 2 ? "다음" : "기기에 저장하고 닫기").frame(maxWidth: .infinity).frame(minHeight: 42) }.buttonStyle(ReportButtonStyle(primary: true))
                }.padding(.horizontal, 16).padding(.vertical, 12).background(.white).overlay(alignment: .top) { ReportAppearance.border.frame(height: 1) }.disabled(busy || pendingData != nil)
            }
            .interactiveDismissDisabled()
            .task {
                guard startWithCapture, !openedInitialCamera else { return }
                openedInitialCamera = true
                preparePhoto()
                await Task.yield()
                cameraOpen = true
            }
            .photosPicker(isPresented: $pickerOpen, selection: $photoItem, matching: .images)
            .onChange(of: photoItem) { _, item in
                guard let item else { return }; busy = true
                Task { @MainActor in
                    defer { busy = false; photoItem = nil }
                    do {
                        guard let data = try await item.loadTransferable(type: Data.self), data.count <= 25 * 1024 * 1024, UIImage(data: data) != nil else { throw CocoaError(.fileReadCorruptFile) }
                        pendingData = data; addImported()
                    } catch { saveState.error = "사진을 읽지 못했습니다. 25MB 이하의 사진을 선택해 주세요. 기존 자료는 유지됩니다." }
                }
            }
            .fullScreenCover(isPresented: $cameraOpen) {
                CaptureScreen(replacing: replacing != nil, photosOnlyMode: true, guidance: draft.review.selectedType == .other ? "차량번호와 주변이 함께 보이게 찍어 주세요." : draft.review.selectedType.guidance, onUseLocated: { data, date, location in
                    draft = try store.add(data: data, source: .prototypeCamera, role: role, date: date, to: draft, replacing: replacing, slot: slot, location: location)
                    saveState.saved()
                }, onUse: { _, _ in }, onUseClip: { _ in throw CocoaError(.featureUnsupported) })
            }
            .sheet(item: $viewing) { item in NavigationStack { Group { if let image = store.image(item) { NativePhotoInspector(image: image) } else { Text("사진 파일을 읽을 수 없습니다.") } }.padding().navigationTitle(item.source.label).navigationBarTitleDisplayMode(.inline).toolbar { ToolbarItem(placement: .confirmationAction) { Button("닫기") { viewing = nil } } } } }
            .confirmationDialog("이 자료만 삭제할까요? 작성한 위치·내용은 유지됩니다.", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible) {
                Button("자료 삭제", role: .destructive) {
                    if let deleting { do { draft = try store.remove(deleting, from: draft); saveState.saved() } catch { saveState.failed("삭제를 저장하지 못했습니다. 기존 자료는 유지됩니다.") } }; deleting = nil
                }
            }
            .confirmationDialog("예시 응답을 적용할까요? 기존 사진·주소·내용은 유지됩니다.", isPresented: Binding(get: { pendingExample != nil }, set: { if !$0 { pendingExample = nil } }), titleVisibility: .visible) { Button("예시 적용") { if let pendingExample { applyExample(pendingExample) }; pendingExample = nil } }
            .confirmationDialog("직접 수정한 안내문을 현재 자료 기준으로 다시 만들까요?", isPresented: $resetSupplement, titleVisibility: .visible) { Button("문구 다시 만들기") { draft.supplementEdited = false; draft.supplement = ""; persist() } }
            .onChange(of: scenePhase) { _, phase in if phase != .active { persist() } }
        }.tint(zoneAccent).preferredColorScheme(.light)
    }

    private var introduction: some View {
        Group {
            ZoneCard("어떤 상황인가요?", subtitle: "메뉴를 먼저 맞히지 않아도 돼요. 상황에 맞는 경로를 알려드려요.") {
                ForEach(ZoneSituation.allCases, id: \.self) { item in
                    Button { draft.situation = item; persist() } label: {
                        HStack { Text(item.label).multilineTextAlignment(.leading); Spacer(); if draft.situation == item { Image(systemName: "checkmark") } }.padding(12).frame(minHeight: 48).background(draft.situation == item ? zoneAccent.opacity(0.09) : Color.clear, in: RoundedRectangle(cornerRadius: 10)).overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.gray.opacity(0.25)))
                    }.foregroundStyle(.primary).accessibilityAddTraits(draft.situation == item ? .isSelected : [])
                }
                VStack(alignment: .leading, spacing: 6) { Text("권장 경로").font(.caption).foregroundStyle(.secondary); Text(draft.situation.route).font(.subheadline) }.frame(maxWidth: .infinity, alignment: .leading).padding(12).background(Color(uiColor: .secondarySystemBackground), in: RoundedRectangle(cornerRadius: 10))
            }.id("route")
            ZoneCard("실제 신고용 사진은 촬영 전에 확인하세요") {
                Text(ZoneCase.sourceNote).font(.subheadline)
                Text("기본 사진과 보완사진을 구분해 기기에 보관합니다. AI 분석은 직접 서버를 설정하고 전송을 선택했을 때만 실행합니다.").font(.subheadline)
                Link("안전신문고 공식 안내 열기 ↗", destination: URL(string: "https://www.safetyreport.go.kr/")!).frame(minHeight: 44)
                Text("공식 홈페이지로 이동합니다. 사진·초안은 자동 전달되지 않습니다.").font(.caption).foregroundStyle(.secondary)
            }
            ZoneCard("입력 예시로 먼저 살펴보기") {
                Text("합성 상황의 응답만 채웁니다. 실제 사진·AI 결과·기관 확인이 아닙니다.").font(.caption).foregroundStyle(.secondary)
                ForEach([("shared", "겸용 표시"), ("unclear", "구역 불명확"), ("wrong-route", "경로 확인")], id: \.0) { kind, label in
                    Button(label) { if !draft.evidence.isEmpty || !draft.address.isEmpty || !draft.body.isEmpty { pendingExample = kind } else { applyExample(kind) } }.buttonStyle(ReportButtonStyle()).frame(minHeight: 44)
                }
            }
        }
    }
    private var observation: some View {
        VStack(alignment: .leading, spacing: 18) {
            NativeEvidenceReviewView(draft: $draft, store: store, save: persist)
            ZoneCard("발생 장소와 내용") {
                entry("주소", keyPath: \.address, hint: "주소를 입력해 주세요")
                entry("내용", keyPath: \.body, hint: "직접 본 상황을 적어 주세요.", multiline: true)
                DisclosureGroup("상세 위치 · 선택") {
                    VStack(alignment: .leading, spacing: 12) {
                        entry("시설·건물 이름", keyPath: \.facility, hint: "예: ○○아파트 101동")
                        entry("층", keyPath: \.level, hint: "예: 지하 2층")
                        entry("기둥·주차면 번호", keyPath: \.bay, hint: "예: A-17 옆")
                    }.padding(.top, 12)
                }
            }.id("location")
            Menu {
                Button("사진 찍기") { preparePhoto(); cameraOpen = true }
                Button("사진에서 선택") { preparePhoto(); pickerOpen = true }
            } label: { Label("사진 추가 · 선택", systemImage: "plus").frame(minHeight: 44) }
            DisclosureGroup("신고 경로·이전 입력·예시") {
                VStack(alignment: .leading, spacing: 16) {
                    introduction
                    if draft.evidenceReview == nil {
                        ZoneCard("이전에 입력한 구역 확인") {
                            question("전용·충전 표시가 보이나요?", keyPath: \.dedicatedSign)
                            question("일반차량 가능·겸용 안내가 있나요?", keyPath: \.sharedSign)
                            question("그 표시가 차량이 있는 칸에 적용되나요?", keyPath: \.appliesToBay, applies: true)
                        }
                    }
                }.padding(.top, 12)
            }
        }
    }
    private var summary: some View {
        Group {
            ZoneCard("저장할 내용") {
                Text(draft.review.selectedType.label + " · 근거·신고 요건은 별도 확인").font(.subheadline.weight(.medium)).foregroundStyle(zoneAccent)
                summaryLine("주소", draft.address)
                summaryLine("상세 위치", [draft.facility, draft.level, draft.bay].filter { !$0.isEmpty }.joined(separator: " · "))
                summaryLine("현장 설명", draft.body)
                summaryLine("기본 사진", draft.primaryPairSummary)
                if draft.review.selectedType == .evcharging { summaryLine("일반차 병행주차 안내", draft.review.shared.finding(signature: draft.reviewSignature)) }
                Text("이 기기에 보관합니다. 실제 신고 접수는 하지 않습니다.").font(.caption).foregroundStyle(.secondary)
            }
            DisclosureGroup("추가 확인·검토 메모 · 선택") {
            VStack(alignment: .leading, spacing: 16) {
            ZoneCard("추가 확인 \(draft.issues.count)개", subtitle: "자료 입력 완료와 신고 요건 충족은 다릅니다. 부족한 항목을 직접 보완할 수 있어요.") {
                ForEach(draft.issues) { issue in
                    VStack(alignment: .leading, spacing: 6) {
                        Text(issue.title).font(.subheadline.weight(.medium))
                        Text(issue.detail).font(.caption).foregroundStyle(.secondary)
                        Button("확인 화면으로 →") { go(1) }.font(.subheadline).frame(minHeight: 44)
                    }
                }
            }
            Toggle("검토 메모 작성", isOn: $reviewer)
            if reviewer {
                ZoneCard("보완 안내와 검토 메모", subtitle: "초안 작성용입니다. 저장해도 신고자나 기관에 발송되지 않습니다.") {
                    Text("보완 안내문").font(.subheadline.weight(.medium))
                    TextField("보완 안내문", text: Binding(get: { draft.supplementEdited ? draft.supplement : draft.suggestedSupplement }, set: { draft.supplement = $0; draft.supplementEdited = true; persist() }), axis: .vertical).lineLimit(5...18).textFieldStyle(.roundedBorder)
                    Button("현재 자료로 문구 다시 만들기") { if draft.supplementEdited { resetSupplement = true } else { draft.supplement = ""; persist() } }.font(.subheadline).frame(minHeight: 44)
                    entry("검토 메모", keyPath: \.reviewerNote, hint: "확인한 근거와 남은 확인 사항을 적어 주세요.", multiline: true)
                }
            }
            }.padding(.top, 12)
            }
        }
    }
    private var evidenceList: some View {
        ZoneCard("보관한 자료 \(draft.evidence.count)장", subtitle: "각 자료의 출처와 역할을 확인해 주세요.") {
            ForEach(Array(draft.evidence.enumerated()), id: \.element.id) { index, item in
                VStack(alignment: .leading, spacing: 12) {
                    Button { viewing = item } label: { if let image = store.image(item) { Image(uiImage: image).resizable().scaledToFit().frame(maxHeight: 240).frame(maxWidth: .infinity).clipShape(RoundedRectangle(cornerRadius: 10)) } else { Label("사진 파일을 읽을 수 없어요", systemImage: "exclamationmark.triangle") } }.accessibilityLabel("자료 \(index + 1) 크게 보기")
                    Text("자료 \(index + 1) · \(item.primarySlot?.label ?? "이전 자료 · 기본 사진 미지정") · \(item.source.label)").font(.subheadline.weight(.medium))
                    Text(item.takenAt.map { $0.formatted(date: .abbreviated, time: .standard) + " · 기기 시각" } ?? "촬영시각 미확인").font(.caption).foregroundStyle(.secondary)
                    Text("공식 촬영본 확인 안 됨").font(.caption).foregroundStyle(.secondary)
                    Picker("기본·보완 사진 역할", selection: Binding(get: { item.primarySlot ?? .supplemental }, set: { assigned in
                        for i in draft.evidence.indices {
                            if draft.evidence[i].id == item.id { draft.evidence[i].primarySlot = assigned }
                            else if assigned != .supplemental && draft.evidence[i].primarySlot == assigned { draft.evidence[i].primarySlot = .supplemental }
                        }
                        draft.invalidateEvidenceReview(); persist()
                    })) { ForEach(PrimarySlot.allCases, id: \.self) { Text($0.label).tag($0) } }.pickerStyle(.menu)
                    if item.primarySlot == .supplemental || item.primarySlot == nil {
                        Text("보완사진이 기본 사진과 같은 차량·장소인지 각각 확인해 주세요. 번호판이 같아도 같은 위치·계속 정차를 확정하지 않아요.").font(.caption)
                        ForEach(["sameVehicle", "samePlace"], id: \.self) { key in
                            Picker(key == "sameVehicle" ? "같은 차량" : "같은 장소·주차면", selection: Binding(get: { key == "sameVehicle" ? (item.targetLink?.sameVehicle ?? .unknown) : (item.targetLink?.samePlace ?? .unknown) }, set: { answer in
                                if let i = draft.evidence.firstIndex(where: { $0.id == item.id }) {
                                    var link = draft.evidence[i].targetLink ?? EvidenceTargetLink()
                                    if link.primaryIDs != draft.primaryPair.map(\.id) { link.sameVehicle = .unknown; link.samePlace = .unknown }
                                    link.primaryIDs = draft.primaryPair.map(\.id)
                                    if key == "sameVehicle" { link.sameVehicle = answer } else { link.samePlace = answer }
                                    draft.evidence[i].targetLink = link; draft.invalidateEvidenceReview(); persist()
                                }
                            })) { ForEach(ZoneAnswer.allCases, id: \.self) { Text($0.appliesLabel).tag($0) } }.pickerStyle(.menu)
                        }
                        Text(draft.evidenceEligible(item) ? "기본 사진의 차량·장소에 연결한 보완자료" : "연결 미확인 · 자동 추천 근거에는 합치지 않음").font(.caption).foregroundStyle(.secondary)
                    }
                    if let location = item.location { Text("촬영 위치 · \(location.quality) · 보고 오차 \(Int(location.accuracy))m").font(.caption) }
                    ForEach(ZoneRole.allCases, id: \.self) { itemRole in
                        Button {
                            if let i = draft.evidence.firstIndex(where: { $0.id == item.id }) {
                                if draft.evidence[i].roles.contains(itemRole) { draft.evidence[i].roles.removeAll { $0 == itemRole } }
                                else { draft.evidence[i].roles.append(itemRole) }
                                persist()
                            }
                        } label: { Label(itemRole.label, systemImage: item.roles.contains(itemRole) ? "checkmark.square.fill" : "square").frame(maxWidth: .infinity, alignment: .leading).frame(minHeight: 44) }.accessibilityAddTraits(item.roles.contains(itemRole) ? .isSelected : [])
                    }
                    HStack {
                        Button("재촬영") { role = item.roles.first ?? .incident; replacing = item.id; cameraOpen = true }
                        Button("사진 교체") { role = item.roles.first ?? .incident; replacing = item.id; pickerOpen = true }
                        Spacer()
                        Button("삭제", role: .destructive) { deleting = item }
                    }.font(.subheadline).frame(minHeight: 44)
                    Divider()
                }
            }
        }
    }
    private var primaryPhotos: some View {
        ZoneCard("사진 촬영", subtitle: "차량번호와 주변이 함께 보이게 찍어 주세요.") {
            HStack(alignment: .top, spacing: 12) {
                ForEach([PrimarySlot.first, .second], id: \.self) { target in
                    let existing = draft.evidence.first { $0.primarySlot == target }
                    VStack(spacing: 8) {
                        Button {
                            if let existing { viewing = existing }
                            else { role = .incident; slot = target; replacing = nil; cameraOpen = true }
                        } label: {
                            Group {
                                if let existing, let image = store.image(existing) {
                                    Image(uiImage: image).resizable().scaledToFit()
                                } else { Image(systemName: "camera").font(.title).foregroundStyle(.secondary) }
                            }.frame(maxWidth: .infinity).frame(height: 120).background(ReportAppearance.canvas, in: RoundedRectangle(cornerRadius: 10))
                        }.accessibilityLabel(target.label + (existing == nil ? " 촬영" : " 원본 보기"))
                        Text(target.label).font(.caption)
                    }.frame(maxWidth: .infinity)
                }
            }
            if !draft.primaryPair.isEmpty { Text(draft.primaryPairSummary).font(.caption).foregroundStyle(.secondary) }
            Button {
                preparePhoto(); cameraOpen = true
            } label: {
                Label(draft.nextCaptureSlot == .first ? "첫 번째 사진 찍기" : draft.nextCaptureSlot == .second ? "두 번째 사진 찍기" : "사진 추가로 찍기", systemImage: "camera")
                    .frame(maxWidth: .infinity)
            }.buttonStyle(ReportButtonStyle(primary: true))
            Button("사진에서 선택") { preparePhoto(); pickerOpen = true }.frame(minHeight: 44)
        }
    }
    private func question(_ label: String, keyPath: WritableKeyPath<ZoneCase, ZoneAnswer>, applies: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(label).font(.subheadline.weight(.medium))
            HStack(spacing: 6) { ForEach(ZoneAnswer.allCases, id: \.self) { answer in
                Button { draft[keyPath: keyPath] = answer; persist() } label: { Text(applies ? answer.appliesLabel : answer.label).font(.caption.weight(.medium)).frame(maxWidth: .infinity).frame(minHeight: 48).background(draft[keyPath: keyPath] == answer ? zoneAccent.opacity(0.1) : Color.clear, in: RoundedRectangle(cornerRadius: 10)).overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.gray.opacity(0.25))) }.accessibilityLabel("\(label) \(applies ? answer.appliesLabel : answer.label)").accessibilityAddTraits(draft[keyPath: keyPath] == answer ? .isSelected : [])
            } }
        }
    }
    private func entry(_ label: String, keyPath: WritableKeyPath<ZoneCase, String>, hint: String, multiline: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(label).font(.subheadline.weight(.medium))
            TextField(hint, text: field(keyPath), axis: multiline ? .vertical : .horizontal).lineLimit(multiline ? 3...8 : 1...1).textFieldStyle(.roundedBorder).accessibilityLabel(label).frame(minHeight: 44)
        }
    }
    private func summaryLine(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 5) { Text(label).font(.caption).foregroundStyle(.secondary); Text(value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "미입력 · 확인 필요" : value).font(.subheadline).textSelection(.enabled) }
    }
}

private struct ZoneCard<Content: View>: View {
    let title: String
    let subtitle: String?
    @ViewBuilder let content: () -> Content
    init(_ title: String, subtitle: String? = nil, @ViewBuilder content: @escaping () -> Content) { self.title = title; self.subtitle = subtitle; self.content = content }
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(title).font(.system(size: 17, weight: .bold))
            if let subtitle { Text(subtitle).font(.system(size: 13)).foregroundStyle(ReportAppearance.muted) }
            content()
        }.frame(maxWidth: .infinity, alignment: .leading).padding(16).background(.white, in: RoundedRectangle(cornerRadius: 14)).overlay(RoundedRectangle(cornerRadius: 14).stroke(ReportAppearance.border))
    }
}
