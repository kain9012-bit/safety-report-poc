import AVFoundation
import Foundation
import UIKit

struct CapturedClip: Sendable {
    let url: URL
    let startedAt: Date
    let requestedSeconds: Int
    let duration: Double
    let firstImage: Data
    let lastImage: Data
    let firstOffset: Double
    let lastOffset: Double
    let width: Int
    let height: Int
}

enum ShortClip {
    static func prepare(url: URL, startedAt: Date, seconds: Int) async throws -> CapturedClip {
        let asset = AVURLAsset(url: url)
        let duration = try await asset.load(.duration).seconds
        guard [3, 5].contains(seconds), duration.isFinite,
              duration >= Double(seconds) - 0.2, duration <= Double(seconds) + 2 else {
            throw ClipError.invalidDuration
        }
        try Task.checkCancellation()
        let generator = AVAssetImageGenerator(asset: asset)
        generator.appliesPreferredTrackTransform = true
        generator.requestedTimeToleranceBefore = .zero
        generator.requestedTimeToleranceAfter = .zero
        let first = try await generator.image(at: .zero)
        let last = try await generator.image(at: CMTime(seconds: max(0, duration - 0.08), preferredTimescale: 600))
        try Task.checkCancellation()
        guard let firstData = UIImage(cgImage: first.image).jpegData(compressionQuality: 0.92),
              let lastData = UIImage(cgImage: last.image).jpegData(compressionQuality: 0.92) else {
            throw ClipError.invalidFrames
        }
        return CapturedClip(url: url, startedAt: startedAt, requestedSeconds: seconds, duration: duration,
                            firstImage: firstData, lastImage: lastData,
                            firstOffset: first.actualTime.seconds, lastOffset: last.actualTime.seconds,
                            width: first.image.width, height: first.image.height)
    }
    enum ClipError: LocalizedError {
        case invalidDuration, invalidFrames
        var errorDescription: String? {
            switch self {
            case .invalidDuration: "녹화 길이가 선택한 시간과 다르거나 촬영이 중단됐어요. 다시 촬영해 주세요."
            case .invalidFrames: "영상의 시작·끝 장면을 읽지 못했어요. 다시 촬영해 주세요."
            }
        }
    }
}
