import json
import sqlite3
from pathlib import Path

from backend.facilities import default_facilities
from backend.models import EventLog, Facility


class SQLiteStore:
    def __init__(self, path: str | Path):
        self.path = str(path)
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
        if self.get_setting("automatic_control") is None: self.set_setting("automatic_control", "true")

    def list_facilities(self):
        return [Facility.model_validate_json(row["data"]) for row in self.connection.execute("SELECT data FROM facilities ORDER BY id")]

    def get_facility(self, facility_id):
        row = self.connection.execute("SELECT data FROM facilities WHERE id=?", (facility_id,)).fetchone()
        return Facility.model_validate_json(row["data"]) if row else None

    def save_facility(self, facility):
        self.connection.execute("INSERT OR REPLACE INTO facilities(id,data) VALUES(?,?)", (facility.id, facility.model_dump_json()))
        self.connection.commit()
        return facility

    def add_event(self, event: EventLog):
        cursor = self.connection.execute("INSERT INTO events(timestamp,category,severity,message) VALUES(?,?,?,?)", (event.timestamp, event.category, event.severity, event.message))
        self.connection.commit(); event.id = cursor.lastrowid; return event

    def events(self, limit=100):
        rows = self.connection.execute("SELECT * FROM events ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
        return [EventLog(**dict(row)) for row in rows]

    def get_setting(self, key):
        row = self.connection.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone(); return row["value"] if row else None

    def set_setting(self, key, value):
        self.connection.execute("INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)", (key, str(value))); self.connection.commit()

    def reset(self):
        self.connection.execute("DELETE FROM facilities")
        for facility in default_facilities(): self.save_facility(facility)
