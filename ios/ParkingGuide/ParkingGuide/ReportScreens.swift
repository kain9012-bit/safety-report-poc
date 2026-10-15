import SwiftUI
import UIKit
import Combine

// 웹 main 과 같은 흐름(2026-10-15): 처음 화면 → 두 장 촬영 → 신고서 5단계(유형·발생지역·차량번호·내용·점검·제출).
// 판독 근거·GPS 품질·촬영 방향은 뒤에서 기록만 하고, 화면에는 민원인이 할 일이 있을 때만 한 줄씩 꺼낸다.

/// 사진 판독 — 사용자가 설정한 HTTPS 서버로만 보내고, 사진 전송 동의는 한 번 받아 기억한다.
@MainActor final class ReportReading: ObservableObject {
    enum State: Equatable { case off, needsConsent, idle, loading, ok, failed(String) }
    static let endpointKey = "evidenceVisionEndpoint"
    static let consentKey = "evidenceVisionConsent"
    @Published private(set) var state: State = .idle
    private var task: Task<Void, Never>?

    var endpoint: String { (UserDefaults.standard.string(forKey: Self.endpointKey) ?? "").trimmingCharacters(in: .whitespacesAndNewlines) }
    var consent: String { UserDefaults.standard.string(forKey: Self.consentKey) ?? "" }
    static func needsReading(_ draft: ZoneCase) -> Bool { draft.primaryPair.count == 2 && draft.review.aiResult?.revision != draft.review.revision }

    func run(_ draft: ZoneCase, store: ZoneStore, force: Bool = false, apply: @escaping (NativeAIResult, ZoneCase) -> Void) {
        task?.cancel()
        guard !endpoint.isEmpty, consent != "no" else { state = .off; return }
        guard consent == "yes" else { state = .needsConsent; return }
        guard force || Self.needsReading(draft) else { state = draft.review.aiResult == nil ? .idle : .ok; return }
        guard draft.primaryPair.count == 2 else { state = .idle; return }
        state = .loading
        let captured = draft, address = endpoint
        task = Task { @MainActor in
            do {
                let result = try await NativeVisionClient.analyze(draft: captured, store: store, endpoint: address, regionHints: captured.nativeRegionHints)
                try Task.checkCancellation()
                apply(result, captured); state = .ok
            } catch {
                if !Task.isCancelled { state = .failed(error.localizedDescription) }
            }
        }
    }
    func cancel() { task?.cancel() }
}

/// 신고 한 건 — 기본 두 장이 모이기 전에는 촬영, 모이면 신고서.
struct ReportFlowScreen: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var store: ZoneStore
    @State private var draft: ZoneCase
    @State private var capturing: Bool
    @State private var retake: PrimarySlot?
    let onSubmitted: () -> Void

    init(initial: ZoneCase, store: ZoneStore, onSubmitted: @escaping () -> Void) {
        self.store = store; self.onSubmitted = onSubmitted
        _draft = State(initialValue: initial)
        _capturing = State(initialValue: initial.primaryPair.count < 2)
    }

    var body: some View {
        Group {
            if capturing {
                ReportCaptureScreen(draft: $draft, store: store, mode: .pair(retake: retake), onDone: {
                    retake = nil; draft.step = 0; try? store.save(draft); capturing = false
                }, onExit: close)
            } else {
                ReportStepsScreen(draft: $draft, store: store, onRetakeSecond: { retake = .second; capturing = true }, onHome: close, onSubmitted: { onSubmitted(); dismiss() })
            }
        }.tint(ReportAppearance.blue).preferredColorScheme(.light)
    }
    private func close() {
        // 사진 없이 닫은 새 신고는 남기지 않는다(홈에서도 정리한다)
        if draft.evidence.isEmpty && draft.submittedAt == nil { try? store.delete(draft) } else { try? store.save(draft) }
        dismiss()
    }
}

// MARK: - 촬영

struct ReportCaptureScreen: View {
    enum Mode: Equatable { case pair(retake: PrimarySlot?), supplement(text: String) }
    private enum Phase { case first, wait, second }
    @Binding var draft: ZoneCase
    let store: ZoneStore
    let mode: Mode
    let onDone: () -> Void
    let onExit: () -> Void
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var camera = CameraModel()
    @StateObject private var location = CaptureLocation()
    @State private var now = Date()
    @State private var retake: PrimarySlot?
    @State private var saving = false
    @State private var error: String?
    @State private var rang = false
    private let tick = Timer.publish(every: 0.25, on: .main, in: .common).autoconnect()

    init(draft: Binding<ZoneCase>, store: ZoneStore, mode: Mode, onDone: @escaping () -> Void, onExit: @escaping () -> Void) {
        _draft = draft; self.store = store; self.mode = mode; self.onDone = onDone; self.onExit = onExit
        if case .pair(let slot) = mode { _retake = State(initialValue: slot) }
    }

    private var first: ZoneEvidence? { retake == .first ? nil : draft.evidence.first { $0.primarySlot == .first } }
    private var second: ZoneEvidence? { retake != nil ? nil : draft.evidence.first { $0.primarySlot == .second } }
    private var isSupplement: Bool { if case .supplement = mode { return true }; return false }
    private var remain: Int {
        guard let taken = first?.takenAt else { return 0 }
        return max(0, Int(ceil(Double(ReportRules.intervalSeconds) - now.timeIntervalSince(taken))))
    }
    private var phase: Phase { isSupplement || first == nil ? .first : remain > 0 ? .wait : .second }
    private var firstImage: UIImage? { first.flatMap { store.image($0) } }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Button(action: onExit) { Label(isSupplement ? "취소" : "처음 화면", systemImage: "arrow.left").font(.system(size: 15)) }
                    .buttonStyle(.plain).foregroundStyle(.white).frame(minHeight: 44).disabled(saving)
                Spacer()
                Text(isSupplement ? "사진 한 장 더" : phase == .first ? "첫 번째 사진" : "두 번째 사진").font(.system(size: 15, weight: .bold)).foregroundStyle(.white)
            }.padding(.horizontal, 16).background(.black)
            ZStack(alignment: .top) {
                if camera.denied {
                    ContentUnavailableView {
                        Label("카메라를 열 수 없습니다", systemImage: "camera.fill")
                    } description: { Text("카메라·위치 권한을 확인해 주세요") } actions: {
                        Button("설정 열기") { if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) } }
                    }.foregroundStyle(.white)
                } else {
                    CameraPreview(session: camera.engine.session).background(.black)
                    // 첫 번째 사진 잔상 — 같은 구도를 잡게(웹 main 과 같이 35%)
                    if !isSupplement, first != nil, second == nil, let image = firstImage {
                        Image(uiImage: image).resizable().scaledToFit().opacity(0.35).allowsHitTesting(false)
                            .frame(maxWidth: .infinity, maxHeight: .infinity).accessibilityHidden(true)
                    }
                }
                VStack(spacing: 6) {
                    Text(guidance).font(.system(size: 15, weight: .semibold)).multilineTextAlignment(.center)
                    Text(location.status).font(.system(size: 12)).opacity(0.85)
                }.padding(10).frame(maxWidth: .infinity).background(.black.opacity(0.6)).foregroundStyle(.white)
                if phase == .wait {
                    VStack(spacing: 6) {
                        Text("\(remain)").font(.system(size: 64, weight: .bold, design: .rounded)).monospacedDigit()
                        Text("초 뒤에 두 번째 사진").font(.system(size: 17, weight: .bold))
                        Text("자리를 떠도 됩니다. 같은 자리·같은 방향에서 찍어 주세요.").font(.system(size: 13))
                    }.foregroundStyle(.white).shadow(radius: 4).frame(maxWidth: .infinity, maxHeight: .infinity)
                }
                if !camera.ready && !camera.denied { ProgressView().tint(.white).frame(maxWidth: .infinity, maxHeight: .infinity) }
            }.frame(maxHeight: .infinity).background(.black)
            VStack(spacing: 12) {
                if !isSupplement {
                    HStack(spacing: 10) {
                        ForEach([PrimarySlot.first, .second], id: \.self) { slot in
                            let item = slot == .first ? first : second
                            ZStack {
                                if let item, let image = store.image(item) { Image(uiImage: image).resizable().scaledToFill() }
                                else { Text(slot == .first ? "1" : "2").font(.system(size: 15, weight: .bold)).foregroundStyle(.white.opacity(0.6)) }
                            }.frame(width: 56, height: 56).clipShape(RoundedRectangle(cornerRadius: 8))
                                .overlay(RoundedRectangle(cornerRadius: 8).stroke(item == nil ? .white.opacity(0.4) : .green, style: StrokeStyle(lineWidth: 2, dash: item == nil ? [4] : [])))
                                .accessibilityLabel("\(slot == .first ? 1 : 2)번째 사진 \(item == nil ? "아직 없음" : "찍음")")
                        }
                        Spacer()
                        if phase != .first { Button("첫 사진 다시 찍기") { retake = .first }.font(.system(size: 14)).foregroundStyle(.white).disabled(saving) }
                    }
                }
                Button { camera.capture() } label: {
                    Label(saving ? "저장 중…" : phase == .wait ? "\(remain)초 뒤에 찍을 수 있어요" : "사진 찍기", systemImage: "camera.fill")
                        .font(.system(size: 17, weight: .bold)).frame(maxWidth: .infinity).frame(minHeight: 52)
                }.buttonStyle(ReportButtonStyle(primary: true)).disabled(phase == .wait || !camera.ready || saving || camera.capturing)
            }.padding(16).background(.black)
        }
        .background(.black)
        .onReceive(tick) { value in
            now = value
            if phase == .second && !rang && !isSupplement && first != nil { rang = true; UINotificationFeedbackGenerator().notificationOccurred(.success) }
        }
        .task { location.start(); await camera.start() }
        .onDisappear { camera.close(); location.stop() }
        .onChange(of: scenePhase) { _, value in if value == .active { Task { await camera.start() } } else { camera.stop() } }
        .onChange(of: camera.draft) { _, data in if let data { save(data) } }
        .alert("촬영 안내", isPresented: Binding(get: { error != nil || camera.error != nil }, set: { if !$0 { error = nil; camera.error = nil } })) {
            Button("확인") { error = nil; camera.error = nil }
        } message: { Text(error ?? camera.error ?? "") }
    }

    private var guidance: String {
        if case .supplement(let text) = mode { return text }
        return phase == .first ? "차·번호판·위반 장소가 한 화면에 나오게 찍어 주세요" : "첫 번째 사진과 같은 자리·방향에서, 번호판이 보이게 찍어 주세요"
    }

    private func save(_ data: Data) {
        let takenAt = camera.capturedAt
        let slot: PrimarySlot = isSupplement ? .supplemental : (first == nil ? .first : .second)
        let replacing = slot == .first ? draft.evidence.first { $0.primarySlot == .first }?.id
            : slot == .second ? draft.evidence.first { $0.primarySlot == .second }?.id : nil
        saving = true
        defer { saving = false }
        do {
            draft = try store.add(data: data, source: .prototypeCamera, role: .incident, date: takenAt, to: draft, replacing: replacing, slot: slot, location: location.snapshot(at: takenAt))
            camera.retake()
            switch slot {
            case .first: retake = retake == .first ? .second : nil; rang = false; location.start()
            case .second, .supplemental: retake = nil; onDone()
            }
        } catch {
            self.error = "사진을 저장하지 못했습니다. 기존 사진과 입력은 그대로입니다. 다시 찍어 주세요."
            camera.retake()
        }
    }
}

// MARK: - 신고서 5단계

struct ReportStepsScreen: View {
    @Binding var draft: ZoneCase
    let store: ZoneStore
    let onRetakeSecond: () -> Void
    let onHome: () -> Void
    let onSubmitted: () -> Void
    @StateObject private var reading = ReportReading()
    @State private var saveState = ZoneDraftSaveState()
    @State private var typeSheet = false
    @State private var settingsOpen = false
    @State private var supplementCapture: ReportEvidence.Supplement?
    @State private var resetBody = false
    @State private var submitBlocked: String?
    @Environment(\.scenePhase) private var scenePhase

    private var step: Int { min(max(draft.step, 0), ReportRules.steps.count - 1) }
    private func persist() { saveState.persist(draft, in: store) }
    private func go(_ next: Int) { draft.step = next; persist() }
    private func read(force: Bool = false) {
        reading.run(draft, store: store, force: force) { result, captured in
            guard draft.review.revision == captured.review.revision, draft.evidence.map(\.id) == captured.evidence.map(\.id) else { return }
            var review = draft.review; review.aiResult = result; draft.evidenceReview = review
            draft.applyPhotoType(); persist()
        }
    }
    /// 이미 받아 둔 판독으로도 유형을 맞춘다(다시 열었을 때·판독이 꺼져 있을 때)
    private func syncPhotoType() {
        let before = (draft.reportType, draft.typeSource)
        draft.applyPhotoType()
        if before.0 != draft.reportType || before.1 != draft.typeSource { persist() }
    }

    var body: some View {
        VStack(spacing: 0) {
            ReportPrototypeNotice()
            HStack(spacing: 8) {
                Button(action: onHome) { Image(systemName: "arrow.left").frame(width: 44, height: 44) }.buttonStyle(.plain).accessibilityLabel("처음 화면")
                Text("불법 주정차 신고").font(.system(size: 17, weight: .bold))
                Spacer()
                Text("\(step + 1) / \(ReportRules.steps.count)").font(.system(size: 14, weight: .semibold))
            }.padding(.horizontal, 8).foregroundStyle(.white).background(ReportAppearance.blue)
            Text(saveState.error ?? saveState.status).font(.system(size: 12)).foregroundStyle(saveState.error == nil ? ReportAppearance.muted : .red)
                .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 16).padding(.vertical, 4)
            ReportProgress(current: step, onSelect: go)
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        Color.clear.frame(height: 0).id("top")
                        switch step {
                        case 0: typeStep
                        case 1: placeStep
                        case 2: plateStep
                        case 3: bodyStep
                        default: checkStep
                        }
                    }.padding(.horizontal, 16).padding(.top, 12).padding(.bottom, 24)
                }.onChange(of: step) { _, _ in proxy.scrollTo("top", anchor: .top) }
            }
        }
        .background(.white)
        .safeAreaInset(edge: .bottom) {
            HStack(spacing: 10) {
                if step == 0 { Button("다시 찍기") { persist(); onRetakeSecond() }.buttonStyle(ReportButtonStyle()) }
                else { Button("이전") { go(step - 1) }.buttonStyle(ReportButtonStyle()) }
                if step < ReportRules.steps.count - 1 {
                    Button { go(step + 1) } label: { Text("다음").frame(maxWidth: .infinity) }.buttonStyle(ReportButtonStyle(primary: true))
                } else {
                    let fails = draft.reportChecks.filter { $0.status == .fail }.count
                    Button { submit() } label: { Text(fails > 0 ? "빨간불 \(fails)개" : "제출").frame(maxWidth: .infinity) }
                        .buttonStyle(ReportButtonStyle(primary: fails == 0)).disabled(fails > 0)
                }
            }.padding(.horizontal, 16).padding(.vertical, 10).background(.white).overlay(alignment: .top) { ReportAppearance.border.frame(height: 1) }
        }
        .toolbar { ToolbarItemGroup(placement: .keyboard) { Spacer(); Button("입력 완료") { UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil) } } }
        .task { syncPhotoType(); read() }
        .onChange(of: scenePhase) { _, value in if value != .active { persist() } }
        .onDisappear { reading.cancel() }
        .sheet(isPresented: $typeSheet) { typeChooser }
        .sheet(isPresented: $settingsOpen, onDismiss: { read() }) { VisionSettingsSheet() }
        .fullScreenCover(item: $supplementCapture) { need in
            ReportCaptureScreen(draft: $draft, store: store, mode: .supplement(text: need.text), onDone: {
                draft.supplementAsked = Array(Set((draft.supplementAsked ?? []) + [need.id])); persist()
                supplementCapture = nil; read()
            }, onExit: { supplementCapture = nil })
        }
        .alert("사진 판독", isPresented: Binding(get: { reading.state == .needsConsent }, set: { _ in })) {
            Button("보내기") { UserDefaults.standard.set("yes", forKey: ReportReading.consentKey); read() }
            Button("보내지 않기", role: .cancel) { UserDefaults.standard.set("no", forKey: ReportReading.consentKey); read() }
        } message: { Text("사진 축소본을 설정한 서버로 보내 유형을 확인할까요? 위치·주소·작성 내용은 보내지 않습니다. 이 선택은 판독 서버 설정에서 바꿀 수 있습니다.") }
        .alert("제출 전 점검", isPresented: Binding(get: { submitBlocked != nil }, set: { if !$0 { submitBlocked = nil } })) { Button("확인") { submitBlocked = nil } } message: { Text(submitBlocked ?? "") }
        .confirmationDialog("직접 고친 내용을 자동 작성으로 되돌릴까요?", isPresented: $resetBody, titleVisibility: .visible) {
            Button("자동 작성으로 되돌리기") { draft.bodyEdited = false; draft.body = ""; persist() }
        }
    }

    // 0. 유형
    private var typeStep: some View {
        ReportStep(title: "위반 유형 확인", sub: "사진에 보이는 것으로 정했습니다") {
            HStack(spacing: 8) {
                ForEach(Array(draft.primaryPair.prefix(2).enumerated()), id: \.element.id) { _, photo in
                    ZStack(alignment: .bottom) {
                        if let image = store.image(photo) { Image(uiImage: image).resizable().scaledToFill() } else { Color(white: 0.92) }
                        Text(photo.takenAt.map(ReportRules.clock) ?? "시각 없음").font(.system(size: 11)).monospacedDigit()
                            .frame(maxWidth: .infinity).padding(.vertical, 2).background(.black.opacity(0.6)).foregroundStyle(.white)
                    }.frame(maxWidth: .infinity).aspectRatio(4 / 3, contentMode: .fit).clipShape(RoundedRectangle(cornerRadius: 8))
                }
            }
            if let gap = draft.intervalSeconds { Text("\(Int(gap))초 간격").font(.system(size: 13)).foregroundStyle(ReportAppearance.muted).padding(.top, 6) }
            readingLine.padding(.top, 4)
            HStack {
                Text("불법 주정차 유형").font(.system(size: 15, weight: .bold)).foregroundStyle(ReportAppearance.ink)
                Spacer()
                Button { typeSheet = true } label: { Label("유형선택", systemImage: "hand.point.up.left") }.buttonStyle(ReportButtonStyle())
            }.padding(.top, 20)
            typeValue
            followUps
        }
    }
    @ViewBuilder private var readingLine: some View {
        switch reading.state {
        case .loading: Label("사진 판독 중…", systemImage: "hourglass").font(.system(size: 13)).foregroundStyle(ReportAppearance.muted)
        case .ok: Text(draft.review.aiResult?.responseFormat == "legacy" ? "사진 판독 완료 · 기본 분석만 받았습니다" : "사진 판독 완료").font(.system(size: 13)).foregroundStyle(ReportAppearance.muted)
        case .failed: HStack { Text("사진 판독에 실패했습니다").font(.system(size: 13)).foregroundStyle(.red); Button("다시 판독") { read(force: true) }.font(.system(size: 13, weight: .bold)) }
        case .off, .needsConsent: HStack { Text("사진 판독이 꺼져 있습니다").font(.system(size: 13)).foregroundStyle(ReportAppearance.muted); Button("판독 서버 설정") { settingsOpen = true }.font(.system(size: 13, weight: .bold)) }
        case .idle: EmptyView()
        }
    }
    @ViewBuilder private var typeValue: some View {
        let confident = ReportEvidence.confidentTypes(draft)
        if let type = draft.reportType {
            VStack(alignment: .leading, spacing: 6) {
                Text(type.reportLabel).font(.system(size: 22, weight: .medium)).foregroundStyle(ReportAppearance.blue)
                Text(draft.typeSource == "photo" ? "사진 증거" : "직접 선택").font(.system(size: 12, weight: .bold)).padding(.horizontal, 6).padding(.vertical, 2)
                    .background(Color(red: 1, green: 0.96, blue: 0.85), in: RoundedRectangle(cornerRadius: 4)).foregroundStyle(Color(red: 0.55, green: 0.35, blue: 0.0))
                if draft.typeSource != "photo" { Text("직접 고른 유형입니다. 사진에 그 근거가 보이는지 확인해 주세요.").font(.system(size: 13)).foregroundStyle(ReportAppearance.muted) }
            }.padding(.top, 10)
        } else {
            Text(reading.state == .loading ? "사진 판독 중… 유형은 사진에 보이는 것으로만 정합니다" : "사진에서 위반 유형의 증거를 찾지 못했습니다. 유형선택에서 골라 주세요")
                .font(.system(size: 14)).foregroundStyle(ReportAppearance.muted).padding(.top, 10)
        }
        if confident.count >= 2 {
            VStack(alignment: .leading, spacing: 8) {
                Text("사진에 유형이 \(confident.count)개 보입니다 — 하나를 골라 주세요").font(.system(size: 14, weight: .bold))
                ForEach(confident) { type in
                    Button { draft.chooseType(type); persist() } label: { Text(type.reportLabel).frame(maxWidth: .infinity, alignment: .leading) }
                        .buttonStyle(ReportButtonStyle(primary: draft.reportType == type))
                }
            }.padding(.top, 12)
        }
    }
    @ViewBuilder private var followUps: some View {
        if let need = ReportEvidence.supplementRequest(draft) {
            VStack(alignment: .leading, spacing: 8) {
                Text(need.text).font(.system(size: 14))
                Button { supplementCapture = need } label: { Label("한 장 더 찍기", systemImage: "camera") }.buttonStyle(ReportButtonStyle())
            }.padding(12).frame(maxWidth: .infinity, alignment: .leading)
                .background(Color(red: 1, green: 0.98, blue: 0.92), in: RoundedRectangle(cornerRadius: 6))
                .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color(red: 0.99, green: 0.9, blue: 0.6)))
                .foregroundStyle(Color(red: 0.47, green: 0.27, blue: 0.0)).padding(.top, 14)
        }
        if ReportEvidence.generalNotice(draft) != nil {
            let answer = ReportEvidence.sharedAnswer(draft)
            VStack(alignment: .leading, spacing: 8) {
                Text("이 칸에 일반 자동차도 주차할 수 있다는 안내가 있나요?").font(.system(size: 14, weight: .bold))
                HStack(spacing: 8) {
                    ForEach(ReportEvidence.SharedScope.allCases, id: \.self) { scope in
                        Button { draft.answerShared(scope); persist() } label: { Text(scope.label).font(.system(size: 14, weight: .bold)).frame(minWidth: 60) }
                            .buttonStyle(ReportButtonStyle(primary: answer == scope)).accessibilityAddTraits(answer == scope ? .isSelected : [])
                    }
                }
            }.padding(12).frame(maxWidth: .infinity, alignment: .leading)
                .overlay(RoundedRectangle(cornerRadius: 6).stroke(ReportAppearance.border)).padding(.top, 14)
        }
    }
    private var typeChooser: some View {
        NavigationStack {
            List(EvidenceType.allCases) { type in
                Button { draft.chooseType(type); persist(); typeSheet = false } label: {
                    HStack { Text(type.reportLabel).foregroundStyle(ReportAppearance.ink); Spacer(); if draft.reportType == type { Image(systemName: "checkmark").foregroundStyle(ReportAppearance.blue) } }
                }.frame(minHeight: 44)
            }.navigationTitle("유형선택").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("닫기") { typeSheet = false } } }
        }.presentationDetents([.medium, .large])
    }

    // 1. 발생지역
    private var placeStep: some View {
        ReportStep(title: "발생지역 확인", sub: "사진을 찍은 자리의 주소입니다") {
            TextField("주소를 입력해 주세요", text: Binding(get: { draft.address }, set: { draft.address = $0; persist() }), axis: .vertical)
                .lineLimit(1...3).textFieldStyle(.roundedBorder).font(.system(size: 17)).accessibilityLabel("발생지역 주소")
            if let at = draft.locatedPhoto {
                Text(String(format: "사진 위치 %.5f, %.5f", at.latitude, at.longitude) + (at.accuracy.isFinite && at.accuracy >= 0 ? " · ±\(Int(at.accuracy))m" : " · 정확도 기록 없음"))
                    .font(.system(size: 13)).foregroundStyle(ReportAppearance.muted).padding(.top, 8)
            } else {
                Text("사진에 위치가 없습니다. 주소를 직접 넣어 주세요.").font(.system(size: 13)).foregroundStyle(ReportAppearance.muted).padding(.top, 8)
            }
        }
    }

    // 2. 차량번호
    private var plateStep: some View {
        ReportStep(title: "차량번호 확인", sub: "두 사진의 번호판을 보고 입력해 주세요") {
            TextField("예: 12가3456", text: Binding(get: { draft.plate ?? "" }, set: { draft.plate = $0; persist() }))
                .textFieldStyle(.roundedBorder).font(.system(size: 20, weight: .medium)).autocorrectionDisabled().accessibilityLabel("차량번호")
            let plate = (draft.plate ?? "").filter { !$0.isWhitespace }
            if !plate.isEmpty && !ReportRules.isValidPlate(plate) { Text("번호판 형식과 다릅니다. 다시 확인해 주세요.").font(.system(size: 13)).foregroundStyle(.red).padding(.top, 6) }
            HStack(spacing: 8) {
                ForEach(draft.primaryPair.prefix(2)) { photo in
                    if let image = store.image(photo) { Image(uiImage: image).resizable().scaledToFit().frame(maxWidth: .infinity).clipShape(RoundedRectangle(cornerRadius: 8)) }
                }
            }.padding(.top, 12)
        }
    }

    // 3. 내용
    private var bodyStep: some View {
        ReportStep(title: "내용 확인", sub: "담당자가 빨리 읽게 항목으로 썼습니다 (\(ReportRules.bodyMin)~\(ReportRules.bodyMax)자)") {
            HStack {
                Text(draft.bodyEdited == true ? "직접 수정" : "자동 작성").font(.system(size: 12, weight: .bold)).foregroundStyle(ReportAppearance.blue)
                Spacer()
                if draft.bodyEdited == true { Button("자동 작성으로 되돌리기") { resetBody = true }.font(.system(size: 13)) }
            }
            TextEditor(text: Binding(get: { draft.reportBody }, set: { value in draft.body = String(value.prefix(ReportRules.bodyMax)); draft.bodyEdited = true; persist() }))
                .font(.system(size: 15)).frame(minHeight: 200).padding(6).overlay(RoundedRectangle(cornerRadius: 8).stroke(ReportAppearance.border)).accessibilityLabel("신고 내용")
            Text("\(draft.reportBody.count) / \(ReportRules.bodyMax)").font(.system(size: 12)).foregroundStyle(ReportAppearance.muted).frame(maxWidth: .infinity, alignment: .trailing)
        }
    }

    // 4. 점검·제출
    private var checkStep: some View {
        let checks = draft.reportChecks
        return ReportStep(title: "제출 전 점검", sub: "빨간불은 고쳐야 제출할 수 있습니다") {
            VStack(spacing: 0) {
                summaryRow("유형", draft.reportType?.reportLabel ?? "비어 있음", step: 0)
                summaryRow("발생지역", draft.address.isEmpty ? "비어 있음" : draft.address, step: 1)
                summaryRow("차량번호", (draft.plate ?? "").isEmpty ? "비어 있음" : draft.plate!, step: 2)
                summaryRow("내용", "\(draft.reportBody.count)자", step: 3, last: true)
            }.overlay(RoundedRectangle(cornerRadius: 10).stroke(ReportAppearance.border))
            HStack(spacing: 12) {
                ForEach([(ReportCheck.Status.pass, Color.green), (.warn, Color.orange), (.fail, Color.red)], id: \.0) { status, color in
                    Label("\(checks.filter { $0.status == status }.count)", systemImage: "circle.fill").font(.system(size: 13)).foregroundStyle(color)
                }
            }.padding(.vertical, 12)
            ForEach(checks.sorted { order($0.status) < order($1.status) }) { check in
                HStack(alignment: .top, spacing: 10) {
                    Circle().fill(check.status == .pass ? Color.green : check.status == .warn ? Color.orange : Color.red).frame(width: 10, height: 10).padding(.top, 5)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(check.label).font(.system(size: 15, weight: .bold))
                        Text(check.detail).font(.system(size: 13)).foregroundStyle(ReportAppearance.muted)
                    }
                }.padding(.vertical, 8).frame(maxWidth: .infinity, alignment: .leading)
                Divider()
            }
            Text("개선 제안용 화면이라 실제로 접수되지 않습니다. 제출하면 이 기기의 '제출한 신고'에 보관합니다.").font(.system(size: 12)).foregroundStyle(ReportAppearance.muted).padding(.top, 10)
        }
    }
    private func order(_ s: ReportCheck.Status) -> Int { s == .fail ? 0 : s == .warn ? 1 : 2 }
    private func summaryRow(_ label: String, _ value: String, step target: Int, last: Bool = false) -> some View {
        VStack(spacing: 0) {
            HStack {
                Text(label).font(.system(size: 13)).foregroundStyle(ReportAppearance.muted).frame(width: 64, alignment: .leading)
                Text(value).font(.system(size: 15)).lineLimit(1)
                Spacer()
                Button("고치기") { go(target) }.font(.system(size: 14, weight: .bold)).underline()
            }.padding(.horizontal, 12).frame(minHeight: 44)
            if !last { Divider() }
        }
    }
    private func submit() {
        // 화면을 열어 둔 사이 달라졌을 수 있으니 누르는 순간 다시 점검한다
        if draft.reportBlocked { submitBlocked = "현재 상태로 다시 점검했습니다. 빨간불 항목을 확인해 주세요."; return }
        var done = draft; done.submittedAt = Date()
        if done.bodyEdited != true { done.body = done.composedBody }
        do { try store.save(done); draft = done; onSubmitted() }
        catch { saveState.failed("저장하지 못했습니다. 입력은 이 화면에 그대로 있습니다. 다시 시도해 주세요.") }
    }
}

extension ReportEvidence.Supplement: Identifiable {}

/// 웹 ReportProgress — 다섯 칸 막대와 이름
struct ReportProgress: View {
    let current: Int
    let onSelect: (Int) -> Void
    var body: some View {
        HStack(spacing: 4) {
            ForEach(Array(ReportRules.steps.enumerated()), id: \.offset) { index, label in
                Button { onSelect(index) } label: {
                    VStack(spacing: 4) {
                        Capsule().fill(index <= current ? Color(red: 0.23, green: 0.56, blue: 0.86) : Color(white: 0.89)).frame(height: 6)
                        Text(label).font(.system(size: 11, weight: index == current ? .bold : .regular)).foregroundStyle(index == current ? ReportAppearance.blue : ReportAppearance.muted)
                    }
                }.buttonStyle(.plain).frame(maxWidth: .infinity).frame(minHeight: 36).accessibilityAddTraits(index == current ? .isSelected : [])
            }
        }.padding(.horizontal, 12).padding(.vertical, 4).background(.white)
    }
}

/// 한 단계 — 큰 제목·부제 아래 내용
struct ReportStep<Content: View>: View {
    let title: String
    let sub: String
    @ViewBuilder let content: () -> Content
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(title).font(.system(size: 24, weight: .bold)).foregroundStyle(ReportAppearance.ink)
            Text(sub).font(.system(size: 14)).foregroundStyle(ReportAppearance.muted).padding(.top, 4).padding(.bottom, 14)
            content()
        }.frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// 판독 서버 설정 — 앱에는 AI 키를 넣지 않는다. 사용자가 운영·신뢰하는 HTTPS 서버만 쓴다.
struct VisionSettingsSheet: View {
    @Environment(\.dismiss) private var dismiss
    @AppStorage(ReportReading.endpointKey) private var endpoint = ""
    @AppStorage(ReportReading.consentKey) private var consent = ""
    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("https://내-서버/api/vision", text: $endpoint).textContentType(.URL).keyboardType(.URL)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                } header: { Text("판독 서버 주소") } footer: { Text("본인이 운영하거나 신뢰하는 서버의 /api/vision 주소입니다. API 키는 앱에 넣지 않습니다. 비워 두면 유형을 직접 고릅니다.") }
                Section {
                    Toggle("사진을 이 서버로 보내 판독", isOn: Binding(get: { consent == "yes" }, set: { consent = $0 ? "yes" : "no" }))
                } footer: { Text("사진 축소본만 보냅니다. 위치·주소·작성 내용은 보내지 않습니다. 원본은 기기에 남습니다.") }
            }.navigationTitle("사진 판독 설정").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("완료") { dismiss() } } }
        }
    }
}
