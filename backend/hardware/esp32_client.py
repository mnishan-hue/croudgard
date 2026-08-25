class ESP32Client:
    """Future local-network client. Frontend commands must always pass through the backend."""
    def set_state(self, sentinel, command):
        raise ConnectionError("ESP32 client is not configured")
