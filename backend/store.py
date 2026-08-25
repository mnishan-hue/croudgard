import json
import sqlite3
from pathlib import Path
from threading import RLock

from backend.facilities import default_facilities
from backend.models import CrowdState, EventLog, Facility


class SQLiteStore:
    def __init__(self, path: str | Path):
        self.path = str(path)
        self._lock = RLock()
        self.connection = sqlite3.connect(self.path, check_same_thread=False)
        self.connection.row_factory = sqlite3.Row
        self.connection.executescript("""
          CREATE TABLE IF NOT EXISTS facilities (id TEXT PRIMARY KEY, data TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT, category TEXT, severity TEXT, message TEXT);
          CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        """)
        if not self.list_facilities():
            for facility in default_facilities(): self.save_facility(facility)
        if self.get_setting("active_facility") is None: self.set_setting("active_facility", "competition_prototype")
        if self.get_setting("automatic_control") is None: self.set_setting("automatic_control", "false")
        self._remove_legacy_operational_data()

    def _remove_legacy_operational_data(self):
        """Keep topology/configuration while removing persisted synthetic measurements."""
        with self._lock:
            self.connection.execute("DELETE FROM facilities WHERE id LIKE '%demo%'")
            for facility in self.list_facilities():
                if facility.name == "Competition Prototype":
                    facility.name = "Competition Facility"
                for camera in facility.cameras:
                    if camera.source.startswith("demo:"):
                        camera.source = ""
                for zone in facility.zones:
                    zone.risk = 0
                    zone.crowd_state = CrowdState.NORMAL
                    zone.metrics = zone.metrics.__class__()
                for exit_ in facility.exits:
                    exit_.risk = 0
                    exit_.status = "AVAILABLE"
                    exit_.current_inflow = 0
                    exit_.current_outflow = 0
                for sentinel in facility.sentinels:
                    if "mock" in sentinel.device_id or "demo" in sentinel.device_id:
                        sentinel.device_id = "unconfigured"
                    sentinel.connected = False
                    sentinel.hardware_state = sentinel.hardware_state.__class__()
                self.save_facility(facility)
            if not self.list_facilities():
                for facility in default_facilities():
                    self.save_facility(facility)
            if not self.get_facility(self.get_setting("active_facility")):
                self.set_setting("active_facility", self.list_facilities()[0].id)
            self.set_setting("current_scenario", "LIVE")
            if not any(sentinel.connected for facility in self.list_facilities() for sentinel in facility.sentinels):
                self.set_setting("automatic_control", "false")
            self.clear_events()

    def list_facilities(self):
        with self._lock:
            return [Facility.model_validate_json(row["data"]) for row in self.connection.execute("SELECT data FROM facilities ORDER BY id")]

    def get_facility(self, facility_id):
        with self._lock:
            row = self.connection.execute("SELECT data FROM facilities WHERE id=?", (facility_id,)).fetchone()
            return Facility.model_validate_json(row["data"]) if row else None

    def save_facility(self, facility):
        with self._lock:
            self.connection.execute("INSERT OR REPLACE INTO facilities(id,data) VALUES(?,?)", (facility.id, facility.model_dump_json()))
            self.connection.commit()
            return facility

    def add_event(self, event: EventLog):
        with self._lock:
            cursor = self.connection.execute("INSERT INTO events(timestamp,category,severity,message) VALUES(?,?,?,?)", (event.timestamp, event.category, event.severity, event.message))
            self.connection.commit(); event.id = cursor.lastrowid; return event

    def events(self, limit=100):
        with self._lock:
            rows = self.connection.execute("SELECT * FROM events ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
            return [EventLog(**dict(row)) for row in rows]

    def clear_events(self):
        with self._lock:
            self.connection.execute("DELETE FROM events")
            self.connection.commit()

    def get_setting(self, key):
        with self._lock:
            row = self.connection.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone(); return row["value"] if row else None

    def set_setting(self, key, value):
        with self._lock:
            self.connection.execute("INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)", (key, str(value))); self.connection.commit()

    def reset(self):
        with self._lock:
            self.connection.execute("DELETE FROM facilities")
            self.connection.execute("DELETE FROM events")
            self.connection.execute("DELETE FROM settings")
            self.connection.commit()
            for facility in default_facilities(): self.save_facility(facility)
            self.set_setting("active_facility", "competition_prototype")
            self.set_setting("automatic_control", "false")
            self.set_setting("current_scenario", "LIVE")
