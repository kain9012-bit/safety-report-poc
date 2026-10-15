import SwiftUI
import AVFoundation
import AVKit

struct CaptureScreen: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var camera = CameraModel()
    @StateObject private var location = CaptureLocation()
    @State private var captureLocation: LocationRecord?
    @State private var saving = false
    @State private var seconds = 5
    @State private var photosOnly = false
    @State private var officialGuidesOpen = false
    let replacing: Bool
    let photosOnlyMode: Bool
    let guidance: String?
    let onUse: (Data, Date) throws -> Void
    let onUseLocated: ((Data, Date, LocationRecord?) throws -> Void)?
    let onUseClip: (CapturedClip) throws -> Void

    init(replacing: Bool, photosOnlyMode: Bool = false, guidance: String? = nil, onUseLocated: ((Data, Date, LocationRecord?) throws -> Void)? = nil, onUse: @escaping (Data, Date) throws -> Void, onUseClip: @escaping (CapturedClip) throws -> Void) {
        self.replacing = replacing; self.photosOnlyMode = photosOnlyMode; self.guidance = guidance
        self.onUseLocated = onUseLocated; self.onUse = onUse; self.onUseClip = onUseClip
        _photosOnly = State(initialValue: photosOnlyMode)
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 12) {
                if let clip = camera.clip {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 16) {
                            Text("촬영 결과 확인").font(.title2.bold())
                            ClipPlayer(url: clip.url).frame(height: 240).clipShape(RoundedRectangle(cornerRadius: 12))
                            Text("연속 촬영 원본 · \(clip.duration, specifier: "%.2f")초 · 음성 없음").font(.subheadline.bold())
                            HStack(alignment: .top, spacing: 12) {
                                frame(clip.firstImage, label: "시작 장면", offset: clip.firstOffset)
                                frame(clip.lastImage, label: "끝 장면", offset: clip.lastOffset)
                            }
                            Text("한 영상에서 추출한 앞뒤 장면입니다. 독립 사진 두 장이나 계속 정차 증명으로 판정하지 않습니다.").font(.footnote).foregroundStyle(.secondary)
                            Text("자동인식 모델 미연결 · 번호판과 장소를 직접 확인해 주세요.").font(.footnote).foregroundStyle(.secondary)
                            Button("전용구역 3종 공식 안내", systemImage: "book.closed") { officialGuidesOpen = true }.buttonStyle(.bordered)
                            Button {
                                saving = true
                                do { try onUseClip(clip); dismiss() }
                                catch { camera.error = "저장하지 못했어요. 기존 촬영본은 유지됩니다. \(error.localizedDescription)"; saving = false }
                            } label: { Text(saving ? "저장 중…" : "영상 사용 · 저장").frame(maxWidth: .infinity).padding(.vertical, 6) }
                                .buttonStyle(.borderedProminent).disabled(saving)
                            HStack {
                                Button("다시 촬영") { camera.retake() }
                                Button("촬영본 삭제") { camera.retake() }
                            }.buttonStyle(.bordered).disabled(saving)
                            if replacing { Text("새 영상 저장이 완료되기 전까지 기존 촬영본을 유지합니다.").font(.caption).foregroundStyle(.secondary) }
                        }.padding(.vertical)
                    }
                } else if let data = camera.draft, let image = UIImage(data: data) {
                    Image(uiImage: image).resizable().scaledToFit().frame(maxHeight: .infinity).accessibilityLabel("방금 촬영한 사진")
                    Text(guidance ?? "차량과 주변 상황이 잘 보이나요?").font(.headline)
                    Text(photosOnlyMode ? "저장 후 필요할 때 사진 근거를 분석할 수 있어요." : "이 촬영 화면은 자동 판독 없이 원본을 보관합니다.").font(.footnote).foregroundStyle(.secondary)
                    Button("전용구역 3종 공식 안내", systemImage: "book.closed") { officialGuidesOpen = true }.font(.footnote)
                    HStack {
                        Button("다시 찍기") { camera.retake() }.buttonStyle(.bordered)
                        Button("이 사진 사용") {
                            saving = true
                            do { if let onUseLocated { try onUseLocated(data, camera.capturedAt, captureLocation) } else { try onUse(data, camera.capturedAt) }; dismiss() }
                            catch { camera.error = "저장하지 못했어요. \(error.localizedDescription)"; saving = false }
                        }.buttonStyle(.borderedProminent).disabled(saving)
                    }.padding(.bottom)
                } else if camera.denied {
                    ContentUnavailableView {
                        Label("카메라 접근이 필요해요", systemImage: "camera.fill")
                    } description: { Text("설정에서 카메라 접근을 허용하면 촬영할 수 있어요.") }
                    actions: {
                        Button("설정 열기") { if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) } }
                    }
                } else {
                    ZStack(alignment: .top) {
                        CameraPreview(session: camera.engine.session).background(.black)
                        VStack(spacing: 8) {
                            Text(guidance ?? "차량 번호판과 노면·보도 경계를 함께 담아 주세요.").font(.headline)
                            Text("고정 촬영 안내 · 분석은 저장 후 선택").font(.caption)
                        }.padding().frame(maxWidth: .infinity).background(.black.opacity(0.65)).foregroundStyle(.white)
                        if camera.recording, let date = camera.recordingStartedAt {
                            TimelineView(.periodic(from: date, by: 0.1)) { context in
                                let remain = max(0, Int(ceil(Double(camera.seconds) - context.date.timeIntervalSince(date))))
                                VStack {
                                    Text("\(remain)").font(.system(size: 72, weight: .bold, design: .rounded)).monospacedDigit()
                                    Text("촬영 중 · 휴대전화를 가만히 유지해 주세요").font(.headline)
                                }.foregroundStyle(.white).frame(maxWidth: .infinity, maxHeight: .infinity)
                            }
                        } else if camera.processing {
                            ProgressView("영상 길이와 장면 확인 중").tint(.white).foregroundStyle(.white).frame(maxWidth: .infinity, maxHeight: .infinity)
                        } else if !camera.ready { ProgressView().tint(.white).frame(maxHeight: .infinity) }
                    }.clipShape(RoundedRectangle(cornerRadius: 16))
                    if photosOnlyMode {
                        Text(location.status).font(.caption).foregroundStyle(.secondary)
                        Button("촬영 위치 확인 · 선택 사항") { location.start() }.font(.footnote).disabled(camera.capturing)
                    }
                    if !photosOnly {
                        Picker("연속 촬영 시간", selection: $seconds) {
                            Text("3초").tag(3); Text("5초 · 기본").tag(5)
                        }.pickerStyle(.segmented).disabled(camera.capturing)
                    }
                    if camera.capturing {
                        Button("촬영 취소", systemImage: "stop.fill") { camera.cancelCapture() }.buttonStyle(.bordered)
                    } else {
                        Button {
                            if photosOnly { camera.capture() } else { camera.record(seconds: seconds) }
                        } label: {
                            Label(photosOnly ? "사진 촬영" : "\(seconds)초 연속 촬영", systemImage: "camera.fill").font(.headline).frame(maxWidth: .infinity).padding(.vertical, 12)
                        }.buttonStyle(.borderedProminent).disabled(!camera.ready)
                    }
                    if !replacing && !photosOnlyMode {
                        Button(photosOnly ? "3~5초 연속 촬영으로 전환" : "일반 사진 촬영으로 전환") { photosOnly.toggle() }.font(.footnote).disabled(camera.capturing)
                    }
                    Text(photosOnlyMode ? "시제품 카메라 · 공식 안전신문고 촬영본이 아닙니다." : "기존 신고의 시간 간격 요건 충족은 별도 확인").font(.caption).foregroundStyle(.secondary)
                }
            }.padding(.horizontal, 16).padding(.bottom, 12)
            .navigationTitle(camera.clip == nil && camera.draft == nil ? "사진 촬영" : "촬영 확인")
            .navigationBarTitleDisplayMode(.inline)
            .sheet(isPresented: $officialGuidesOpen) { DedicatedGuidesScreen() }
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(replacing ? "취소 · 원본 유지" : "닫기") { dismiss() }.disabled(saving) } }
            .task { await camera.start() }
            .onDisappear { camera.close(); location.stop() }
            .onChange(of: camera.draft) { _, data in
                if data != nil { captureLocation = location.snapshot(at: camera.capturedAt); location.stop() }
                else { captureLocation = nil }
            }
            .onChange(of: scenePhase) { _, phase in
                if phase == .active { Task { await camera.start() } }
                else { camera.stop(); location.stop() }
            }
            .alert("촬영 안내", isPresented: Binding(get: { camera.error != nil }, set: { if !$0 { camera.error = nil } })) {
                Button("확인") { camera.error = nil }
            } message: { Text(camera.error ?? "") }
        }.tint(Color(red: 0.145, green: 0.431, blue: 0.957))
    }

    private func frame(_ data: Data, label: String, offset: Double) -> some View {
        VStack(alignment: .leading) {
            if let image = UIImage(data: data) { Image(uiImage: image).resizable().scaledToFit().frame(maxHeight: 160) }
            Text("\(label) · +\(offset, specifier: "%.2f")초").font(.caption).foregroundStyle(.secondary)
        }.frame(maxWidth: .infinity)
    }
}

struct ClipPlayer: View {
    let url: URL
    @State private var player: AVPlayer?
    var body: some View {
        VideoPlayer(player: player)
            .onAppear { player = AVPlayer(url: url) }
            .onDisappear { player?.pause(); player?.replaceCurrentItem(with: nil); player = nil }
    }
}

private struct CameraPreview: UIViewRepresentable {
    let session: AVCaptureSession
    func makeUIView(context: Context) -> PreviewView {
        let view = PreviewView()
        view.previewLayer.session = session
        view.previewLayer.videoGravity = .resizeAspect
        return view
    }
    func updateUIView(_ view: PreviewView, context: Context) {}
}

private final class PreviewView: UIView {
    override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
    var previewLayer: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }
    override func layoutSubviews() {
        super.layoutSubviews()
        if let connection = previewLayer.connection, connection.isVideoRotationAngleSupported(90) { connection.videoRotationAngle = 90 }
    }
}
