"use client"

import { useDevices } from "@/hooks/use-devices"
import { useRealtimeSensorData, useRealtimeAlerts } from "@/hooks/use-realtime"
import { DeviceSelector } from "@/components/device-selector"
import { StressGauge } from "@/components/stress-gauge"
import { MetricCard } from "@/components/metric-card"
import { SensorChart } from "@/components/sensor-chart"
import { StressTimeline } from "@/components/stress-timeline"
import { RecentAlerts } from "@/components/recent-alerts"
import { Zap, Volume2, Activity, Cpu, Timer } from "lucide-react"
import Link from "next/link"
import { Button } from "@/components/ui/button"

export default function DashboardPage() {
  const { activeDevice, loading, deviceLinks } = useDevices()
  const deviceId = activeDevice?.devices.id ?? null

  const { data: sensorData, latestReading } = useRealtimeSensorData(deviceId)
  const { alerts } = useRealtimeAlerts(deviceId)

  if (loading) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <div className="text-center">
          <Cpu className="mx-auto mb-3 h-8 w-8 animate-pulse text-primary" />
          <p className="text-muted-foreground">Cargando panel...</p>
        </div>
      </div>
    )
  }

  if (deviceLinks.length === 0) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <div className="text-center">
          <Cpu className="mx-auto mb-4 h-12 w-12 text-muted-foreground/30" />
          <h2 className="mb-2 text-xl font-semibold text-foreground">
            No hay dispositivos vinculados
          </h2>
          <p className="mb-6 text-muted-foreground">
            Agrega tu primer ESP8266 para descargar el firmware y comenzar a monitorear.
          </p>
          <Button asChild>
            <Link href="/dashboard/devices">Vincular dispositivo</Link>
          </Button>
        </div>
      </div>
    )
  }

  const gsrValue = latestReading ? (latestReading.gsr * 100).toFixed(1) : "--"
  const soundValue = latestReading ? (latestReading.sound * 100).toFixed(1) : "--"
  const accelMag = latestReading
    ? Math.sqrt(
        latestReading.accel_x ** 2 +
        latestReading.accel_y ** 2 +
        latestReading.accel_z ** 2
      ).toFixed(2)
    : "--"

  // Compute trend from last few readings
  const getTrend = (key: "gsr" | "sound" | "stress_index") => {
    if (sensorData.length < 5) return { trend: "stable" as const, value: "" }
    const recent = sensorData.slice(-5)
    const older = sensorData.slice(-10, -5)
    if (older.length === 0) return { trend: "stable" as const, value: "" }
    const recentAvg = recent.reduce((s, d) => s + (d[key] ?? 0), 0) / recent.length
    const olderAvg = older.reduce((s, d) => s + (d[key] ?? 0), 0) / older.length
    const change = ((recentAvg - olderAvg) / (olderAvg || 1)) * 100
    if (Math.abs(change) < 5) return { trend: "stable" as const, value: `${change >= 0 ? "+" : ""}${change.toFixed(0)}%` }
    return {
      trend: change > 0 ? ("up" as const) : ("down" as const),
      value: `${change >= 0 ? "+" : ""}${change.toFixed(0)}%`,
    }
  }

  const gsrTrend = getTrend("gsr")
  const soundTrend = getTrend("sound")

  // Calculate average latency from recent readings
  const latencyReadings = sensorData.filter((d) => d.latency_ms !== null && d.latency_ms !== undefined)
  const avgLatency =
    latencyReadings.length > 0
      ? Math.round(latencyReadings.slice(-10).reduce((s, d) => s + (d.latency_ms ?? 0), 0) / Math.min(latencyReadings.length, 10))
      : null
  const latestLatency = latestReading?.latency_ms ?? null

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Panel de Monitoreo</h1>
          <p className="text-sm text-muted-foreground">
            {activeDevice?.child_name
              ? `Monitoreando a ${activeDevice.child_name}`
              : "Datos sensoriales en tiempo real"}
          </p>
        </div>
        <DeviceSelector />
      </div>

      {/* Top Row: Stress Gauge + Metric Cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
        <StressGauge
          value={latestReading?.stress_index ?? null}
          className="md:row-span-2"
        />
        <MetricCard
          title="GSR (Conductancia)"
          value={`${gsrValue}%`}
          subtitle="de la escala"
          trend={gsrTrend.trend}
          trendValue={gsrTrend.value}
          icon={<Zap className="h-4 w-4" style={{ color: "#60a5fa" }} />}
          color="#60a5fa"
        />
        <MetricCard
          title="Sonido Ambiental"
          value={`${soundValue}%`}
          subtitle="del rango"
          trend={soundTrend.trend}
          trendValue={soundTrend.value}
          icon={<Volume2 className="h-4 w-4" style={{ color: "#4ade80" }} />}
          color="#4ade80"
        />
        <MetricCard
          title="Aceleracion"
          value={accelMag}
          subtitle="magnitud (g)"
          icon={<Activity className="h-4 w-4" style={{ color: "#f97316" }} />}
          color="#f97316"
        />
        <MetricCard
          title="Latencia ESP8266"
          value={latestLatency !== null ? `${latestLatency}ms` : "--"}
          subtitle={avgLatency !== null ? `promedio: ${avgLatency}ms` : "sin datos"}
          icon={<Timer className="h-4 w-4" style={{ color: "#a78bfa" }} />}
          color="#a78bfa"
        />
      </div>

      {/* Stress timeline */}
      <StressTimeline data={sensorData} />

      {/* Sensor Charts + Alerts */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <SensorChart
          data={sensorData}
          title="Conductancia Cutanea (GSR)"
          dataKey="gsr"
          color="#60a5fa"
          threshold={0.7}
          thresholdLabel="Umbral alto"
          className="lg:col-span-1"
        />
        <SensorChart
          data={sensorData}
          title="Nivel de Sonido"
          dataKey="sound"
          color="#4ade80"
          threshold={0.8}
          thresholdLabel="Pico >70dB"
          className="lg:col-span-1"
        />
        <RecentAlerts alerts={alerts} className="lg:col-span-1" />
      </div>

      {/* Accel Chart */}
      <SensorChart
        data={sensorData}
        title="Aceleracion (Magnitud)"
        dataKey="accel_magnitude"
        color="#f97316"
        threshold={0.7}
        thresholdLabel="Movimiento alto"
      />


    </div>
  )
}
