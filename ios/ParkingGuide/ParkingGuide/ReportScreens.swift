import SwiftUI
import UIKit
import Combine
import PhotosUI

// 웹 main 과 같은 흐름(2026-10-15): 처음 화면 → 두 장 촬영 → 신고서 5단계(유형·발생지역·차량번호·내용·점검·제출).
// 판독 근거·GPS 품질·촬영 방향은 뒤에서 기록만 하고, 화면에는 민원인이 할 일이 있을 때만 한 줄씩 꺼낸다.

/// 사진 판독 — 사용자가 설정한 HTTPS 서버로만 보내고, 사진 전송 동의는 한 번 받아 기억한다.
@MainActor final class ReportReading: ObservableObject {
    /// retrying: 판독 한도에 걸려 잠시 뒤 한 번 더 자동으로 판독하는 중 · limited: 다시 판독해도 한도에 걸림
    enum State: Equatable { case off, needsConsent, idle, loading, retrying, limited, ok, failed(String) }
    static let endpointKey = "evidenceVisionEndpoint"
    static let consentKey = "evidenceVisionConsent"
    /// 웹 RETRYING_TEXT 와 같은 문구
    static let retryingText = "사진 판독 한도에 걸려 잠시 뒤 한 번 더 자동으로 판독합니다"
    @Published private(set) var state: State = .idle
    private var task: Task<Void, Never>?
    /// 웹 RATE_LIMIT_RETRY_MS 와 같다 — 한 번만, 분당 한도가 풀릴 만큼 천천히
    var retryDelay: Duration = .seconds(40)
    /// 시험에서 바꿔 끼운다
    var analyzer: (ZoneCase, ZoneStore, String) async throws -> NativeAIResult = { draft, store, endpoint in
        try await NativeVisionClient.analyze(draft: draft, store: store, endpoint: endpoint, regionHints: draft.nativeRegionHints)
    }
    /// 같은 사진(판독 버전)은 한 번만 자동으로 다시 판독한다 — 사람이 '다시 판독'을 누르면 바로 한 번 부르기만 한다
    private var autoRetriedRevision: Int?

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
            while true {
                do {
                    let result = try await analyzer(captured, store, address)
                    try Task.checkCancellation()
                    apply(result, captured); state = .ok
                } catch let error as NativeVisionError where error.rateLimited {
                    guard !Task.isCancelled else { return }
                    guard autoRetriedRevision != captured.review.revision else { state = .limited; return }
                    autoRetriedRevision = captured.review.revision
                    state = .retrying
                    do { try await Task.sleep(for: retryDelay) } catch { return }
                    state = .loading
                    continue
                } catch {
                    if !Task.isCancelled { state = .failed(error.localizedDescription) }
                }
                return
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
    /// 신고서 사진 칸에서 카메라로 바꾸기·넣기 — 남길 사진 다음(2번째)으로 한 장을 찍는다
    @State private var cameraReplace: ReportCaptureScreen.Replace?
    @State private var askMore: Bool
    let onSubmitted: () -> Void

    init(initial: ZoneCase, store: ZoneStore, askMore: Bool = false, onSubmitted: @escaping () -> Void) {
        self.store = store; self.onSubmitted = onSubmitted
        _draft = State(initialValue: initial)
        // 신고서까지 갔던 신고(앨범 1장·사진을 지운 신고 포함)는 촬영이 아니라 신고서로 연다(웹 phase 'form')
        _capturing = State(initialValue: initial.primaryPair.count < 2 && initial.formOpened != true)
        _askMore = State(initialValue: askMore)
    }

    var body: some View {
        Group {
            if let replace = cameraReplace {
                ReportCaptureScreen(draft: $draft, store: store, mode: .replace(replace), onDone: {
                    cameraReplace = nil; draft.step = 0
                }, onExit: { cameraReplace = nil })
            } else if capturing {
                ReportCaptureScreen(draft: $draft, store: store, mode: .pair(retake: retake), onDone: {
                    retake = nil; draft.step = 0; draft.formOpened = true; try? store.save(draft); capturing = false
                }, onExit: {
                    // 신고서에서 다시 찍으러 왔으면 신고서로 돌아간다(웹 '재촬영 취소'와 같다)
                    if draft.formOpened == true { retake = nil; capturing = false } else { close() }
                })
            } else {
                ReportStepsScreen(draft: $draft, store: store, askMore: $askMore,
                                  onRetakeSecond: { draft.formOpened = true; retake = .second; capturing = true },
                                  onCamera: { keep, target in
                                      draft.formOpened = true
                                      if let keep { cameraReplace = .init(keep: keep, target: target) } else { retake = .first; capturing = true }
                                  },
                                  onHome: close, onDeleted: { dismiss() }, onSubmitted: { onSubmitted(); dismiss() })
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
    /// 신고서 사진 칸의 카메라 바꾸기·넣기 — keep 사진을 1번째로 남기고 새 사진을 2번째로 찍는다. target 은 바꿀 사진(넣기면 nil).
    struct Replace: Equatable { let keep: UUID; let target: UUID? }
    enum Mode: Equatable { case pair(retake: PrimarySlot?), supplement(text: String), replace(Replace) }
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

    private var replacing: Replace? { if case .replace(let value) = mode { return value }; return nil }
    private var first: ZoneEvidence? {
        if let replacing { return draft.evidence.first { $0.id == replacing.keep } }
        return retake == .first ? nil : draft.evidence.first { $0.primarySlot == .first }
    }
    private var second: ZoneEvidence? { retake != nil || replacing != nil ? nil : draft.evidence.first { $0.primarySlot == .second } }
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
                Button(action: onExit) { Label(isSupplement || replacing != nil ? "취소" : "처음 화면", systemImage: "arrow.left").font(.system(size: 15)) }
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
                        if phase != .first && replacing == nil { Button("첫 사진 다시 찍기") { retake = .first }.font(.system(size: 14)).foregroundStyle(.white).disabled(saving) }
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
        if let replacing {
            // 새 사진 저장이 끝난 뒤에만 바꿀 사진을 뺀다(ZoneStore.replacePrimary)
            saving = true
            defer { saving = false }
            do {
                draft = try store.replacePrimary(data: data, source: .prototypeCamera, date: takenAt, location: location.snapshot(at: takenAt), replacing: replacing.target, in: draft)
                camera.retake(); onDone()
            } catch {
                self.error = "사진을 저장하지 못했습니다. 기존 사진과 입력은 그대로입니다. 다시 찍어 주세요."
                camera.retake()
            }
            return
        }
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
    /// 앨범에서 1장만 골라 들어왔을 때 — 화면을 열자마자 1장 더 넣기를 묻는다
    @Binding var askMore: Bool
    let onRetakeSecond: () -> Void
    /// 사진 칸의 카메라 바꾸기·넣기 — keep 을 남기고 다음 사진을 찍는다. keep 이 없으면 두 장을 처음부터 찍는다.
    let onCamera: (_ keep: UUID?, _ target: UUID?) -> Void
    let onHome: () -> Void
    /// 마지막 사진을 지워 신고를 지웠을 때
    let onDeleted: () -> Void
    let onSubmitted: () -> Void
    /// 사진 칸 바꾸기·넣기 선택(앨범·카메라). more: 앨범 1장 뒤 '1장 더 넣기'
    struct PhotoSheet: Equatable { let index: Int; let more: Bool }
    @State private var photoSheet: PhotoSheet?
    @State private var removing: ZoneEvidence?
    @State private var albumIndex: Int?
    @State private var albumOpen = false
    @State private var albumItem: PhotosPickerItem?
    @State private var photoBusy = false
    @StateObject private var reading = ReportReading()
    @State private var saveState = ZoneDraftSaveState()
    @State private var typeSheet = false
    @State private var settingsOpen = false
    @State private var supplementCapture: ReportEvidence.Supplement?
    @State private var resetBody = false
    @State private var submitBlocked: String?
    /// 빨간불이 있는 채 제출을 눌렀다 — 사유와 불수용 안내. 창에 보여 준 빨간불을 담는다.
    @State private var redNotice: [ReportCheck] = []
    @Environment(\.scenePhase) private var scenePhase

    private var step: Int { min(max(draft.step, 0), ReportRules.steps.count - 1) }
    private func persist() { saveState.persist(draft, in: store) }
    private func go(_ next: Int) { draft.step = next; persist() }
    private func read(force: Bool = false) {
        reading.run(draft, store: store, force: force) { result, captured in
            guard draft.review.revision == captured.review.revision, draft.evidence.map(\.id) == captured.evidence.map(\.id) else { return }
            var review = draft.review; review.aiResult = result; draft.evidenceReview = review
            draft.applyPhotoType(); draft.applyPhotoPlate(); persist()
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
                    let reds = draft.reportReds
                    Button { if reds.isEmpty { submit() } else { redNotice = reds } } label: { Text(reds.isEmpty ? "제출" : "제출 (빨간불 \(reds.count)개)").frame(maxWidth: .infinity) }
                        .buttonStyle(ReportButtonStyle(primary: true))
                }
            }.padding(.horizontal, 16).padding(.vertical, 10).background(.white).overlay(alignment: .top) { ReportAppearance.border.frame(height: 1) }
        }
        .toolbar { ToolbarItemGroup(placement: .keyboard) { Spacer(); Button("입력 완료") { UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil) } } }
        .task {
            syncPhotoType(); read()
            if askMore {
                askMore = false
                guard draft.primaryPair.count == 1 else { return }
                try? await Task.sleep(for: .milliseconds(400))
                photoSheet = PhotoSheet(index: 1, more: true)
            }
        }
        .confirmationDialog(photoSheetTitle, isPresented: Binding(get: { photoSheet != nil }, set: { if !$0 { photoSheet = nil } }), titleVisibility: .visible, presenting: photoSheet) { sheet in
            Button("앨범에서 고르기") {
                // 선택 창이 닫힌 뒤에 앨범을 연다(바로 열면 겹쳐 열리지 않는다)
                albumIndex = sheet.index
                Task { try? await Task.sleep(for: .milliseconds(400)); albumOpen = true }
            }
            Button("카메라로 찍기") { camera(sheet.index) }
            Button(sheet.more ? "나중에" : "취소", role: .cancel) {}
        } message: { sheet in Text(photoSheetMessage(sheet)) }
        .confirmationDialog(removing.map { "\(slotName($0))을 지울까요?" } ?? "", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }), titleVisibility: .visible, presenting: removing) { photo in
            let last = draft.primaryPair.count <= 1
            Button(last ? "신고 지우기" : "지우기", role: .destructive) { remove(photo) }
            if last {
                Button("다른 사진으로 바꾸기") {
                    Task { try? await Task.sleep(for: .milliseconds(400)); photoSheet = PhotoSheet(index: 0, more: false) }
                }
            }
            Button("취소", role: .cancel) {}
        } message: { _ in Text(removeMessage) }
        .photosPicker(isPresented: $albumOpen, selection: $albumItem, matching: .images)
        .onChange(of: albumItem) { _, item in
            if let item, let index = albumIndex { Task { await importAlbum(item, index: index) } }
        }
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
        .overlay {
            if !redNotice.isEmpty {
                let shown = redNotice
                RedNoticeDialog(reds: shown,
                                onFix: { redNotice = []; go(ReportRules.fixStep(shown.first?.id ?? "")) },
                                onSubmit: { redNotice = []; submit(acknowledged: shown.map(\.id)) },
                                onClose: { redNotice = [] })
            }
        }
        .confirmationDialog("직접 고친 내용을 자동 작성으로 되돌릴까요?", isPresented: $resetBody, titleVisibility: .visible) {
            Button("자동 작성으로 되돌리기") { draft.bodyEdited = false; draft.body = ""; persist() }
        }
    }

    // 0. 유형
    private var typeStep: some View {
        ReportStep(title: "위반 유형 확인", sub: "사진에 보이는 것으로 정했습니다") {
            photoSlots
            if let gap = draft.intervalSeconds { Text("\(Int(gap))초 간격").font(.system(size: 13)).foregroundStyle(ReportAppearance.muted).padding(.top, 6) }
            readingLine.padding(.top, 4)
            HStack {
                Text("불법 주정차 유형").font(.system(size: 15, weight: .bold)).foregroundStyle(ReportAppearance.ink)
                Spacer()
                Button { typeSheet = true } label: { Label("유형선택", systemImage: "hand.point.up.left") }.buttonStyle(ReportButtonStyle())
            }.padding(.top, 20)
            typeValue
            if ReportEvidence.crosswalkAdjacent(draft) && draft.reportType != .crossing {
                Text(ReportEvidence.crosswalkAdjacentNote).font(.system(size: 14)).foregroundStyle(ReportAppearance.ink).fixedSize(horizontal: false, vertical: true)
                    .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                    .overlay(RoundedRectangle(cornerRadius: 6).stroke(ReportAppearance.border)).padding(.top, 14)
            }
            followUps
        }
    }
    // 사진 두 칸 — 칸마다 바꾸기·지우기, 빈 칸은 사진 넣기(웹 PhotoSlots 와 같은 흐름·문구)
    @ViewBuilder private var photoSlots: some View {
        let pair = Array(draft.primaryPair.prefix(2))
        HStack(alignment: .top, spacing: 8) {
            ForEach(0..<2, id: \.self) { index in
                if index < pair.count { filledSlot(pair[index], index: index) } else { emptySlot(index) }
            }
        }
    }
    private func filledSlot(_ photo: ZoneEvidence, index: Int) -> some View {
        VStack(spacing: 4) {
            ZStack(alignment: .bottom) {
                if let image = store.image(photo) { Image(uiImage: image).resizable().scaledToFill() } else { Color(white: 0.92) }
                Text(photo.takenAt.map(ReportRules.clock) ?? "시각 없음").font(.system(size: 11)).monospacedDigit()
                    .frame(maxWidth: .infinity).padding(.vertical, 2).background(.black.opacity(0.6)).foregroundStyle(.white)
            }.frame(maxWidth: .infinity).aspectRatio(4 / 3, contentMode: .fit).clipShape(RoundedRectangle(cornerRadius: 8))
                .overlay { if photoBusy && albumIndex == index { ProgressView("사진 읽는 중…").font(.system(size: 13)).frame(maxWidth: .infinity, maxHeight: .infinity).background(.white.opacity(0.8)) } }
            HStack(spacing: 4) {
                Button { photoSheet = PhotoSheet(index: index, more: false) } label: {
                    Label("바꾸기", systemImage: "arrow.triangle.2.circlepath").font(.system(size: 14, weight: .bold)).frame(maxWidth: .infinity, minHeight: 40)
                }.foregroundStyle(ReportAppearance.ink).accessibilityLabel("\(index + 1)번째 사진 바꾸기")
                Button { removing = photo } label: {
                    Label("지우기", systemImage: "trash").font(.system(size: 14, weight: .bold)).frame(maxWidth: .infinity, minHeight: 40)
                }.foregroundStyle(.red).accessibilityLabel("\(index + 1)번째 사진 지우기")
            }.buttonStyle(.plain).labelStyle(.titleAndIcon)
                .overlay(alignment: .center) { ReportAppearance.border.frame(width: 1).padding(.vertical, 8) }
                .overlay(RoundedRectangle(cornerRadius: 6).stroke(ReportAppearance.border))
                .disabled(photoBusy)
        }.frame(maxWidth: .infinity)
    }
    private func emptySlot(_ index: Int) -> some View {
        Button { photoSheet = PhotoSheet(index: index, more: false) } label: {
            // 사진 칸과 같은 4:3 크기 — 늘어나는 도형에 비율을 걸고 글자는 위에 얹는다
            RoundedRectangle(cornerRadius: 8).fill(ReportAppearance.blue.opacity(0.06))
                .aspectRatio(4 / 3, contentMode: .fit)
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(ReportAppearance.blue, style: StrokeStyle(lineWidth: 2, dash: [5])))
                .overlay {
                    VStack(spacing: 4) {
                        if photoBusy && albumIndex == index { ProgressView() } else { Image(systemName: "plus").font(.system(size: 22, weight: .semibold)) }
                        Text(photoBusy && albumIndex == index ? "사진 읽는 중…" : "사진 넣기").font(.system(size: 15, weight: .bold))
                    }.foregroundStyle(ReportAppearance.blue)
                }
                .contentShape(Rectangle())
        }.buttonStyle(.plain).disabled(photoBusy).frame(maxWidth: .infinity).accessibilityLabel("\(index + 1)번째 사진 넣기")
    }
    private var intervalText: String {
        let s = ReportRules.intervalSeconds
        return s >= 60 && s % 60 == 0 ? "\(s / 60)분" : "\(s)초"
    }
    private var supplementCount: Int { max(0, draft.evidence.count - draft.primaryPair.count) }
    private func slotName(_ photo: ZoneEvidence) -> String { "\((draft.primaryPair.firstIndex { $0.id == photo.id } ?? 0) + 1)번째 사진" }
    private var photoSheetTitle: String {
        guard let sheet = photoSheet else { return "" }
        if sheet.more { return "사진 1장 더 넣기" }
        return sheet.index < draft.primaryPair.count ? "\(sheet.index + 1)번째 사진 바꾸기" : "\(sheet.index + 1)번째 사진 넣기"
    }
    private func photoSheetMessage(_ sheet: PhotoSheet) -> String {
        let replacing = sheet.index < draft.primaryPair.count
        let remaining = draft.primaryPair.count - (replacing ? 1 : 0)
        var text = sheet.more ? "사진이 2장 있어야 신고할 수 있습니다. 같은 자리에서 \(intervalText) 이상 간격을 두고 찍은 사진을 골라 주세요.\(ReportRules.intervalNote)\n" : ""
        text += remaining > 0 ? "카메라로 찍은 사진은 남은 사진 다음, 2번째 사진이 됩니다." : "카메라로는 1번째·2번째 사진을 차례로 찍습니다."
        text += " 두 사진은 촬영 시각 순서로 1·2번째가 정해집니다."
        if replacing && supplementCount > 0 { text += " 보완 사진 \(supplementCount)장은 함께 빠집니다." }
        return text
    }
    private var removeMessage: String {
        if draft.primaryPair.count <= 1 { return "사진이 이 1장뿐이라, 지우면 이 신고도 함께 지워집니다." }
        return "이 사진과 판독 결과를 지웁니다. 빈 칸에 다른 사진을 넣으면 됩니다." + (supplementCount > 0 ? " 보완 사진 \(supplementCount)장은 함께 빠집니다." : "")
    }
    /// 사진이 바뀌면 사진 근거로 정한 유형을 다시 맞추고 다시 판독한다
    private func photosChanged() { saveState.saved(); syncPhotoType(); read() }
    private func camera(_ index: Int) {
        let pair = draft.primaryPair
        let target = index < pair.count ? pair[index].id : nil
        let keep = pair.first { $0.id != target }?.id
        persist(); onCamera(keep, target)
    }
    private func remove(_ photo: ZoneEvidence) {
        if draft.primaryPair.count <= 1 {
            do { try store.delete(draft); onDeleted() } catch { saveState.failed("지우지 못했습니다. 기존 자료를 유지했습니다.") }
            return
        }
        do { draft = try store.removePrimary(photo, from: draft); photosChanged() }
        catch { saveState.failed("사진을 지우지 못했습니다. 기존 사진과 입력은 그대로입니다.") }
    }
    /// 앨범 한 장 → 그 칸에. 새 사진을 다 읽은 뒤에만 바꾼다 — 실패하면 기존 사진·입력은 그대로다.
    private func importAlbum(_ item: PhotosPickerItem, index: Int) async {
        photoBusy = true
        defer { photoBusy = false; albumItem = nil; albumIndex = nil }
        do {
            guard let data = try await item.loadTransferable(type: Data.self), data.count <= 25 * 1024 * 1024, UIImage(data: data) != nil else { throw CocoaError(.fileReadCorruptFile) }
            let meta = AlbumPhotoMeta(data)
            let target = index < draft.primaryPair.count ? draft.primaryPair[index].id : nil
            draft = try store.replacePrimary(data: data, source: .album, date: meta.takenAt, location: meta.location, replacing: target, in: draft)
            photosChanged()
        } catch {
            saveState.failed("사진을 읽지 못했습니다. 기존 사진과 입력은 그대로입니다.")
        }
    }
    @ViewBuilder private var readingLine: some View {
        switch reading.state {
        case .loading: Label("사진 판독 중…", systemImage: "hourglass").font(.system(size: 13)).foregroundStyle(ReportAppearance.muted)
        case .ok: Text(draft.review.aiResult?.responseFormat == "legacy" ? "사진 판독 완료 · 기본 분석만 받았습니다" : "사진 판독 완료").font(.system(size: 13)).foregroundStyle(ReportAppearance.muted)
        case .failed: HStack { Text("사진 판독에 실패했습니다").font(.system(size: 13)).foregroundStyle(.red); Button("다시 판독") { read(force: true) }.font(.system(size: 13, weight: .bold)) }
        case .retrying: Label(ReportReading.retryingText, systemImage: "clock").font(.system(size: 13)).foregroundStyle(ReportAppearance.muted)
        case .limited: HStack { Text("사진 판독 한도에 걸렸습니다. 잠시 후 다시 시도해 주세요").font(.system(size: 13)).foregroundStyle(ReportAppearance.muted); Button("다시 판독") { read(force: true) }.font(.system(size: 13, weight: .bold)) }
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

    // 2. 차량번호 — 두 사진에서 따로 읽은 번호가 같을 때만 채운다(웹 PlateNote).
    // AI 가 확실히 못 읽으면 사진을 보고 직접 넣게 안내하고, AI 가 확실히 읽은 번호와 다르면 '사진을 보고 다시 확인' 체크를 받는다.
    private var plateStep: some View {
        let ps = draft.plateStatus
        return ReportStep(title: "차량번호 확인", sub: "두 사진에서 따로 읽은 번호가 같을 때만 채웁니다") {
            TextField(reading.state == .loading ? "번호판을 읽는 중…" : "직접 입력 (예: 12가3456)", text: Binding(get: { draft.plate ?? "" }, set: { draft.plate = $0; persist() }))
                .textFieldStyle(.roundedBorder).font(.system(size: 20, weight: .medium)).autocorrectionDisabled().accessibilityLabel("차량번호")
            if !ps.entered.isEmpty && !ReportRules.isValidPlate(ps.entered) { Text("형식이 맞지 않습니다. 예: 12가3456, 123가4567").font(.system(size: 13)).foregroundStyle(.red).padding(.top, 6) }
            plateNote(ps)
            HStack(spacing: 8) {
                ForEach(draft.primaryPair.prefix(2)) { photo in
                    if let image = store.image(photo) { Image(uiImage: image).resizable().scaledToFit().frame(maxWidth: .infinity).clipShape(RoundedRectangle(cornerRadius: 8)) }
                }
            }.padding(.top, 12)
        }
    }
    @ViewBuilder private func plateNote(_ ps: PlateStatus) -> some View {
        switch ps.kind {
        case .match:
            HStack(spacing: 8) {
                Text("두 장 판독 일치").font(.system(size: 12, weight: .bold)).foregroundStyle(ReportAppearance.blue)
                    .padding(.horizontal, 8).padding(.vertical, 2).overlay(RoundedRectangle(cornerRadius: 4).stroke(ReportAppearance.blue.opacity(0.4)))
                Text("신뢰도 \(Int(((draft.photoPlates?.compactMap { $0?.confidence }.min() ?? 0) * 100).rounded()))% · 한 글자씩 확인해 주세요").font(.system(size: 13)).foregroundStyle(ReportAppearance.muted)
            }.padding(.top, 6)
        case .empty:
            HStack(spacing: 6) {
                Text("두 사진에서 같은 번호(\(ps.reads[0]))를 읽었어요. 사진을 보고 맞으면").font(.system(size: 13)).foregroundStyle(ReportAppearance.muted)
                plateUseButton(ps.reads[0])
            }.padding(.top, 6)
        case .conflict:
            let ready = ReportRules.isValidPlate(ps.entered)
            let tint: Color = ps.confirmed ? .orange : .red
            VStack(alignment: .leading, spacing: 8) {
                Text(ps.conflict == .reads ? "AI가 두 장에서 서로 다른 번호를 읽었어요(\(ps.reads.joined(separator: " / ")))" : "입력한 번호가 AI가 두 장에서 읽은 번호(\(ps.reads[0]))와 달라요")
                    .font(.system(size: 15, weight: .bold)).foregroundStyle(tint)
                Text("아래 사진에서 번호판을 한 글자씩 보고, 사진에 보이는 번호로 입력해 주세요.").font(.system(size: 13)).foregroundStyle(ReportAppearance.muted)
                plateReads(ps)
                plateUseButtons(ps)
                Button {
                    guard ready else { return }
                    draft.plateConfirmedFor = ps.confirmed ? nil : ps.entered; persist()
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: ps.confirmed ? "checkmark.square.fill" : "square").font(.system(size: 24)).foregroundStyle(ps.confirmed ? ReportAppearance.blue : Color.gray)
                        Text(ready ? "사진을 보고 다시 확인했어요 (\(ps.entered))" : "번호를 입력하면 확인할 수 있어요").font(.system(size: 16)).foregroundStyle(ReportAppearance.ink)
                    }.frame(minHeight: 44)
                }.buttonStyle(.plain).disabled(!ready).accessibilityValue(ps.confirmed ? "확인함" : "확인 안 함")
                Text(ps.confirmed ? "확인한 번호로 냅니다. 담당자가 사진으로 번호를 한 번 더 확인해요." : "확인하지 않으면 빨간불로 남고, 제출할 때 불수용 가능성 안내가 한 번 더 떠요.")
                    .font(.system(size: 13)).foregroundStyle(tint)
            }.padding(12).frame(maxWidth: .infinity, alignment: .leading)
            .background(tint.opacity(0.07), in: RoundedRectangle(cornerRadius: 10)).overlay(RoundedRectangle(cornerRadius: 10).stroke(tint.opacity(0.4))).padding(.top, 8)
        case .unreadable:
            if reading.state != .loading && reading.state != .retrying {
                VStack(alignment: .leading, spacing: 6) {
                    Text("사진에서 번호판을 확실히 읽지 못했어요").font(.system(size: 15, weight: .bold)).foregroundStyle(.orange)
                    Text(ps.reason ?? "").font(.system(size: 13)).foregroundStyle(ReportAppearance.muted)
                    VStack(alignment: .leading, spacing: 3) {
                        Text("· 아래 사진을 보고 직접 입력해 주세요.")
                        Text("· 현장에서 본 번호가 아니라 **사진에 보이는 번호**를 입력해 주세요. 사진에 번호판이 안 보이면 불수용될 수 있어요.")
                        Text("· 담당자가 사진으로 번호를 한 번 더 확인해요.")
                    }.font(.system(size: 13)).foregroundStyle(ReportAppearance.ink)
                    if draft.photoPlates != nil { plateReads(ps) }
                    plateUseButtons(ps)
                }.padding(12).frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.orange.opacity(0.07), in: RoundedRectangle(cornerRadius: 10)).overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.orange.opacity(0.4))).padding(.top, 8)
            }
        }
    }
    /// 사진마다 AI 가 읽은 번호와 입력한 번호를 나란히
    private func plateReads(_ ps: PlateStatus) -> some View {
        let photos = draft.photoPlates ?? [nil, nil]
        return VStack(spacing: 0) {
            ForEach(Array(photos.enumerated()), id: \.offset) { i, read in
                HStack {
                    Text("\(i + 1)장 사진 AI 판독").foregroundStyle(ReportAppearance.muted)
                    Spacer()
                    if let read, read.readable { Text("\(read.text) · 확신 \(Int((read.confidence * 100).rounded()))%").bold().monospacedDigit() }
                    else { Text("못 읽음").foregroundStyle(ReportAppearance.muted) }
                }.padding(.horizontal, 10).padding(.vertical, 6)
                Divider()
            }
            HStack {
                Text("입력한 번호").foregroundStyle(ReportAppearance.muted)
                Spacer()
                Text(ps.entered.isEmpty ? "빈칸" : ps.entered).bold().monospacedDigit()
            }.padding(.horizontal, 10).padding(.vertical, 6)
        }.font(.system(size: 15)).background(.white, in: RoundedRectangle(cornerRadius: 8)).overlay(RoundedRectangle(cornerRadius: 8).stroke(ReportAppearance.border))
    }
    @ViewBuilder private func plateUseButtons(_ ps: PlateStatus) -> some View {
        let uses = ps.reads.reduce(into: [String]()) { if !$0.contains($1) && $1 != ps.entered && ReportRules.isValidPlate($1) { $0.append($1) } }
        if !uses.isEmpty {
            HStack(spacing: 6) {
                Text("사진을 보고 맞으면").font(.system(size: 13)).foregroundStyle(ReportAppearance.muted)
                ForEach(uses, id: \.self) { plateUseButton($0) }
            }
        }
    }
    private func plateUseButton(_ text: String) -> some View {
        Button("\(text) 쓰기") { draft.plate = text; persist() }
            .font(.system(size: 13, weight: .bold)).buttonStyle(.bordered).accessibilityLabel("\(text) 쓰기")
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
        return ReportStep(title: "제출 전 점검", sub: draft.reportBlocked ? "빨간불이 있으면 불수용될 수 있어요. 제출할 때 사유를 한 번 더 알려 드려요" : "점검 결과를 확인하고 제출해 주세요") {
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
            if let line = draft.officerPlateLine {
                VStack(alignment: .leading, spacing: 4) {
                    Text("담당 공무원에게 함께 가는 확인 사항").font(.system(size: 15, weight: .bold))
                    Text(line).font(.system(size: 13)).foregroundStyle(ReportAppearance.ink).fixedSize(horizontal: false, vertical: true)
                }.padding(12).frame(maxWidth: .infinity, alignment: .leading)
                .background(ReportAppearance.blue.opacity(0.06), in: RoundedRectangle(cornerRadius: 10)).overlay(RoundedRectangle(cornerRadius: 10).stroke(ReportAppearance.blue.opacity(0.3))).padding(.top, 12)
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
    /// acknowledged: 빨간불 사유와 불수용 안내 창에서 본 빨간불(점검 id). 누르는 순간 다시 점검해서
    /// 창에서 보지 못한 빨간불이 새로 생겼으면 내지 않는다(웹 onSubmit).
    private func submit(acknowledged: [String] = []) {
        var done = draft
        let reds = done.reportReds
        if reds.contains(where: { !acknowledged.contains($0.id) }) { submitBlocked = "현재 상태로 다시 점검했습니다. 빨간불 항목을 확인해 주세요."; return }
        done.submittedWithReds = reds.isEmpty ? nil : reds.map(\.label)
        done.submittedAt = Date()
        if done.bodyEdited != true { done.body = done.composedBody }
        done.officerNote = done.officerLines.isEmpty ? nil : done.officerLines.joined(separator: "\n")
        do { try store.save(done); draft = done; onSubmitted() }
        catch { saveState.failed("저장하지 못했습니다. 입력은 이 화면에 그대로 있습니다. 다시 시도해 주세요.") }
    }
}

extension ReportEvidence.Supplement: Identifiable {}

/// 빨간불이 있는 채 제출할 때의 창 — 웹 RedNotice(가운데 창·파란 제목 줄)와 같은 모양과 문구.
/// 빨간불마다 이름과 사유, 불수용될 수 있다는 안내. 항목이 많으면 창 안에서 스크롤한다.
struct RedNoticeDialog: View {
    let reds: [ReportCheck]
    let onFix: () -> Void
    let onSubmit: () -> Void
    let onClose: () -> Void

    // 웹 Tailwind 색과 같게
    private static let bar = Color(red: 58 / 255, green: 143 / 255, blue: 219 / 255)       // #3a8fdb
    private static let dim = Color(red: 15 / 255, green: 23 / 255, blue: 42 / 255)         // slate-900
    private static let red = Color(red: 220 / 255, green: 38 / 255, blue: 38 / 255)        // red-600
    private static let redBox = Color(red: 254 / 255, green: 242 / 255, blue: 242 / 255)   // red-50
    private static let redEdge = Color(red: 254 / 255, green: 202 / 255, blue: 202 / 255)  // red-200
    private static let redLine = Color(red: 254 / 255, green: 226 / 255, blue: 226 / 255)  // red-100
    private static let ink = Color(red: 15 / 255, green: 23 / 255, blue: 42 / 255)         // slate-900
    private static let detail = Color(red: 51 / 255, green: 65 / 255, blue: 85 / 255)      // slate-700
    private static let note = Color(red: 71 / 255, green: 85 / 255, blue: 105 / 255)       // slate-600
    private static let edge = Color(red: 226 / 255, green: 232 / 255, blue: 240 / 255)     // slate-200
    private static let label = Color(red: 30 / 255, green: 41 / 255, blue: 59 / 255)       // slate-800

    var body: some View {
        ZStack {
            Self.dim.opacity(0.5).ignoresSafeArea()
            VStack(spacing: 0) {
                HStack {
                    Text("불수용될 수 있어요").font(.system(size: 21, weight: .bold))
                    Spacer()
                    Button(action: onClose) { Image(systemName: "xmark").font(.system(size: 24, weight: .heavy)).frame(width: 44, height: 44) }
                        .accessibilityLabel("닫기")
                }
                .foregroundStyle(.white).padding(.leading, 16).padding(.trailing, 8).frame(height: 56).background(Self.bar)
                ViewThatFits(in: .vertical) {
                    content
                    ScrollView { content }
                }
            }
            .background(.white).shadow(color: .black.opacity(0.25), radius: 16, y: 6)
            .padding(.horizontal, 24).padding(.vertical, 24)
            .accessibilityElement(children: .contain).accessibilityAddTraits(.isModal)
        }
    }

    private var content: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("빨간불 \(reds.count)개가 남아 있어요. 이대로 내면 담당자가 \(Text("불수용할 수 있어요").bold()).")
                .font(.system(size: 16)).foregroundStyle(Self.ink).fixedSize(horizontal: false, vertical: true)
            VStack(spacing: 0) {
                ForEach(Array(reds.enumerated()), id: \.element.id) { index, check in
                    if index > 0 { Self.redLine.frame(height: 1) }
                    HStack(alignment: .top, spacing: 8) {
                        Circle().fill(Self.red).frame(width: 12, height: 12).padding(.top, 5).accessibilityLabel("불가")
                        VStack(alignment: .leading, spacing: 2) {
                            Text(check.label).font(.system(size: 15, weight: .bold)).foregroundStyle(Self.ink)
                            Text(check.detail).font(.system(size: 13)).foregroundStyle(Self.detail).fixedSize(horizontal: false, vertical: true)
                        }
                        Spacer(minLength: 0)
                    }.padding(.horizontal, 12).padding(.vertical, 8)
                }
            }
            .background(Self.redBox, in: RoundedRectangle(cornerRadius: 4)).overlay(RoundedRectangle(cornerRadius: 4).stroke(Self.redEdge))
            Text("고칠 수 있으면 고친 뒤 내 주세요. 그래도 내면 빨간불 항목을 알고 냈다는 것이 담당자에게 함께 갑니다.")
                .font(.system(size: 14)).foregroundStyle(Self.note).fixedSize(horizontal: false, vertical: true)
            Button(action: onFix) {
                Text("수정하기").font(.system(size: 19, weight: .bold)).foregroundStyle(.white).frame(maxWidth: .infinity, minHeight: 56).background(Self.bar)
            }.buttonStyle(.plain)
            Button(action: onSubmit) {
                Text("그래도 제출하기").font(.system(size: 19)).foregroundStyle(Self.label).frame(maxWidth: .infinity, minHeight: 56).overlay(Rectangle().stroke(Self.edge, lineWidth: 2))
            }.buttonStyle(.plain)
        }.padding(16)
    }
}

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
