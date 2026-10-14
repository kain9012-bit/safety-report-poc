import Foundation
import UIKit
import Combine

struct TrialPhoto: Codable, Identifiable {
    let id: UUID
    let capturedAt: Date
    let filename: String
    var videoFilename: String?
    var lastFrameFilename: String?
    var duration: Double?
    var requestedSeconds: Int?
    var firstOffset: Double?
    var lastOffset: Double?
    var width: Int?
    var height: Int?
    var isVideo: Bool { videoFilename != nil }
}

@MainActor final class PhotoStore: ObservableObject {
    @Published private(set) var photos: [TrialPhoto] = []
    @Published var error: String?
    private let folder: URL
    private var storageReady = false
    private let indexWriter: (Data, URL) throws -> Void

    init(folder: URL? = nil, indexWriter: @escaping (Data, URL) throws -> Void = { data, url in
        try data.write(to: url, options: [.atomic, .completeFileProtection])
    }) {
        self.indexWriter = indexWriter
        self.folder = folder ?? URL.applicationSupportDirectory.appendingPathComponent("TrialPhotos", isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: self.folder, withIntermediateDirectories: true)
            var localFolder = self.folder
            var values = URLResourceValues()
            values.isExcludedFromBackup = true
            try localFolder.setResourceValues(values)
            let index = self.folder.appendingPathComponent("index.json")
            if FileManager.default.fileExists(atPath: index.path) {
                photos = try JSONDecoder().decode([TrialPhoto].self, from: Data(contentsOf: index))
            }
            storageReady = true
        } catch { self.error = "사진 보관함을 읽지 못했어요. \(error.localizedDescription)" }
    }

    func save(clip: CapturedClip, replacing id: UUID? = nil) throws {
        guard storageReady else { throw CocoaError(.fileReadCorruptFile) }
        let old = id.flatMap { target in photos.first { $0.id == target } }
        if id != nil && old == nil { throw CocoaError(.fileNoSuchFile) }
        let token = UUID()
        var record = TrialPhoto(id: id ?? UUID(), capturedAt: clip.startedAt, filename: "\(token)-first.jpg")
        record.videoFilename = "\(token).mov"; record.lastFrameFilename = "\(token)-last.jpg"
        record.duration = clip.duration; record.requestedSeconds = clip.requestedSeconds
        record.firstOffset = clip.firstOffset; record.lastOffset = clip.lastOffset
        record.width = clip.width; record.height = clip.height
        let movieURL = folder.appendingPathComponent(record.videoFilename!)
        do {
            try FileManager.default.copyItem(at: clip.url, to: movieURL)
            try FileManager.default.setAttributes([.protectionKey: FileProtectionType.complete], ofItemAtPath: movieURL.path)
            try clip.firstImage.write(to: folder.appendingPathComponent(record.filename), options: [.atomic, .completeFileProtection])
            try clip.lastImage.write(to: folder.appendingPathComponent(record.lastFrameFilename!), options: [.atomic, .completeFileProtection])
            var updated = photos
            if let index = updated.firstIndex(where: { $0.id == id }) { updated[index] = record }
            else { updated.append(record) }
            try writeIndex(updated)
            photos = updated
            if let old { removeFiles(old) }
        } catch {
            removeFiles(record)
            throw error
        }
    }

    func delete(_ photo: TrialPhoto) throws {
        guard storageReady, photos.contains(where: { $0.id == photo.id }) else { throw CocoaError(.fileNoSuchFile) }
        let updated = photos.filter { $0.id != photo.id }
        try writeIndex(updated)
        photos = updated
        removeFiles(photo)
    }
    private func writeIndex(_ records: [TrialPhoto]) throws {
        try indexWriter(JSONEncoder().encode(records), folder.appendingPathComponent("index.json"))
    }
    private func removeFiles(_ photo: TrialPhoto) {
        for name in [photo.filename, photo.videoFilename, photo.lastFrameFilename].compactMap({ $0 }) {
            try? FileManager.default.removeItem(at: folder.appendingPathComponent(name))
        }
    }
    func videoURL(for photo: TrialPhoto) -> URL? {
        guard let name = photo.videoFilename else { return nil }
        let url = folder.appendingPathComponent(name)
        return FileManager.default.fileExists(atPath: url.path) ? url : nil
    }
    func lastImage(for photo: TrialPhoto) -> UIImage? {
        guard let name = photo.lastFrameFilename else { return nil }
        return UIImage(contentsOfFile: folder.appendingPathComponent(name).path)
    }

    func save(data: Data, capturedAt: Date) throws {
        guard storageReady else { throw CocoaError(.fileReadCorruptFile) }
        let id = UUID()
        let photo = TrialPhoto(id: id, capturedAt: capturedAt, filename: "\(id).jpg")
        let imageURL = folder.appendingPathComponent(photo.filename)
        try data.write(to: imageURL, options: [.atomic, .completeFileProtection])
        let updated = photos + [photo]
        do {
            try writeIndex(updated)
            photos = updated
        } catch {
            try? FileManager.default.removeItem(at: imageURL)
            throw error
        }
    }

    func image(for photo: TrialPhoto) -> UIImage? {
        UIImage(contentsOfFile: folder.appendingPathComponent(photo.filename).path)
    }
}
