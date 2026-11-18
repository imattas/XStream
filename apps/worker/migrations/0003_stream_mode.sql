ALTER TABLE stream_sessions ADD COLUMN mode TEXT NOT NULL DEFAULT 'xhome' CHECK (mode IN ('xhome','xcloud'));
