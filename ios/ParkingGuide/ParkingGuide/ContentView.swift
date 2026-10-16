import SwiftUI
import PhotosUI
import ImageIO

/// 처음 화면 — 웹 main 시작 화면과 같은 구성: 사진부터 찍기 · 앨범에서 2장 고르기 · 이어할 신고 · 제출한 신고.
/// 이전 홈의 영상 촬영·촬영본 목록은 LegacyMediaHome 에 코드만 남겼다.
struct ContentView: View {
    @StateObject private var zoneStore = ZoneStore()
    @State private var opened: ZoneCase?
    @State private var deleting: ZoneCase?
    @State private var albumItems: [PhotosPickerItem] = []
    @State private var albumBusy = false
    @State private var albumError: String?
    /// 앨범에서 1장만 골랐으면 신고서를 열자마자 1장 더 넣기를 묻는다
    @State private var askMore = false
    @State private var toast: String?
    @State private var resumed = false
    @State private var settingsOpen = false
    private let accent = ReportAppearance.blue

    private var inProgress: [ZoneCase] { zoneStore.cases.filter { $0.submittedAt == nil && !$0.evidence.isEmpty } }
    private var submitted: [ZoneCase] { zoneStore.cases.filter { $0.submittedAt != nil } }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                ReportPrototypeNotice()
                ReportHomeHeader()
                ReportCategoryStrip()
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        Button { startNew() } label: {
                            HStack(spacing: 16) {
                                Image(systemName: "camera").font(.system(size: 31, weight: .medium))
                                    .frame(width: 64, height: 64).background(.white.opacity(0.2), in: Circle())
                                VStack(alignment: .leading, spacing: 5) {
                                    Text("사진부터 찍기").font(.system(size: 24, weight: .bold))
                                    Text("찍은 뒤 유형·발생지역·내용을 확인합니다").font(.system(size: 15)).fixedSize(horizontal: false, vertical: true)
                                }
                                Spacer(minLength: 0)
                            }.padding(.horizontal, 20).padding(.vertical, 24).frame(maxWidth: .infinity, alignment: .leading)
                                .foregroundStyle(.white).background(accent, in: RoundedRectangle(cornerRadius: 16))
                        }.buttonStyle(.plain).disabled(albumBusy)
                        PhotosPicker(selection: $albumItems, maxSelectionCount: 2, matching: .images) {
                            Label(albumBusy ? "앨범 사진 읽는 중…" : "앨범에서 2장 고르기", systemImage: "photo").font(.system(size: 17, weight: .bold))
                                .frame(maxWidth: .infinity).frame(minHeight: 50)
                                .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color(white: 0.75), lineWidth: 2))
                        }.foregroundStyle(ReportAppearance.ink).disabled(albumBusy)
                        if let albumError { Text(albumError).font(.system(size: 14)).foregroundStyle(.red) }

                        section("이어할 신고", inProgress.count)
                        if inProgress.isEmpty {
                            Text("하던 신고가 없습니다. 앱을 바꾸거나 꺼도 하던 신고는 여기 남습니다.").font(.system(size: 14)).foregroundStyle(ReportAppearance.muted)
                        }
                        ForEach(inProgress) { item in row(item, action: "이어하기") }

                        if !submitted.isEmpty {
                            section("제출한 신고", submitted.count)
                            ForEach(submitted) { item in row(item, action: "열기") }
                        }
                        Button("사진 판독 설정") { settingsOpen = true }.font(.system(size: 14)).foregroundStyle(accent).frame(minHeight: 44)
                    }.padding(.horizontal, 16).padding(.top, 16).padding(.bottom, 24)
                }.background(.white)
            }
            .background(.white)
            .toolbar(.hidden, for: .navigationBar)
            .overlay(alignment: .bottom) {
                if let toast {
                    Text(toast).font(.system(size: 15, weight: .bold)).multilineTextAlignment(.center).foregroundStyle(.white)
                        .padding(12).frame(maxWidth: .infinity).background(Color.black.opacity(0.85), in: RoundedRectangle(cornerRadius: 10))
                        .padding(.horizontal, 24).padding(.bottom, 32).transition(.opacity)
                }
            }
            .fullScreenCover(item: $opened, onDismiss: { askMore = false; dropEmptyDrafts() }) { value in
                ReportFlowScreen(initial: value, store: zoneStore, askMore: askMore) { show("개선 제안용 화면이라 접수되지 않습니다\n제출한 신고에 저장했습니다") }
            }
            .sheet(isPresented: $settingsOpen) { VisionSettingsSheet() }
            .onChange(of: albumItems) { _, items in if !items.isEmpty { Task { await importAlbum(items) } } }
            .task {
                // 앱을 열면 — 하던 신고가 있으면 바로 그 자리로(웹 main 과 같다)
                guard !resumed else { return }
                resumed = true
                if let recent = inProgress.first(where: { Date().timeIntervalSince($0.createdAt) <= ReportRules.resumeWindow }) { opened = recent }
            }
            .confirmationDialog("이 신고와 사진을 지울까요?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible) {
                Button("지우기", role: .destructive) {
                    if let deleting { do { try zoneStore.delete(deleting) } catch { zoneStore.error = "지우지 못했습니다. 기존 자료를 유지했습니다." } }
                    deleting = nil
                }
            }
            .alert("보관함 확인", isPresented: Binding(get: { zoneStore.error != nil }, set: { if !$0 { zoneStore.error = nil } })) {
                Button("확인") { zoneStore.error = nil }
            } message: { Text(zoneStore.error ?? "") }
        }.tint(accent).preferredColorScheme(.light)
    }

    private func section(_ title: String, _ count: Int) -> some View {
        HStack(spacing: 6) {
            Text(title).font(.system(size: 17, weight: .bold))
            Text("\(count)").font(.system(size: 17, weight: .bold)).foregroundStyle(accent)
        }.padding(.top, 12)
    }

    private func row(_ item: ZoneCase, action: String) -> some View {
        HStack(spacing: 12) {
            Group {
                if let photo = item.primaryPair.first ?? item.evidence.first, let image = zoneStore.image(photo) {
                    Image(uiImage: image).resizable().scaledToFill()
                } else { Color(white: 0.92) }
            }.frame(width: 64, height: 64).clipShape(RoundedRectangle(cornerRadius: 8))
            VStack(alignment: .leading, spacing: 3) {
                Text(item.reportType?.reportLabel ?? "유형 미정").font(.system(size: 15, weight: .bold))
                Text(item.address.isEmpty ? "주소 미입력" : item.address).font(.system(size: 13)).foregroundStyle(ReportAppearance.muted).lineLimit(1)
                Text(ReportRules.stamp(item.submittedAt ?? item.updatedAt)).font(.system(size: 12)).foregroundStyle(ReportAppearance.muted)
            }
            Spacer(minLength: 4)
            VStack(spacing: 4) {
                Button(action) { opened = item }.font(.system(size: 14, weight: .bold)).frame(minHeight: 36)
                Button("지우기", role: .destructive) { deleting = item }.font(.system(size: 13)).frame(minHeight: 32)
            }
        }.padding(10).overlay(RoundedRectangle(cornerRadius: 10).stroke(ReportAppearance.border))
    }

    private func startNew() {
        var value = ZoneCase(); value.version = 2; value.evidenceReview = EvidenceReview()
        do { try zoneStore.save(value); opened = value }
        catch { zoneStore.error = "새 신고를 만들지 못했습니다. 기존 자료는 그대로 있습니다. 다시 시도해 주세요." }
    }

    /// 사진 없이 닫은 새 신고는 남기지 않는다
    private func dropEmptyDrafts() {
        for item in zoneStore.cases where item.evidence.isEmpty && item.submittedAt == nil { try? zoneStore.delete(item) }
    }

    private func show(_ text: String) {
        withAnimation { toast = text }
        Task { try? await Task.sleep(for: .seconds(4)); withAnimation { toast = nil } }
    }

    /// 앨범 두 장 → 촬영시각 순으로 기본 사진 1·2. 촬영시각 기록이 없으면 시각을 지어내지 않는다.
    private func importAlbum(_ items: [PhotosPickerItem]) async {
        albumBusy = true; albumError = nil
        defer { albumBusy = false; albumItems = [] }
        // 앨범 선택 창이 닫히는 중에 신고서를 띄우면 화면 위쪽 여백(상태 표시줄)을 잃어 뒤로 단추가 상태 표시줄 밑에 깔린다.
        // 선택 창이 다 닫힌 뒤에 연다(시뮬레이터에서 확인, 2026-10-16).
        let closing = Task { try? await Task.sleep(for: .milliseconds(700)) }
        do {
            var photos: [(data: Data, meta: AlbumPhotoMeta)] = []
            for item in items.prefix(2) {
                guard let data = try await item.loadTransferable(type: Data.self), data.count <= 25 * 1024 * 1024, UIImage(data: data) != nil else { throw CocoaError(.fileReadCorruptFile) }
                photos.append((data, AlbumPhotoMeta(data)))
            }
            photos.sort { ($0.meta.takenAt ?? .distantFuture) < ($1.meta.takenAt ?? .distantFuture) }
            var draft = ZoneCase(); draft.version = 2; draft.evidenceReview = EvidenceReview()
            try zoneStore.save(draft)
            for (index, photo) in photos.enumerated() {
                draft = try zoneStore.add(data: photo.data, source: .album, role: .incident, date: photo.meta.takenAt, to: draft, slot: index == 0 ? .first : .second, location: photo.meta.location)
            }
            // 앨범은 촬영 화면을 거치지 않고 신고서로 연다(웹과 같다). 1장이면 1장 더 넣기를 묻는다.
            draft.formOpened = true
            try zoneStore.save(draft)
            askMore = photos.count < 2
            await closing.value
            opened = draft
        } catch {
            albumError = "앨범 사진을 읽지 못했습니다. 다른 사진을 골라 주세요."
        }
    }
}

/// 앨범 사진 파일에 남은 촬영시각·위치(EXIF). 기록이 없으면 nil 로 둔다.
struct AlbumPhotoMeta {
    var takenAt: Date?
    var location: LocationRecord?
    init(_ data: Data) {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
              let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any] else { return }
        if let exif = props[kCGImagePropertyExifDictionary] as? [CFString: Any], let raw = exif[kCGImagePropertyExifDateTimeOriginal] as? String {
            let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.dateFormat = "yyyy:MM:dd HH:mm:ss"
            // 시간대 기록이 없으면 한국 시각으로 읽는다(웹 앨범 읽기와 같다)
            f.timeZone = (exif[kCGImagePropertyExifOffsetTimeOriginal] as? String).flatMap(Self.zone) ?? TimeZone(identifier: "Asia/Seoul")
            takenAt = f.date(from: raw)
        }
        if let gps = props[kCGImagePropertyGPSDictionary] as? [CFString: Any],
           let lat = gps[kCGImagePropertyGPSLatitude] as? Double, let lng = gps[kCGImagePropertyGPSLongitude] as? Double {
            let latitude = (gps[kCGImagePropertyGPSLatitudeRef] as? String) == "S" ? -lat : lat
            let longitude = (gps[kCGImagePropertyGPSLongitudeRef] as? String) == "W" ? -lng : lng
            let error = gps[kCGImagePropertyGPSHPositioningError] as? Double
            location = LocationRecord(latitude: latitude, longitude: longitude, accuracy: error ?? -1, measuredAt: takenAt ?? Date(), sampleCount: 1, spread: 0,
                                      quality: error == nil ? "앨범 사진 위치 · 정확도 기록 없음" : "앨범 사진 위치", source: "album_exif")
        }
    }
    private static func zone(_ offset: String) -> TimeZone? {
        let parts = offset.split(separator: ":"); guard parts.count == 2, let h = Int(parts[0]), let m = Int(parts[1]) else { return nil }
        return TimeZone(secondsFromGMT: h * 3600 + (h < 0 ? -m : m) * 60)
    }
}
