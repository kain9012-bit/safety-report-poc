// 2026-10-15 결정: 홈의 기존 3~5초 영상·단일 사진 촬영 진입은 화면에서 빼고 코드만 남긴다.
// 이전 홈(ContentView)을 그대로 옮긴 것이다. 지금은 어디에서도 열지 않는다. 기존 촬영본 파일은 기기에 그대로 있다.
import SwiftUI

struct LegacyMediaHome: View {
    @StateObject private var store = PhotoStore()
    @StateObject private var zoneStore = ZoneStore()
    @State private var newDraft: ZoneCase?
    @State private var cameraOpen = false
    @State private var replacingID: UUID?
    @State private var deleteTarget: TrialPhoto?
    @State private var officialGuidesOpen = false
    @State private var zoneOpen = false
    private let accent = ReportAppearance.blue

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                ReportPrototypeNotice()
                ReportHomeHeader()
                ReportCategoryStrip()
                ScrollView {
                    VStack(alignment: .leading, spacing: 24) {
                        VStack(spacing: 12) {
                            ReportStepStrip(labels: ["사진 촬영", "촬영본 확인", "기기에 보관"], current: 0)
                            Button { startPhotos() } label: {
                                HStack(spacing: 16) {
                                    Image(systemName: "camera").font(.system(size: 31, weight: .medium))
                                        .frame(width: 64, height: 64).background(.white.opacity(0.2), in: Circle())
                                    VStack(alignment: .leading, spacing: 5) {
                                        Text("사진부터 찍기").font(.system(size: 24, weight: .bold))
                                        Text("차량과 주변이 함께 보이게 찍어 주세요").font(.system(size: 15)).fixedSize(horizontal: false, vertical: true)
                                    }
                                    Spacer(minLength: 0)
                                }.padding(.horizontal, 20).padding(.vertical, 24).frame(maxWidth: .infinity, alignment: .leading)
                                    .foregroundStyle(.white).background(accent, in: RoundedRectangle(cornerRadius: 16))
                            }.buttonStyle(.plain)
                            Text("사진을 찍고, 유형과 내용을 확인한 뒤 보관하세요.")
                                .font(.system(size: 13)).foregroundStyle(ReportAppearance.muted).frame(maxWidth: .infinity, alignment: .leading)
                        }
                        Button { zoneOpen = true } label: {
                            HStack(alignment: .center, spacing: 12) {
                                Image(systemName: "checklist").font(.system(size: 22)).foregroundStyle(accent)
                                VStack(alignment: .leading, spacing: 5) {
                                    Text("보관한 초안 이어하기").font(.system(size: 17, weight: .bold))
                                    Text("촬영한 사진과 작성한 내용을 이어서 확인해요").font(.system(size: 13)).foregroundStyle(ReportAppearance.muted)
                                }
                                Spacer(minLength: 4)
                                Image(systemName: "chevron.right").font(.system(size: 14)).foregroundStyle(ReportAppearance.muted)
                            }.padding(16).frame(maxWidth: .infinity, alignment: .leading)
                                .background(.white, in: RoundedRectangle(cornerRadius: 8))
                                .overlay(RoundedRectangle(cornerRadius: 8).stroke(ReportAppearance.border))
                        }.buttonStyle(.plain)
                        Button("기존 3~5초 영상·단일 사진 촬영") { replacingID = nil; cameraOpen = true }.buttonStyle(.bordered)
                        Text("시제품 촬영·앨범 사진은 공식 안전신문고 촬영본으로 확인되지 않습니다. 실제 신고용 촬영은 공식 앱에서 먼저 확인해 주세요.")
                            .font(.system(size: 13)).foregroundStyle(ReportAppearance.muted)
                    HStack {
                        Text("보관한 촬영본").font(.system(size: 17, weight: .bold))
                        Spacer()
                        Text("\(store.photos.count)건").foregroundStyle(.secondary)
                    }
                    if store.photos.isEmpty {
                        Text("아직 촬영본이 없어요. 촬영 후 저장하면 여기에 보관돼요.").font(.system(size: 14)).foregroundStyle(ReportAppearance.muted)
                    }
                    ForEach(Array(store.photos.enumerated()), id: \.element.id) { index, photo in
                        VStack(alignment: .leading, spacing: 10) {
                            if let url = store.videoURL(for: photo) {
                                ClipPlayer(url: url).id(url).frame(height: 240).clipShape(RoundedRectangle(cornerRadius: 12))
                                HStack(alignment: .top) {
                                    if let image = store.image(for: photo) { storedFrame(image, label: "시작 장면") }
                                    if let image = store.lastImage(for: photo) { storedFrame(image, label: "끝 장면") }
                                }
                                Text("한 연속 영상 · \(photo.duration ?? 0, specifier: "%.2f")초 · 음성 없음").font(.subheadline.bold())
                                Text("계속 정차와 기존 신고 시간 간격 요건은 자동 판정하지 않습니다.").font(.caption).foregroundStyle(.secondary)
                                HStack {
                                    Button("영상 재촬영") { replacingID = photo.id; cameraOpen = true }.buttonStyle(.bordered)
                                    ShareLink(item: url) { Label("원본 공유", systemImage: "square.and.arrow.up") }.buttonStyle(.bordered)
                                }
                            } else if photo.isVideo {
                                Label("영상 원본을 읽을 수 없어요", systemImage: "exclamationmark.triangle")
                            } else if let image = store.image(for: photo) {
                                Image(uiImage: image).resizable().scaledToFit().frame(maxHeight: 340).frame(maxWidth: .infinity)
                                    .background(.black.opacity(0.04)).clipShape(RoundedRectangle(cornerRadius: 16))
                            } else {
                                Label("사진 파일을 읽을 수 없어요", systemImage: "exclamationmark.triangle")
                            }
                            Text("\(photo.isVideo ? "연속 촬영" : "사진") \(index + 1)").font(.headline)
                            Text(photo.capturedAt.formatted(date: .abbreviated, time: .standard)).font(.footnote)
                            if index > 0 && !photo.isVideo && !store.photos[index - 1].isVideo {
                                let seconds = Int(photo.capturedAt.timeIntervalSince(store.photos[index - 1].capturedAt))
                                Text("앞 사진과 \(seconds)초 차이 · 접수 기준 적합 여부는 미판정").font(.caption).foregroundStyle(.secondary)
                            }
                            Label("자동인식 모델 미연결", systemImage: "hourglass").font(.subheadline).foregroundStyle(accent)
                            Button(photo.isVideo ? "영상·장면 삭제" : "사진 삭제", role: .destructive) { deleteTarget = photo }.font(.subheadline)
                        }.padding(16).background(.white, in: RoundedRectangle(cornerRadius: 14)).overlay(RoundedRectangle(cornerRadius: 14).stroke(ReportAppearance.border))
                    }
                    Button { officialGuidesOpen = true } label: {
                        VStack(alignment: .leading, spacing: 5) {
                            Text("전용구역 3종 공식 안내").font(.system(size: 17, weight: .bold))
                            Text("장애인 · 소방차 · 친환경차 충전구역").font(.system(size: 13)).foregroundStyle(ReportAppearance.muted)
                        }.frame(maxWidth: .infinity, alignment: .leading).padding(16)
                            .background(ReportAppearance.blueLight, in: RoundedRectangle(cornerRadius: 8))
                    }.buttonStyle(.plain).foregroundStyle(accent)
                    Text("촬영본은 기기에 보관됩니다. 사진 근거 확인 화면에서 위치 기록과 AI 전송을 선택할 수 있습니다. 실제 신고 제출은 하지 않습니다.")
                        .font(.footnote).foregroundStyle(.secondary)
                    }.padding(.horizontal, 16).padding(.top, 6).padding(.bottom, 24)
                }.background(.white)
            }
            .background(.white)
            .toolbar(.hidden, for: .navigationBar)
            .sheet(isPresented: $officialGuidesOpen) { DedicatedGuidesScreen() }
            .fullScreenCover(isPresented: $zoneOpen) { ZoneLibrary(store: zoneStore) }
            .fullScreenCover(item: $newDraft) { value in ZoneWorkspace(initial: value, store: zoneStore, startWithCapture: true) }
            .fullScreenCover(isPresented: $cameraOpen, onDismiss: { replacingID = nil }) {
                CaptureScreen(replacing: replacingID != nil,
                              onUse: { data, date in try store.save(data: data, capturedAt: date) },
                              onUseClip: { clip in try store.save(clip: clip, replacing: replacingID) })
            }
            .confirmationDialog("촬영본을 삭제할까요?", isPresented: Binding(get: { deleteTarget != nil }, set: { if !$0 { deleteTarget = nil } }), titleVisibility: .visible) {
                Button("촬영본 전체 삭제", role: .destructive) {
                    if let target = deleteTarget {
                        do { try store.delete(target) }
                        catch { store.error = "삭제하지 못했어요. 기존 촬영본을 유지합니다. \(error.localizedDescription)" }
                    }
                    deleteTarget = nil
                }
            } message: { Text("원본 영상과 추출 장면을 함께 삭제합니다.") }
            .alert("사진 보관함 확인", isPresented: Binding(get: { store.error != nil }, set: { if !$0 { store.error = nil } })) {
                Button("확인") { store.error = nil }
            } message: { Text(store.error ?? "") }
        }.tint(accent).preferredColorScheme(.light)
    }
    private func startPhotos() {
        var value = ZoneCase(); value.version = 2; value.evidenceReview = EvidenceReview()
        do { try zoneStore.save(value); newDraft = value }
        catch { store.error = "촬영 초안을 만들지 못했어요. 기존 자료는 그대로 있습니다. 다시 시도해 주세요." }
    }
    private func storedFrame(_ image: UIImage, label: String) -> some View {
        VStack(alignment: .leading) {
            Image(uiImage: image).resizable().scaledToFit().frame(maxHeight: 130)
            Text(label).font(.caption).foregroundStyle(.secondary)
        }.frame(maxWidth: .infinity)
    }
}
