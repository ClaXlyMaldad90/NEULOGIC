-- NeuroSense: Full schema with ESP8266 support columns
-- This creates all tables from scratch with the correct columns for the ESP8266 firmware flow.

-- Devices table (ESP8266 devices with auth_token authentication)
CREATE TABLE IF NOT EXISTS devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_code TEXT UNIQUE NOT NULL,
  device_name TEXT,
  password_hash TEXT,
  auth_token TEXT UNIQUE,
  wifi_ssid TEXT,
  wifi_configured BOOLEAN DEFAULT false,
  firmware_version TEXT DEFAULT '1.0.0',
  is_online BOOLEAN DEFAULT false,
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- User profiles (linked to auth.users)
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  role TEXT DEFAULT 'parent' CHECK (role IN ('parent', 'teacher')),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Device-user linking with RGPD/COPPA consent
CREATE TABLE IF NOT EXISTS device_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  consent_text TEXT NOT NULL,
  consent_accepted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  child_name TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, device_id)
);

-- Sensor data stream (with latency tracking)
CREATE TABLE IF NOT EXISTS sensor_data (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  gsr FLOAT NOT NULL,
  sound FLOAT NOT NULL,
  accel_x FLOAT NOT NULL,
  accel_y FLOAT NOT NULL,
  accel_z FLOAT NOT NULL,
  stress_index FLOAT,
  timestamp BIGINT NOT NULL,
  latency_ms FLOAT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Alerts generated from sensor analysis
CREATE TABLE IF NOT EXISTS alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  alert_type TEXT NOT NULL CHECK (alert_type IN ('overstimulation', 'high_movement', 'sound_spike', 'rapid_change')),
  severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high')),
  message TEXT NOT NULL,
  stress_value FLOAT,
  acknowledged BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes for query performance
CREATE INDEX IF NOT EXISTS idx_sensor_data_device_time ON sensor_data(device_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_device_time ON alerts(device_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_device_links_user ON device_links(user_id);
CREATE INDEX IF NOT EXISTS idx_devices_auth_token ON devices(auth_token);

-- Enable RLS on all tables
ALTER TABLE devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensor_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;

-- Profiles: users can CRUD their own row
DO $$ BEGIN
  CREATE POLICY "profiles_select_own" ON profiles FOR SELECT USING (auth.uid() = id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "profiles_insert_own" ON profiles FOR INSERT WITH CHECK (auth.uid() = id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "profiles_update_own" ON profiles FOR UPDATE USING (auth.uid() = id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "profiles_delete_own" ON profiles FOR DELETE USING (auth.uid() = id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Devices: anyone authenticated can read (for linking), no public write
DO $$ BEGIN
  CREATE POLICY "devices_select_authenticated" ON devices FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Device links: users see/manage only their own links
DO $$ BEGIN
  CREATE POLICY "device_links_select_own" ON device_links FOR SELECT USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "device_links_insert_own" ON device_links FOR INSERT WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "device_links_update_own" ON device_links FOR UPDATE USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "device_links_delete_own" ON device_links FOR DELETE USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Sensor data: users see data from their linked devices
DO $$ BEGIN
  CREATE POLICY "sensor_data_select_linked" ON sensor_data FOR SELECT USING (
    device_id IN (
      SELECT device_id FROM device_links WHERE user_id = auth.uid() AND is_active = true
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Sensor data: allow inserts from service role
DO $$ BEGIN
  CREATE POLICY "sensor_data_insert_service" ON sensor_data FOR INSERT WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Alerts: users see alerts from their linked devices
DO $$ BEGIN
  CREATE POLICY "alerts_select_linked" ON alerts FOR SELECT USING (
    device_id IN (
      SELECT device_id FROM device_links WHERE user_id = auth.uid() AND is_active = true
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Alerts: allow inserts from API
DO $$ BEGIN
  CREATE POLICY "alerts_insert_service" ON alerts FOR INSERT WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Alerts: users can update (acknowledge) alerts from their linked devices
DO $$ BEGIN
  CREATE POLICY "alerts_update_linked" ON alerts FOR UPDATE USING (
    device_id IN (
      SELECT device_id FROM device_links WHERE user_id = auth.uid() AND is_active = true
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
