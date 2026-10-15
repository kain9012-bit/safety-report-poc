import SwiftUI

// Matches the existing safety-report-poc home and report shell.
enum ReportAppearance {
    static let blue = Color(red: 37 / 255, green: 110 / 255, blue: 244 / 255)
    static let blueLight = Color(red: 236 / 255, green: 242 / 255, blue: 254 / 255)
    static let ink = Color(red: 30 / 255, green: 33 / 255, blue: 36 / 255)
    static let muted = Color(red: 88 / 255, green: 97 / 255, blue: 106 / 255)
    static let border = Color(red: 226 / 255, green: 230 / 255, blue: 235 / 255)
    static let canvas = Color(red: 246 / 255, green: 248 / 255, blue: 251 / 255)
}

struct ReportPrototypeNotice: View {
    var body: some View {
        Text("개선 제안용 시제품 · 실제 신고 접수 없음")
            .font(.system(size: 13)).foregroundStyle(ReportAppearance.muted)
            .frame(maxWidth: .infinity).padding(.vertical, 8)
            .background(ReportAppearance.blueLight)
    }
}

struct ReportHomeHeader: View {
    var body: some View {
        VStack(spacing: 0) {
            Rectangle().fill(ReportAppearance.blue).frame(height: 4)
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("주정차 신고 도우미").font(.system(size: 22, weight: .bold))
                    Text("사진으로 시작하는 신고 준비").font(.system(size: 13)).foregroundStyle(ReportAppearance.muted)
                }
                Spacer(minLength: 8)
                Text("개선 시안").font(.system(size: 13)).padding(.horizontal, 8).padding(.vertical, 6)
                    .overlay(RoundedRectangle(cornerRadius: 4).stroke(ReportAppearance.border))
            }.padding(.horizontal, 20).padding(.vertical, 18)
            Divider()
        }.background(.white).foregroundStyle(ReportAppearance.ink)
    }
}

struct ReportCategoryStrip: View {
    var body: some View {
        HStack(spacing: 0) {
            ForEach(Array(["안전", "불법\n주정차", "자동차·\n교통위반", "생활\n불편"].enumerated()), id: \.offset) { index, label in
                VStack(spacing: 0) {
                    Text(label).font(.system(size: 13, weight: index == 1 ? .bold : .regular))
                        .multilineTextAlignment(.center).frame(maxWidth: .infinity).frame(minHeight: 53)
                    Rectangle().fill(index == 1 ? ReportAppearance.blue : .clear).frame(height: 3)
                }.foregroundStyle(index == 1 ? ReportAppearance.blue : ReportAppearance.muted)
                    .background(index == 1 ? ReportAppearance.blueLight : .white)
            }
        }.overlay(alignment: .bottom) { ReportAppearance.border.frame(height: 1) }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("신고 분야 참고: 안전, 불법 주정차, 자동차·교통위반, 생활 불편. 현재 불법 주정차.")
    }
}

struct ReportStepStrip: View {
    let labels: [String]
    let current: Int
    var disabled = false
    var onSelect: ((Int) -> Void)?
    var body: some View {
        HStack(spacing: 8) {
            ForEach(Array(labels.enumerated()), id: \.offset) { index, label in
                Button { onSelect?(index) } label: {
                    HStack(spacing: 5) {
                        Text("\(index + 1)").font(.system(size: 11, weight: .bold))
                            .frame(width: 21, height: 21)
                            .background(index == current ? ReportAppearance.blue : ReportAppearance.canvas, in: Circle())
                            .foregroundStyle(index == current ? .white : ReportAppearance.muted)
                        Text(label).font(.system(size: 12, weight: index == current ? .bold : .regular))
                            .multilineTextAlignment(.leading).fixedSize(horizontal: false, vertical: true)
                    }.frame(maxWidth: .infinity).frame(minHeight: 44)
                        .foregroundStyle(index == current ? ReportAppearance.blue : ReportAppearance.muted)
                }.buttonStyle(.plain).disabled(disabled || onSelect == nil)
                    .accessibilityAddTraits(index == current ? .isSelected : [])
            }
        }.padding(.horizontal, 16).padding(.vertical, 5).background(.white)
            .overlay(alignment: .bottom) { ReportAppearance.border.frame(height: 1) }
    }
}

struct ReportPageHeader: View {
    let title: String
    var status: String? = nil
    var disabled = false
    let onBack: () -> Void
    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Button(action: onBack) { Image(systemName: "arrow.left").frame(width: 44, height: 44) }
                    .buttonStyle(.plain).accessibilityLabel("저장하고 닫기").disabled(disabled)
                Text(title).font(.system(size: 17, weight: .bold)).fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 4)
                Text("초안").font(.system(size: 12)).padding(.horizontal, 8).padding(.vertical, 4)
                    .overlay(Capsule().stroke(ReportAppearance.border))
            }.padding(.leading, 4).padding(.trailing, 16).padding(.vertical, 4)
            if let status { Text(status).font(.system(size: 12)).foregroundStyle(ReportAppearance.muted).frame(maxWidth: .infinity, alignment: .trailing).padding(.horizontal, 16).padding(.bottom, 6) }
            Divider()
        }.background(.white).foregroundStyle(ReportAppearance.ink)
    }
}

struct ReportIntro: View {
    let step: Int
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("충전·전용구역 확인").font(.system(size: 12, weight: .bold)).foregroundStyle(ReportAppearance.blue)
            Text(["촬영 전에,\n신고 경로부터 확인해요", "주차면의 표시와\n필요한 사진을 확인해요", "확인한 내용을 모아\n남은 항목을 살펴봐요"][step])
                .font(.system(size: 25, weight: .bold)).fixedSize(horizontal: false, vertical: true)
            Text("표시를 확인하고, 필요한 자료를 함께 준비해요.").font(.system(size: 14)).foregroundStyle(ReportAppearance.muted)
        }.frame(maxWidth: .infinity, alignment: .leading).padding(.bottom, 6)
    }
}

struct ReportButtonStyle: ButtonStyle {
    var primary = false
    func makeBody(configuration: Configuration) -> some View { StyledLabel(configuration: configuration, primary: primary) }

    /// 누를 수 없는 버튼은 흐리게 — 카메라 준비 전 셔터·빨간불이 남은 제출 버튼이 눌리는 것처럼 보이지 않게
    private struct StyledLabel: View {
        let configuration: ButtonStyleConfiguration
        let primary: Bool
        @Environment(\.isEnabled) private var enabled
        var body: some View {
            configuration.label.font(.system(size: 15, weight: .semibold)).padding(.horizontal, 14)
                .frame(minHeight: 50).foregroundStyle(primary ? .white : ReportAppearance.ink)
                .background(primary ? ReportAppearance.blue : .white, in: RoundedRectangle(cornerRadius: 9))
                .overlay(RoundedRectangle(cornerRadius: 9).stroke(primary ? .clear : ReportAppearance.border))
                .opacity(configuration.isPressed ? 0.75 : enabled ? 1 : 0.45)
        }
    }
}
