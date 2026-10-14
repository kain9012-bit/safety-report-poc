import AVFoundation
import Combine
import UIKit

/// A cancelled request cannot accept a delayed result, even after another capture starts.
struct CaptureRequestGate {
    private(set) var requestID: UUID?
    mutating func begin() -> UUID {
        let id = UUID(); requestID = id; return id
    }
    mutating func cancel() { requestID = nil }
    mutating func finish(_ id: UUID) -> Bool {
        guard requestID == id else { return false }
        requestID = nil; return true
    }
}

// All capture-session configuration and start/stop work is serialized on queue.
final class CameraEngine: NSObject, AVCapturePhotoCaptureDelegate, AVCaptureFileOutputRecordingDelegate, @unchecked Sendable {
    enum Event: Sendable {
        case ready(Bool)
        case photo(UUID, Data, Date)
        case photoFailure(UUID, String)
        case photoCancelled(UUID, String?)
        case recording(UUID, Date, Int)
        case movie(UUID, URL, Date, Int)
        case movieFailure(UUID, String)
        case cancelled(UUID, String?)
        case failure(String)
    }
    let session = AVCaptureSession()
    var onEvent: (@Sendable (Event) -> Void)?
    private let queue = DispatchQueue(label: "ParkingGuide.camera")
    private let output = AVCapturePhotoOutput()
    private let movieOutput = AVCaptureMovieFileOutput()
    private var configured = false
    private struct PendingPhoto {
        let settingsID: Int64
        let requestID: UUID
        var timestamp: Date
    }
    private var pendingPhoto: PendingPhoto?
    private var pendingMovie: URL?
    private var pendingMovieRequestID: UUID?
    private var cancelledMovies = Set<URL>()
    private var movieDate = Date()
    private var movieSeconds = 5
    private var interruptionObserver: NSObjectProtocol?

    func start() {
        queue.async { [self] in
            do {
                if !configured {
                    session.beginConfiguration()
                    defer { session.commitConfiguration() }
                    session.sessionPreset = session.canSetSessionPreset(.hd1920x1080) ? .hd1920x1080 : .high
                    guard let camera = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back) else {
                        throw CameraError.unavailable
                    }
                    let input = try AVCaptureDeviceInput(device: camera)
                    guard session.canAddInput(input) else { throw CameraError.unavailable }
                    session.addInput(input)
                    guard session.canAddOutput(output) else {
                        session.removeInput(input)
                        throw CameraError.unavailable
                    }
                    session.addOutput(output)
                    guard session.canAddOutput(movieOutput) else { throw CameraError.unavailable }
                    session.addOutput(movieOutput)
                    interruptionObserver = NotificationCenter.default.addObserver(forName: AVCaptureSession.wasInterruptedNotification, object: session, queue: nil) { [weak self] _ in
                        self?.cancelCapture(message: "촬영이 중단됐어요. 처음부터 다시 촬영해 주세요.")
                    }
                    configured = true
                }
                if !session.isRunning { session.startRunning() }
                onEvent?(.ready(session.isRunning))
                if !session.isRunning { onEvent?(.failure("후면 카메라를 사용할 수 없어요. 실제 아이폰에서 실행하고 카메라를 다시 열어 주세요.")) }
            } catch { onEvent?(.failure("후면 카메라를 사용할 수 없어요. 실제 아이폰에서 실행하고 카메라를 다시 열어 주세요.")) }
        }
    }

    func stop() {
        queue.async { [self] in
            pendingPhoto = nil
            cancelMovieOnQueue(message: nil)
            if session.isRunning { session.stopRunning() }
            onEvent?(.ready(false))
        }
    }

    func record(seconds: Int, requestID: UUID) {
        queue.async { [self] in
            guard session.isRunning, pendingPhoto == nil, pendingMovie == nil, !movieOutput.isRecording, [3, 5].contains(seconds) else {
                onEvent?(.movieFailure(requestID, "카메라가 준비되지 않았어요. 잠시 후 다시 시도해 주세요.")); return
            }
            let url = FileManager.default.temporaryDirectory.appendingPathComponent("ParkingGuide-\(UUID()).mov")
            pendingMovie = url; pendingMovieRequestID = requestID; movieSeconds = seconds
            movieOutput.maxRecordedDuration = CMTime(seconds: Double(seconds), preferredTimescale: 600)
            if let connection = movieOutput.connection(with: .video), connection.isVideoRotationAngleSupported(90) {
                connection.videoRotationAngle = 90
            }
            // 세션에는 영상 입력만 추가한다. 마이크 권한이나 음성 녹음은 사용하지 않는다.
            movieOutput.startRecording(to: url, recordingDelegate: self)
        }
    }

    func cancelCapture(message: String? = nil) {
        queue.async { [self] in
            if let photo = pendingPhoto {
                pendingPhoto = nil
                onEvent?(.photoCancelled(photo.requestID, message))
            }
            cancelMovieOnQueue(message: message)
        }
    }
    private func cancelMovieOnQueue(message: String?) {
        guard let url = pendingMovie, let id = pendingMovieRequestID else { return }
        cancelledMovies.insert(url)
        if movieOutput.isRecording { movieOutput.stopRecording() }
        onEvent?(.cancelled(id, message))
    }
    func fileOutput(_ output: AVCaptureFileOutput, didStartRecordingTo fileURL: URL, from connections: [AVCaptureConnection]) {
        queue.async { [self] in
            if cancelledMovies.contains(fileURL) { movieOutput.stopRecording(); return }
            guard pendingMovie == fileURL, let id = pendingMovieRequestID else { return }
            movieDate = Date(); onEvent?(.recording(id, movieDate, movieSeconds))
        }
    }
    func fileOutput(_ output: AVCaptureFileOutput, didFinishRecordingTo fileURL: URL, from connections: [AVCaptureConnection], error: Error?) {
        queue.async { [self] in
            guard pendingMovie == fileURL, let id = pendingMovieRequestID else {
                try? FileManager.default.removeItem(at: fileURL); return
            }
            pendingMovie = nil; pendingMovieRequestID = nil
            if cancelledMovies.remove(fileURL) != nil {
                try? FileManager.default.removeItem(at: fileURL); return
            }
            // 시간 제한에 도달해도 성공적으로 저장됐음을 나타내는 키가 있으면 파일을 검사한다.
            let finished = (error as NSError?)?.userInfo[AVErrorRecordingSuccessfullyFinishedKey] as? Bool
            if let error, finished != true {
                try? FileManager.default.removeItem(at: fileURL)
                onEvent?(.movieFailure(id, "영상을 저장하지 못했어요. \(error.localizedDescription)"))
            } else { onEvent?(.movie(id, fileURL, movieDate, movieSeconds)) }
        }
    }

    deinit {
        if let interruptionObserver { NotificationCenter.default.removeObserver(interruptionObserver) }
    }

    func capture(requestID: UUID) {
        queue.async { [self] in
            guard session.isRunning, pendingPhoto == nil, pendingMovie == nil, !movieOutput.isRecording else {
                onEvent?(.photoFailure(requestID, "카메라가 준비되지 않았어요. 다시 열어 주세요."))
                return
            }
            if let connection = output.connection(with: .video), connection.isVideoRotationAngleSupported(90) {
                connection.videoRotationAngle = 90
            }
            let settings = AVCapturePhotoSettings(format: [AVVideoCodecKey: AVVideoCodecType.jpeg])
            pendingPhoto = PendingPhoto(settingsID: settings.uniqueID, requestID: requestID, timestamp: Date())
            output.capturePhoto(with: settings, delegate: self)
        }
    }

    func photoOutput(_ output: AVCapturePhotoOutput, willCapturePhotoFor resolvedSettings: AVCaptureResolvedPhotoSettings) {
        let id = resolvedSettings.uniqueID
        let timestamp = Date()
        queue.async { [self] in
            guard pendingPhoto?.settingsID == id else { return }
            pendingPhoto?.timestamp = timestamp
        }
    }

    func photoOutput(_ output: AVCapturePhotoOutput, didFinishProcessingPhoto photo: AVCapturePhoto, error: Error?) {
        let id = photo.resolvedSettings.uniqueID
        let message = error.map { "사진을 촬영하지 못했어요. \($0.localizedDescription)" }
        let data = error == nil ? photo.fileDataRepresentation() : nil
        queue.async { [self] in
            guard let pending = pendingPhoto, pending.settingsID == id else { return }
            pendingPhoto = nil
            if let message { onEvent?(.photoFailure(pending.requestID, message)) }
            else if let data { onEvent?(.photo(pending.requestID, data, pending.timestamp)) }
            else { onEvent?(.photoFailure(pending.requestID, "사진 데이터를 만들지 못했어요. 다시 촬영해 주세요.")) }
        }
    }

    func photoOutput(_ output: AVCapturePhotoOutput, didFinishCaptureFor resolvedSettings: AVCaptureResolvedPhotoSettings, error: Error?) {
        guard let error else { return }
        let id = resolvedSettings.uniqueID
        let message = error.localizedDescription
        queue.async { [self] in
            guard let pending = pendingPhoto, pending.settingsID == id else { return }
            pendingPhoto = nil
            onEvent?(.photoFailure(pending.requestID, message))
        }
    }

    enum CameraError: Error { case unavailable }
}

@MainActor final class CameraModel: ObservableObject {
    let engine = CameraEngine()
    @Published var ready = false
    @Published var capturing = false
    @Published var denied = false
    @Published var error: String?
    @Published var draft: Data?
    @Published var clip: CapturedClip?
    @Published var recording = false
    @Published var processing = false
    @Published var recordingStartedAt: Date?
    @Published var seconds = 5
    @Published var capturedAt = Date()
    private var visible = false
    private var clipTask: Task<Void, Never>?
    private var movieToPrepare: URL?
    private var processingToken: UUID?
    private var photoRequests = CaptureRequestGate()
    private var movieRequests = CaptureRequestGate()

    init() {
        engine.onEvent = { [weak self] event in
            Task { @MainActor [weak self] in
                guard let self else { return }
                switch event {
                case .ready(let ready): self.ready = self.visible && ready
                case .photo(let id, let data, let date):
                    guard self.visible, self.photoRequests.finish(id) else { return }
                    self.draft = data
                    self.capturedAt = date
                    self.capturing = false
                    self.engine.stop()
                case .photoFailure(let id, let message):
                    guard self.visible, self.photoRequests.finish(id) else { return }
                    self.error = message; self.capturing = false
                case .photoCancelled(let id, let message):
                    guard self.visible, self.photoRequests.finish(id) else { return }
                    self.capturing = false
                    if let message { self.error = message }
                case .recording(let id, let date, let seconds):
                    guard self.visible, self.movieRequests.requestID == id else { return }
                    self.recordingStartedAt = date; self.seconds = seconds; self.recording = true
                case .movie(let id, let url, let date, let seconds):
                    guard self.visible, self.movieRequests.finish(id) else { try? FileManager.default.removeItem(at: url); return }
                    self.recording = false; self.processing = true; self.movieToPrepare = url
                    let token = UUID(); self.processingToken = token
                    self.clipTask = Task { [weak self] in
                        do {
                            let clip = try await ShortClip.prepare(url: url, startedAt: date, seconds: seconds)
                            try Task.checkCancellation()
                            guard let self, self.visible, self.processingToken == token else { try? FileManager.default.removeItem(at: url); return }
                            self.clip = clip; self.movieToPrepare = nil; self.processing = false; self.capturing = false
                            self.engine.stop()
                        } catch {
                            try? FileManager.default.removeItem(at: url)
                            guard let self, self.processingToken == token else { return }
                            self.movieToPrepare = nil; self.processing = false; self.capturing = false
                            if !(error is CancellationError) { self.error = error.localizedDescription }
                        }
                    }
                case .cancelled(let id, let message):
                    guard self.visible, self.movieRequests.finish(id) else { return }
                    self.recording = false; self.capturing = false; self.recordingStartedAt = nil
                    if let message { self.error = message }
                case .movieFailure(let id, let message):
                    guard self.visible, self.movieRequests.finish(id) else { return }
                    self.error = message
                    self.capturing = false; self.recording = false; self.recordingStartedAt = nil
                case .failure(let message):
                    self.error = message
                    self.capturing = false
                    self.recording = false; self.processing = false
                }
            }
        }
    }

    func start() async {
        visible = true
        let granted: Bool
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: granted = true
        case .notDetermined: granted = await AVCaptureDevice.requestAccess(for: .video)
        default: granted = false
        }
        denied = !granted
        guard granted, visible, draft == nil, clip == nil else { return }
        engine.start()
    }

    func stop() {
        photoRequests.cancel(); movieRequests.cancel()
        visible = false; ready = false; processingToken = nil; clipTask?.cancel(); engine.stop()
        recording = false; processing = false; capturing = false; recordingStartedAt = nil
    }
    func capture() {
        guard ready, !capturing else { return }
        capturing = true
        error = nil
        engine.capture(requestID: photoRequests.begin())
    }
    func record(seconds: Int) {
        guard ready, !capturing else { return }
        capturing = true; error = nil; self.seconds = seconds
        engine.record(seconds: seconds, requestID: movieRequests.begin())
    }
    func cancelCapture() {
        photoRequests.cancel(); movieRequests.cancel()
        processingToken = nil; clipTask?.cancel(); engine.cancelCapture()
        recording = false; processing = false; capturing = false; recordingStartedAt = nil
    }
    func retake() {
        if let clip { try? FileManager.default.removeItem(at: clip.url) }
        clip = nil; draft = nil; Task { await start() }
    }
    func close() {
        stop()
        if let clip { try? FileManager.default.removeItem(at: clip.url) }
        clip = nil
    }
}
