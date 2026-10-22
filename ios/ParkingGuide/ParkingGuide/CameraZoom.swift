import CoreGraphics
import Foundation

/// 촬영 배율 — 손가락으로 벌리거나 1·2·3배 단추로 사진 부분만 키운다(웹 src/lib/zoom.ts 와 같은 단추·한도·안내).
/// 후면 광각 카메라의 videoZoomFactor 를 쓴다(1 = 기본 화각). 많이 키우면 위반 장소를 놓치기 쉬워 2배부터 한 줄 알린다.
enum CameraZoom {
    static let steps: [CGFloat] = [1, 2, 3]
    static let maximum: CGFloat = 3
    static let wideNote = "확대하면 위반 장소가 화면 밖으로 나가기 쉬워요. 차·번호판·위반 장소가 함께 나오는지 확인해 주세요"

    /// 1배~최대 배율, 0.1 단위
    static func clamp(_ zoom: CGFloat, maximum: CGFloat = maximum) -> CGFloat {
        guard zoom.isFinite else { return 1 }
        return min(maximum, max(1, (zoom * 10).rounded() / 10))
    }
    /// '2배', '1.6배'
    static func label(_ zoom: CGFloat) -> String {
        zoom == zoom.rounded() ? "\(Int(zoom))배" : String(format: "%.1f배", Double(zoom))
    }
}
