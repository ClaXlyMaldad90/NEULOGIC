import { createClient } from "@supabase/supabase-js"
import { NextResponse } from "next/server"
import {
  kalmanFilter,
  normalizeGSR,
  normalizeSound,
  normalizeAccel,
  computeStressIndex,
  detectAlerts,
} from "@/lib/sensor-processing"

// Lazily create the service role client to avoid build-time env var errors
function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function POST(request: Request) {
  const supabase = getSupabaseAdmin()
  const receivedAt = Date.now()

  try {
    const body = await request.json()

    const { device_code, gsr, sound, accel_x, accel_y, accel_z, sent_at } = body

    // Validate required fields — ESP8266 identifies itself with device_code
    if (!device_code || gsr === undefined || sound === undefined) {
      return NextResponse.json(
        { error: "Campos requeridos: device_code, gsr, sound" },
        { status: 400 }
      )
    }

    // Find device by device_code (unique per ESP8266)
    const { data: device, error: deviceError } = await supabase
      .from("devices")
      .select("id, device_code, device_name")
      .eq("device_code", device_code)
      .single()

    if (deviceError || !device) {
      return NextResponse.json(
        { error: "Dispositivo no encontrado. Verifica el device_code." },
        { status: 404 }
      )
    }

    // Calculate latency if sent_at is provided (milliseconds since boot from ESP8266)
    const latencyMs = sent_at ? Math.max(0, receivedAt - sent_at) : null

    // Normalize sensor values
    const gsrNorm = normalizeGSR(gsr)
    const soundNorm = normalizeSound(sound)
    const ax = accel_x ?? 0
    const ay = accel_y ?? 0
    const az = accel_z ?? 0
    const accelNorm = normalizeAccel(ax, ay, az)

    // Apply Kalman filter to stress index for noise reduction
    const rawStress = computeStressIndex(gsrNorm, soundNorm, accelNorm)
    const filteredStress = kalmanFilter(device.id, rawStress)

    const timestamp = Math.floor(Date.now() / 1000)

    // Store sensor data with latency measurement
    const { error: insertError } = await supabase.from("sensor_data").insert({
      device_id: device.id,
      gsr: gsrNorm,
      sound: soundNorm,
      accel_x: ax,
      accel_y: ay,
      accel_z: az,
      stress_index: filteredStress,
      timestamp,
      latency_ms: latencyMs,
    })

    if (insertError) {
      return NextResponse.json(
        { error: "Error al guardar datos", details: insertError.message },
        { status: 500 }
      )
    }

    // Update device last_seen_at and online status
    await supabase
      .from("devices")
      .update({
        last_seen_at: new Date().toISOString(),
        is_online: true,
      })
      .eq("id", device.id)

    // Detect and store alerts
    const alerts = detectAlerts(filteredStress, gsrNorm, soundNorm, accelNorm)
    if (alerts.length > 0) {
      const alertRows = alerts.map((a) => ({
        device_id: device.id,
        alert_type: a.type,
        severity: a.severity,
        message: a.message,
        stress_value: filteredStress,
      }))

      await supabase.from("alerts").insert(alertRows)
    }

    return NextResponse.json({
      ok: true,
      stress_index: filteredStress,
      alerts: alerts.length,
      timestamp,
      latency_ms: latencyMs,
      device_id: device.id,
    })
  } catch {
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    )
  }
}

export async function GET() {
  return NextResponse.json({
    status: "NeuroSense API v1 - ESP8266 Sensor Data Endpoint",
    version: "3.0",
    auth: "device_code (no token required)",
    fields: {
      required: ["device_code", "gsr", "sound"],
      optional: ["accel_x", "accel_y", "accel_z", "sent_at"],
    },
  })
}
