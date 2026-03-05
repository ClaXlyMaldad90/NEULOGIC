import { createClient as createServerClient } from "@/lib/supabase/server"
import { createClient } from "@supabase/supabase-js"
import { NextResponse } from "next/server"
import crypto from "crypto"

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

/**
 * POST /api/devices/provision
 * Provisions a new ESP8266 device with a unique auth token and links it to the current user.
 * Called from the device setup page after WiFi config is sent via Web Serial.
 */
export async function POST(request: Request) {
  const supabaseAdmin = getSupabaseAdmin()
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { device_name, child_name, consent_accepted, wifi_ssid } = body

    if (!consent_accepted) {
      return NextResponse.json(
        { error: "Se requiere aceptacion de consentimiento" },
        { status: 400 }
      )
    }

    // Generate unique device code and auth token
    const deviceCode = `ESP-${crypto.randomBytes(4).toString("hex").toUpperCase()}`
    const authToken = crypto.randomBytes(32).toString("hex")

    // Create the device record with auth token
    const { data: device, error: deviceError } = await supabaseAdmin
      .from("devices")
      .insert({
        device_code: deviceCode,
        device_name: device_name || `ESP8266 ${deviceCode}`,
        auth_token: authToken,
        wifi_ssid: wifi_ssid || null,
        wifi_configured: !!wifi_ssid,
        firmware_version: "1.0.0",
      })
      .select("id, device_code, auth_token, device_name")
      .single()

    if (deviceError) {
      return NextResponse.json(
        { error: "Error al crear dispositivo", details: deviceError.message },
        { status: 500 }
      )
    }

    // Create the device link with consent
    const consentText = `Acepto el tratamiento de datos sensoriales del menor "${child_name || "Sin nombre"}" a traves del dispositivo ESP8266 ${deviceCode}. Comprendo que los datos se procesan conforme al RGPD y COPPA. Consentimiento otorgado el ${new Date().toISOString()}.`

    const { error: linkError } = await supabaseAdmin
      .from("device_links")
      .insert({
        user_id: user.id,
        device_id: device.id,
        child_name: child_name || null,
        consent_text: consentText,
      })

    if (linkError) {
      // Rollback device creation if link fails
      await supabaseAdmin.from("devices").delete().eq("id", device.id)
      return NextResponse.json(
        { error: "Error al vincular dispositivo", details: linkError.message },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      device: {
        id: device.id,
        device_code: device.device_code,
        device_name: device.device_name,
        auth_token: device.auth_token,
      },
    })
  } catch {
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    )
  }
}
