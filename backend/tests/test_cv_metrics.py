from backend.cv.metrics import CrowdMetricExtractor, TrackedDetection


def box(track_id, x, y, confidence=.9):
    return TrackedDetection(track_id, confidence, x-10, y-20, x+10, y+20)


def test_people_density_and_motion_are_measured():
    extractor=CrowdMetricExtractor()
    extractor.update([box(1,100,100),box(2,200,100)],0,640,480,20)
    metrics=extractor.update([box(1,120,100),box(2,220,100)],1,640,480,20)
    assert metrics["people_count"]==2
    assert metrics["movement_direction"]=="RIGHT"
    assert metrics["average_speed_px_s"]==20
    assert metrics["density_score"]>0


def test_opposing_tracks_create_direction_conflict():
    extractor=CrowdMetricExtractor()
    extractor.update([box(1,100,100),box(2,200,100)],0,640,480,20)
    metrics=extractor.update([box(1,120,100),box(2,180,100)],1,640,480,20)
    assert metrics["movement_direction"]=="MIXED"
    assert metrics["direction_conflict"]==100


def test_counting_line_and_queue_growth():
    extractor=CrowdMetricExtractor(counting_line_y=.5)
    extractor.update([box(1,100,200)],0,640,480,20)
    extractor.update([box(1,100,260),box(2,200,200)],3,640,480,20)
    metrics=extractor.update([box(1,100,280),box(2,200,260),box(3,300,200)],6,640,480,20)
    assert metrics["inflow"]==2
    assert metrics["outflow"]==0
    assert metrics["queue_growth"]>0
    assert metrics["trend"]=="RISING"


def test_no_tracks_mark_motion_metrics_unavailable():
    metrics=CrowdMetricExtractor().update([],0,640,480,0)
    assert metrics["people_count"]==0
    assert metrics["average_speed_px_s"] is None
    assert metrics["movement_direction"]=="UNAVAILABLE"


def test_stopped_percentage_requires_sustained_track_history():
    extractor=CrowdMetricExtractor()
    extractor.update([box(1,100,100)],0,640,480,20)
    early=extractor.update([box(1,101,100)],1,640,480,20)
    stable=extractor.update([box(1,102,100)],2.2,640,480,20)
    assert early["stopped_percentage"] is None
    assert stable["stopped_percentage"]==100


def test_density_count_capacity_is_camera_configurable():
    detections=[box(index,index*15+20,100) for index in range(1,11)]
    default=CrowdMetricExtractor().update(detections,0,640,480,20)
    small_area=CrowdMetricExtractor(density_count_capacity=10).update(detections,0,640,480,20)
    assert small_area["density_score"] > default["density_score"]
