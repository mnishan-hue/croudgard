from backend.cv.worker import FramePublisher, post_jpeg


def test_frame_publisher_keeps_only_the_newest_waiting_frame():
    publisher=FramePublisher("http://localhost/frame")
    publisher.submit(b"old")
    publisher.submit(b"new")
    assert publisher.frames.get_nowait()==b"new"


def test_post_jpeg_uses_binary_jpeg_request(monkeypatch):
    captured={}

    class Response:
        def __enter__(self): return self
        def __exit__(self,*_): return None
        def read(self): return b"ok"

    def fake_urlopen(request,timeout):
        captured["request"]=request; captured["timeout"]=timeout
        return Response()

    monkeypatch.setattr("backend.cv.worker.urlopen",fake_urlopen)
    assert post_jpeg("http://localhost/frame",b"jpeg")==b"ok"
    assert captured["request"].data==b"jpeg"
    assert captured["request"].get_header("Content-type")=="image/jpeg"
    assert captured["timeout"]==3
