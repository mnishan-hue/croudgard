from backend.cv.multi_worker import worker_command


def test_worker_command_builds_independent_streaming_camera():
    command=worker_command({"camera_id":"cam_exit_a","source":"1","counting_line_y":.55,"stream_fps":4},"http://localhost:8000/api")
    assert command[1:3]==["-m","backend.cv.worker"]
    assert command[command.index("--camera-id")+1]=="cam_exit_a"
    assert command[command.index("--source")+1]=="1"
    assert command[command.index("--counting-line-y")+1]=="0.55"
    assert "--no-stream" not in command


def test_worker_command_can_disable_video_without_disabling_ai():
    command=worker_command({"camera_id":"cam_main","source":"0","stream":False},"http://localhost/api")
    assert "--no-stream" in command
