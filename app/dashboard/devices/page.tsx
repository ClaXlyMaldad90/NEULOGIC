"use client"

import { useState } from "react"
import { useDevices } from "@/hooks/use-devices"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import {
  Cpu,
  Plus,
  Loader2,
  Shield,
  Clock,
  Wifi,
  Download,
  CheckCircle2,
  AlertCircle,
  Signal,
  Eye,
  EyeOff,
} from "lucide-react"
import { toast } from "sonner"
import { generateFirmwareINO } from "@/lib/generate-firmware"

export default function DevicesPage() {
  const { deviceLinks, refetch, loading } = useDevices()
  const [open, setOpen] = useState(false)

  // Form state
  const [wifiSsid, setWifiSsid] = useState("")
  const [wifiPassword, setWifiPassword] = useState("")
  const [showWifiPassword, setShowWifiPassword] = useState(false)
  const [deviceName, setDeviceName] = useState("")
  const [childName, setChildName] = useState("")
  const [consentAccepted, setConsentAccepted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [provisioned, setProvisioned] = useState<{
    device_code: string
    auth_token: string
    device_name: string
  } | null>(null)

  function resetForm() {
    setWifiSsid("")
    setWifiPassword("")
    setShowWifiPassword(false)
    setDeviceName("")
    setChildName("")
    setConsentAccepted(false)
    setSubmitting(false)
    setProvisioned(null)
  }

  function handleOpenChange(isOpen: boolean) {
    if (!isOpen) resetForm()
    setOpen(isOpen)
  }

  function downloadFirmware(device: {
    device_code: string
    auth_token: string
    device_name: string
  }) {
    const ino = generateFirmwareINO({
      wifiSsid,
      wifiPassword,
      serverUrl: window.location.origin,
      authToken: device.auth_token,
      deviceName: device.device_name,
      deviceCode: device.device_code,
    })

    const blob = new Blob([ino], { type: "text/plain" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `neurosense_${device.device_code}.ino`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  async function handleProvision() {
    if (!consentAccepted) {
      toast.error("Debes aceptar el consentimiento para continuar")
      return
    }
    if (!wifiSsid.trim()) {
      toast.error("Ingresa el nombre de la red WiFi")
      return
    }

    setSubmitting(true)

    try {
      const res = await fetch("/api/devices/provision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          device_name: deviceName || undefined,
          child_name: childName || undefined,
          consent_accepted: consentAccepted,
          wifi_ssid: wifiSsid || undefined,
        }),
      })

      const json = await res.json()

      if (!res.ok) {
        toast.error(json.error || "Error al provisionar dispositivo")
        setSubmitting(false)
        return
      }

      const device = {
        device_code: json.device.device_code,
        auth_token: json.device.auth_token,
        device_name: json.device.device_name,
      }

      setProvisioned(device)

      // Auto-download the .ino file
      downloadFirmware(device)
      toast.success("Dispositivo creado. El archivo .ino se esta descargando.")
      await refetch()
    } catch {
      toast.error("Error de conexion al servidor")
    } finally {
      setSubmitting(false)
    }
  }

  function formatDate(dateStr: string) {
    return new Date(dateStr).toLocaleDateString("es-ES", {
      day: "numeric",
      month: "long",
      year: "numeric",
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Dispositivos</h1>
          <p className="text-sm text-muted-foreground">
            Gestiona los ESP8266 vinculados a tu cuenta
          </p>
        </div>
        <Dialog open={open} onOpenChange={handleOpenChange}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Agregar dispositivo
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle className="text-foreground">
                {provisioned ? "Dispositivo creado" : "Configurar ESP8266"}
              </DialogTitle>
              <DialogDescription>
                {provisioned
                  ? "Tu dispositivo esta listo. Sube el archivo .ino desde Arduino IDE."
                  : "Completa los datos para generar el firmware pre-configurado"}
              </DialogDescription>
            </DialogHeader>

            {/* Form view */}
            {!provisioned && (
              <div className="flex flex-col gap-4 py-2">
                {/* WiFi Config */}
                <div className="rounded-lg border border-border bg-muted/30 p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <Wifi className="h-4 w-4 text-primary" />
                    <span className="text-sm font-semibold text-foreground">
                      Red WiFi del ESP8266
                    </span>
                  </div>
                  <div className="flex flex-col gap-3">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="wifiSsid" className="text-xs text-foreground">
                        Nombre de la red (SSID)
                      </Label>
                      <Input
                        id="wifiSsid"
                        placeholder="Mi_Red_WiFi"
                        value={wifiSsid}
                        onChange={(e) => setWifiSsid(e.target.value)}
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="wifiPassword" className="text-xs text-foreground">
                        Contrasena
                      </Label>
                      <div className="relative">
                        <Input
                          id="wifiPassword"
                          type={showWifiPassword ? "text" : "password"}
                          placeholder="Contrasena de la red"
                          value={wifiPassword}
                          onChange={(e) => setWifiPassword(e.target.value)}
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2"
                          onClick={() => setShowWifiPassword(!showWifiPassword)}
                          type="button"
                        >
                          {showWifiPassword ? (
                            <EyeOff className="h-3.5 w-3.5" />
                          ) : (
                            <Eye className="h-3.5 w-3.5" />
                          )}
                        </Button>
                      </div>
                    </div>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    La contrasena se incluye unicamente en el archivo .ino que descargas.
                    No se envia ni se almacena en el servidor.
                  </p>
                </div>

                {/* Device Info */}
                <div className="flex flex-col gap-3">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="deviceName" className="text-xs text-foreground">
                      Nombre del dispositivo (opcional)
                    </Label>
                    <Input
                      id="deviceName"
                      placeholder="Ej: Sensor salon de clases"
                      value={deviceName}
                      onChange={(e) => setDeviceName(e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="childName" className="text-xs text-foreground">
                      Nombre del menor (opcional)
                    </Label>
                    <Input
                      id="childName"
                      placeholder="Nombre del nino/a"
                      value={childName}
                      onChange={(e) => setChildName(e.target.value)}
                    />
                  </div>
                </div>

                <Separator />

                {/* RGPD/COPPA Consent */}
                <div className="rounded-lg border border-border bg-muted/30 p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <Shield className="h-4 w-4 text-primary" />
                    <span className="text-sm font-semibold text-foreground">
                      Consentimiento RGPD/COPPA
                    </span>
                  </div>
                  <p className="mb-4 text-xs leading-relaxed text-muted-foreground">
                    Al vincular este dispositivo ESP8266, autorizo expresamente el
                    tratamiento de datos sensoriales (conductancia cutanea, niveles de
                    sonido y aceleracion) del menor identificado. Estos datos se procesan
                    unicamente con fines de monitoreo del bienestar sensorial, conforme al
                    Reglamento General de Proteccion de Datos (RGPD) y la Ley de
                    Proteccion de la Privacidad Infantil en Linea (COPPA). Los datos son
                    accesibles exclusivamente por los tutores autorizados vinculados a
                    este dispositivo.
                  </p>
                  <div className="flex items-start gap-2">
                    <Checkbox
                      id="consent"
                      checked={consentAccepted}
                      onCheckedChange={(checked) =>
                        setConsentAccepted(checked === true)
                      }
                    />
                    <Label
                      htmlFor="consent"
                      className="text-xs leading-relaxed text-foreground"
                    >
                      Acepto el tratamiento de datos del menor y confirmo que tengo la
                      autoridad legal para otorgar este consentimiento.
                    </Label>
                  </div>
                </div>

                <DialogFooter>
                  <Button
                    onClick={handleProvision}
                    disabled={!wifiSsid.trim() || !consentAccepted || submitting}
                    className="w-full"
                    size="lg"
                  >
                    {submitting ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Creando dispositivo...
                      </>
                    ) : (
                      <>
                        <Download className="mr-2 h-4 w-4" />
                        Crear y descargar firmware
                      </>
                    )}
                  </Button>
                </DialogFooter>
              </div>
            )}

            {/* Success view */}
            {provisioned && (
              <div className="flex flex-col gap-4 py-2">
                <div className="flex items-center gap-2 rounded-lg border border-chart-2/30 bg-chart-2/5 p-3 text-sm text-chart-2">
                  <CheckCircle2 className="h-5 w-5 shrink-0" />
                  <span className="font-medium">
                    Dispositivo creado y firmware descargado
                  </span>
                </div>

                <div className="rounded-lg border border-border bg-muted/30 p-4">
                  <h4 className="mb-3 text-sm font-semibold text-foreground">
                    Datos del dispositivo
                  </h4>
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Codigo</span>
                      <code className="rounded bg-secondary px-2 py-0.5 text-xs font-mono text-foreground">
                        {provisioned.device_code}
                      </code>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Nombre</span>
                      <span className="text-xs text-foreground">
                        {provisioned.device_name}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Red WiFi</span>
                      <span className="text-xs text-foreground">{wifiSsid}</span>
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border border-chart-3/30 bg-chart-3/5 p-4">
                  <div className="mb-2 flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 text-chart-3" />
                    <span className="text-sm font-semibold text-chart-3">
                      Pasos siguientes
                    </span>
                  </div>
                  <ol className="flex flex-col gap-1.5 text-xs text-muted-foreground">
                    <li>
                      {"1. Abre el archivo"}{" "}
                      <code className="rounded bg-secondary px-1 text-foreground">
                        neurosense_{provisioned.device_code}.ino
                      </code>{" "}
                      {"en Arduino IDE."}
                    </li>
                    <li>
                      {"2. Instala el board ESP8266 desde"}{" "}
                      <span className="text-foreground">
                        Herramientas {">"} Board {">"} Boards Manager.
                      </span>
                    </li>
                    <li>
                      {"3. Instala la libreria"}{" "}
                      <span className="text-foreground">ArduinoJson</span>{" "}
                      {"desde Herramientas > Administrar Bibliotecas."}
                    </li>
                    <li>
                      {"4. Selecciona tu placa (NodeMCU 1.0 o Wemos D1 Mini)."}
                    </li>
                    <li>
                      {"5. Conecta el ESP8266 por USB y haz clic en"}{" "}
                      <span className="text-foreground">Subir</span>.
                    </li>
                    <li>
                      {"6. Abre el Monitor Serial (115200 baud) para verificar."}
                    </li>
                  </ol>
                </div>

                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => downloadFirmware(provisioned)}
                  >
                    <Download className="mr-2 h-4 w-4" />
                    Descargar de nuevo
                  </Button>
                  <Button
                    className="flex-1"
                    onClick={() => handleOpenChange(false)}
                  >
                    Finalizar
                  </Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>

      {/* Device List */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : deviceLinks.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Cpu className="mb-4 h-12 w-12 text-muted-foreground/30" />
            <h3 className="mb-2 text-lg font-semibold text-foreground">
              Sin dispositivos
            </h3>
            <p className="mb-4 text-center text-sm text-muted-foreground">
              Agrega tu primer ESP8266 para generar y descargar el firmware pre-configurado
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {deviceLinks.map((link) => (
            <Card key={link.id}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                      <Cpu className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <CardTitle className="text-base text-foreground">
                        {link.devices.device_name || link.devices.device_code}
                      </CardTitle>
                      <CardDescription className="flex items-center gap-1 text-xs">
                        <Signal className="h-3 w-3" />
                        {link.devices.device_code}
                      </CardDescription>
                    </div>
                  </div>
                  <Badge
                    variant={link.is_active ? "default" : "secondary"}
                    className="text-xs"
                  >
                    {link.is_active ? "Activo" : "Inactivo"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col gap-2 text-sm">
                  {link.child_name && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Menor</span>
                      <span className="font-medium text-foreground">
                        {link.child_name}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Estado</span>
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`h-2 w-2 rounded-full ${
                          link.devices.is_online
                            ? "bg-chart-2"
                            : "bg-muted-foreground/40"
                        }`}
                      />
                      <span className="text-xs text-foreground">
                        {link.devices.is_online ? "En linea" : "Desconectado"}
                      </span>
                    </div>
                  </div>
                  {link.devices.wifi_ssid && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">WiFi</span>
                      <div className="flex items-center gap-1">
                        <Wifi className="h-3 w-3 text-primary" />
                        <span className="text-xs text-foreground">
                          {link.devices.wifi_ssid}
                        </span>
                      </div>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Consentimiento</span>
                    <div className="flex items-center gap-1">
                      <Shield className="h-3 w-3 text-chart-2" />
                      <span className="text-xs text-chart-2">Aceptado</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Vinculado</span>
                    <div className="flex items-center gap-1">
                      <Clock className="h-3 w-3 text-muted-foreground" />
                      <span className="text-xs text-foreground">
                        {formatDate(link.created_at)}
                      </span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
