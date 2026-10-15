import SwiftUI

struct DedicatedGuideData: Decodable {
    struct Source: Decodable {
        let publisher: String
        let title: String
        let dateLabel: String
        let scope: String
        let url: URL
        let summary: [String]
    }
    let label: String
    let lookFor: String
    let photos: [String]
    let confirm: [String]
    let caution: String
    let checkedAt: String
    let source: Source
}

enum DedicatedGuideCatalog {
    static let order = ["disabled", "fire_access", "ev_charging"]
    // The web's canonical JSON is copied by scripts/sync-dedicated-guides.cjs.
    static let guides: [String: DedicatedGuideData] = {
        guard let url = Bundle.main.url(forResource: "dedicatedGuides", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let result = try? JSONDecoder().decode([String: DedicatedGuideData].self, from: data)
        else { return [:] }
        return result
    }()
}

struct DedicatedGuidesScreen: View {
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text("사진이 없어도 확인할 수 있습니다. 안내를 열어도 촬영본은 바뀌지 않습니다.")
                        .font(.subheadline).foregroundStyle(.secondary)
                    ForEach(DedicatedGuideCatalog.order, id: \.self) { zone in
                        if let guide = DedicatedGuideCatalog.guides[zone] {
                            NavigationLink { DedicatedGuideDetail(guide: guide) } label: {
                                Label(guide.label + " 공식 안내", systemImage: "book.closed")
                            }.accessibilityIdentifier("official-guide-" + zone)
                        }
                    }
                    if DedicatedGuideCatalog.guides.isEmpty {
                        Text("안내 자료를 읽지 못했습니다. 안전신문고 앱이나 관할 기관에서 해당 유형의 공식 안내를 확인해 주세요.")
                    }
                }
                Section {
                    Text("전용구역 유형의 자동 입력과 위반·접수 요건 판정은 지원하지 않습니다. 지역 자료를 전국 공통 접수 기준으로 적용하지 않습니다.")
                    Text("iPhone 앱은 자동인식 모델 미연결 상태입니다. 확인하려는 유형을 직접 열어 주세요.")
                }.font(.footnote).foregroundStyle(.secondary)
            }
            .navigationTitle("전용구역 3종 공식 안내").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("닫기") { dismiss() } } }
        }
    }
}

private struct DedicatedGuideDetail: View {
    let guide: DedicatedGuideData
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                VStack(alignment: .leading, spacing: 12) {
                    Label("공식 자료 요약", systemImage: "book.closed").font(.headline)
                    Text("아래 발행기관의 자료를 이 앱에서 요약했습니다.").font(.caption)
                    bullets(guide.source.summary)
                    Divider()
                    VStack(alignment: .leading, spacing: 5) {
                        Text(guide.source.publisher).bold()
                        Text(guide.source.title)
                        Text("\(guide.source.dateLabel) · 원문 확인 \(guide.checkedAt)")
                        Text(guide.source.scope)
                    }.font(.caption)
                    Link(destination: guide.source.url) {
                        Label("공식 안내 원문 보기", systemImage: "arrow.up.right.square")
                            .frame(maxWidth: .infinity).padding(.vertical, 6)
                    }.buttonStyle(.borderedProminent)
                        .accessibilityHint("외부 브라우저로 공식 자료를 엽니다. 촬영본은 전송하지 않습니다.")
                }.padding().background(Color.blue.opacity(0.07), in: RoundedRectangle(cornerRadius: 16))
                VStack(alignment: .leading, spacing: 12) {
                    Text("사진 보완 방법 · 앱 촬영 도움말").font(.headline)
                    Text(guide.lookFor)
                    bullets(guide.photos)
                    Text(guide.caution).padding().background(Color(uiColor: .secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12))
                }
                VStack(alignment: .leading, spacing: 12) {
                    Text("신고 전 확인할 사항").font(.headline)
                    bullets(guide.confirm)
                    Text("안전신문고 앱에서 해당 신고 항목을 선택한 뒤, 신고 지역의 촬영 간격·장수·기한을 확인하세요. 이 앱의 촬영본이 접수 요건을 충족하는지는 별도 확인이 필요합니다.")
                }
                DisclosureGroup("공식 원문이 열리지 않나요?") {
                    Text("위 발행기관 홈페이지에서 자료 제목을 검색하거나 관할 기관에 문의하세요. 원문을 열어도 촬영본이 전송되지는 않습니다.").padding(.top, 8)
                }.font(.footnote)
            }.padding(20)
        }.navigationTitle(guide.label).navigationBarTitleDisplayMode(.inline)
    }
    private func bullets(_ items: [String]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(items, id: \.self) { item in
                HStack(alignment: .top, spacing: 8) {
                    Text("•").accessibilityHidden(true)
                    Text(item).fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }
}
