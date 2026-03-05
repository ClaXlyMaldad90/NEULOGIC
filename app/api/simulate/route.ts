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

/**
 * POST /api/simulate
 * Sends simulated sensor data for a specific device (for testing the full pipeline).
 * Requires user to be authenticated and own the device.
 */
export async function POST(request: Request) {
  const supabase = getSupabaseAdmin()
  const sentAt = Date.now()

  try {
    const body = await request.json()
    const { device_id, scenario } = body

    if (!device_id) {
      return NextResponse.json({ error: "Se requiere device_id" }, { status: 400 })
    }

    // Verify device exists
    const { data: device, error: deviceError } = await supabase
      .from("devices")
      .select("id, device_code")
      .eq("id", device_id)
      .single()

    if (deviceError || !device) {
      return NextResponse.json({ error: "Dispositivo no encontrado" }, { status: 404 })
    }

    // Generate simulated sensor values based on scenario
    const sim = generateSimulatedData(scenario || "normal")

    // Simulate network latency (5-50ms for local, 50-200ms for real)
    const simulatedLatency = Math.floor(Math.random() * 45) + 5

    const gsrNorm = normalizeGSR(sim.gsr)
    const soundNorm = normalizeSound(sim.sound)
    const accelNorm = normalizeAccel(sim.accel_x, sim.accel_y, sim.accel_z)

    const rawStress = computeStressIndex(gsrNorm, soundNorm, accelNorm)
    const filteredStress = kalmanFilter(device.id, rawStress)

    const timestamp = Math.floor(Date.now() / 1000)

    // Store sensor data
    const { error: insertError } = await supabase.from("sensor_data").insert({
      device_id: device.id,
      gsr: gsrNorm,
      sound: soundNorm,
      accel_x: sim.accel_x,
      accel_y: sim.accel_y,
      accel_z: sim.accel_z,
      stress_index: filteredStress,
      timestamp,
      latency_ms: simulatedLatency,
    })

    if (insertError) {
      return NextResponse.json(
        { error: "Error al guardar datos simulados", details: insertError.message },
        { status: 500 }
      )
    }

    // Update device status
    await supabase
      .from("devices")
      .update({ last_seen_at: new Date().toISOString(), is_online: true })
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

    const processingTime = Date.now() - sentAt

    return NextResponse.json({
      stored: true,
      stress_index: filteredStress,
      alerts: alerts.length,
      timestamp,
      latency_ms: simulatedLatency,
      processing_time_ms: processingTime,
      raw_values: {
        gsr: sim.gsr,
        sound: sim.sound,
        accel_x: sim.accel_x,
        accel_y: sim.accel_y,
        accel_z: sim.accel_z,
      },
      normalized: {
        gsr: gsrNorm,
        sound: soundNorm,
        accel: accelNorm,
      },
    })
  } catch {
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 })
  }
}

type Scenario = "normal" | "stressed" | "calm" | "spike" | "random"

function generateSimulatedData(scenario: Scenario | string) {
  const noise = () => (Math.random() - 0.5) * 0.1

  switch (scenario) {
    case "calm":
      return {
        gsr: 0.15 + noise(),
        sound: 30 + Math.random() * 20,
        accel_x: 0 + noise() * 100,
        accel_y: 0 + noise() * 100,
        accel_z: 1024 + noise() * 50,
      }
    case "stressed":
      return {
        gsr: 0.75 + Math.random() * 0.2,
        sound: 180 + Math.random() * 60,
        accel_x: 500 + Math.random() * 1000,
        accel_y: 500 + Math.random() * 1000,
        accel_z: 1024 + Math.random() * 1500,
      }
    case "spike":
      return {
        gsr: 0.9 + Math.random() * 0.1,
        sound: 230 + Math.random() * 25,
        accel_x: 1500 + Math.random() * 500,
        accel_y: 1500 + Math.random() * 500,
        accel_z: 2500 + Math.random() * 500,
      }
    case "normal":
    default:
      return {
        gsr: 0.3 + Math.random() * 0.3,
        sound: 60 + Math.random() * 80,
        accel_x: 100 + Math.random() * 400,
        accel_y: 100 + Math.random() * 400,
        accel_z: 1024 + Math.random() * 500,
      }
  }
}
