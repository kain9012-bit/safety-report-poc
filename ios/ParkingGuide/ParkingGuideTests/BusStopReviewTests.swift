import XCTest
import CoreLocation
@testable import ParkingGuide

@MainActor final class BusStopReviewTests: XCTestCase {
    private let at = Date(timeIntervalSince1970: 1000)
    private func location(lat: Double = 37, lng: Double = 127, accuracy: Double = 5, bearing: Double? = nil) -> LocationRecord {
        var result = LocationRecord(latitude: lat, longitude: lng, accuracy: accuracy, measuredAt: at, sampleCount: 3, spread: 0, quality: "주변 탐색 참고")
        if let bearing { result.cameraDirection = .init(bearing: bearing, measuredAt: at, horizontalProjection: 1, accuracy: 5, reference: "true", receivedAt: at) }
        return result
    }
    private func photo(_ slot: PrimarySlot, location: LocationRecord? = nil) -> ZoneEvidence {
        .init(id: UUID(), roles: [.incident], source: .prototypeCamera, filename: "fixture", takenAt: at, addedAt: at, primarySlot: slot, location: location)
    }
    private func observation(_ photo: ZoneEvidence, number: String = "001") -> NativeAIObservation {
        .init(photoID: photo.id, type: .busstop, identity: "yes", target: "yes", relation: "yes", text: "", unknownReasons: [], busStop: .init(publicId: number, name: "시청", readable: true))
    }
    private func stop(_ id: String = "internal", north: Double = 100, publicID: String = "001") -> NativeBusStop {
        .init(id: id, name: "시청", lat: 37 + north / 111_320, lng: 127, source: "TAGO", regionCode: "1", publicId: publicID, publicIdNamespace: "TAGO:1:nodeno")
    }
    private func search(_ stops: [NativeBusStop]) -> NativeStopSearch { .init(stops: stops, latitude: 37, longitude: 127, queriedAt: at, partial: false) }
    private func analyzed(_ photos: [ZoneEvidence], observations: [NativeAIObservation]) -> ZoneCase {
        var draft = ZoneCase(); draft.evidence = photos
        draft.review.aiResult = .init(revision: draft.review.revision, photoIDs: photos.map(\.id), generatedAt: at, recommendedTypes: [.busstop], observations: observations, summary: "fixture", model: "test-only")
        return draft
    }
    func testRetainedSupplementalIsNotUsedAsActiveOrigin() throws {
        let old = photo(.supplemental, location: location(lat: 35)), current = photo(.first, location: location(lat: 37))
        var draft = ZoneCase(); draft.evidence = [old, current]
        XCTAssertEqual(NativeStopMatcher.context(draft)?.latitude, 37)
        draft.evidence = [old]; XCTAssertNil(NativeStopMatcher.context(draft))
    }
    func testPublicNumberUsesItsExactPhotographPositionAndHeading() throws {
        let first = photo(.first, location: location(lat: 35, bearing: 90)), second = photo(.second, location: location(lat: 37, bearing: 0))
        let draft = analyzed([first, second], observations: [observation(second)])
        let context = try XCTUnwrap(NativeStopMatcher.context(draft))
        XCTAssertEqual(context.photoID, second.id); XCTAssertEqual(context.latitude, 37); XCTAssertEqual(context.location?.cameraDirection?.bearing, 0)
        XCTAssertTrue(context.exactPhotoContext)
    }
    func testUnlinkedSupplementalNumberIsNotMatched() throws {
        let main = photo(.first, location: location()), extra = photo(.supplemental, location: location(lat: 36))
        let draft = analyzed([main, extra], observations: [observation(extra)])
        let context = try XCTUnwrap(NativeStopMatcher.context(draft))
        XCTAssertNil(context.photoEvidence); XCTAssertFalse(context.exactPhotoContext); XCTAssertEqual(context.latitude, 37)
    }
    func testUserChosenVehiclePointDoesNotInheritPhotoHeading() throws {
        let main = photo(.first, location: location(bearing: 0)); var draft = analyzed([main], observations: [observation(main)])
        draft.review.selectedLocation = .init(latitude: 38, longitude: 128, selectedAt: at)
        let context = try XCTUnwrap(NativeStopMatcher.context(draft))
        XCTAssertEqual(context.role, "manual_vehicle"); XCTAssertNil(context.location); XCTAssertFalse(context.exactPhotoContext)
    }
    func testNamespaceUnknownIsTextMatchOnlyAndNearestDoesNotOverrideNumber() throws {
        let main = photo(.first, location: location()); let draft = analyzed([main], observations: [observation(main)])
        var context = try XCTUnwrap(NativeStopMatcher.context(draft))
        let result = NativeStopMatcher.candidates(search([stop("far", north: 100), stop("near", north: 10, publicID: "999")]), context: context)
        XCTAssertEqual(result.count, 2); XCTAssertEqual(result[0].stop.id, "far"); XCTAssertEqual(result[0].numberMatch, "text_only")
        context.photoEvidence?.publicIdNamespace = "TAGO:1:nodeno"
        XCTAssertEqual(NativeStopMatcher.candidates(search([stop()]), context: context)[0].numberMatch, "match")
    }
    func testTrueNorthDirectionConflictAndWideGPSRemainUncertain() throws {
        let main = photo(.first, location: location(bearing: 180)); let draft = analyzed([main], observations: [observation(main)])
        var context = try XCTUnwrap(NativeStopMatcher.context(draft)); context.photoEvidence?.publicIdNamespace = "TAGO:1:nodeno"
        var value = NativeStopMatcher.candidates(search([stop()]), context: context)[0]
        XCTAssertEqual(value.directionDifference ?? -1, 180, accuracy: 0.1); XCTAssertFalse(value.conflicts.isEmpty)
        context.location?.accuracy = 150
        value = NativeStopMatcher.candidates(search([stop()]), context: context)[0]
        XCTAssertNil(value.directionDifference)
        context.location?.accuracy = 5; context.location?.cameraDirection?.receivedAt = at.addingTimeInterval(0.1)
        XCTAssertNil(NativeStopMatcher.candidates(search([stop()]), context: context)[0].directionDifference)
        XCTAssertEqual(NativeStopMatcher.difference(359, 1), 2)
    }
    func testDuplicatePublicNumbersAndSameNamesKeepMultipleCandidates() throws {
        let main = photo(.first, location: location()); let draft = analyzed([main], observations: [observation(main)])
        var context = try XCTUnwrap(NativeStopMatcher.context(draft)); context.photoEvidence?.publicIdNamespace = "TAGO:1:nodeno"
        let results = NativeStopMatcher.candidates(search([stop("one"), stop("two", north: -100)]), context: context)
        XCTAssertEqual(results.count, 2); XCTAssertTrue(results.allSatisfy { !$0.conflicts.isEmpty })
        var differentRegion = stop(); differentRegion.regionCode = "2"
        XCTAssertNotEqual(stop().identity, differentRegion.identity)
    }
    func testSelectionContextInvalidatesWithoutDeletingChoice() throws {
        let main = photo(.first, location: location()); var draft = analyzed([main], observations: [observation(main)])
        let chosen = stop(); var lookup = search([chosen]); lookup.selectedIdentity = chosen.identity; lookup.selectedStop = chosen
        lookup.selectionSignature = NativeStopMatcher.signature(draft); draft.review.stopSearch = lookup
        XCTAssertTrue(NativeStopMatcher.selectionCurrent(lookup, draft: draft))
        draft.review.selectedLocation = .init(latitude: 37, longitude: 127, selectedAt: at)
        XCTAssertFalse(NativeStopMatcher.selectionCurrent(lookup, draft: draft)); XCTAssertEqual(draft.review.stopSearch?.selectedIdentity, chosen.identity)
    }
    func testGPSConsistencyUsesReportedRadiiWithoutAnInventedFiftyMeterAllowance() {
        let points = [0.0, 0.0001, 0.0002].enumerated().map { index, latitude in
            CLLocation(coordinate: .init(latitude: 37 + latitude, longitude: 127), altitude: 0, horizontalAccuracy: 1, verticalAccuracy: -1, timestamp: at.addingTimeInterval(Double(index) - 2))
        }
        XCTAssertEqual(CaptureLocationQuality.record(points, at: at)?.quality, "위치 변동·샘플 부족")
        XCTAssertEqual(CaptureLocationQuality.record(points, at: at.addingTimeInterval(12))?.quality, "위치 오래됨")
    }
}
