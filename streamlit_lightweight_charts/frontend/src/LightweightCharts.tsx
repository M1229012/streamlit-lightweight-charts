import { useRenderData } from "streamlit-component-lib-react-hooks"
import { createChart, IChartApi, MouseEventParams, ISeriesApi } from "lightweight-charts"
import React, { useRef, useEffect } from "react"

type SeriesMeta = {
  api: ISeriesApi<any>
  title: string
  options: any
}

type PaneMeta = {
  chart: IChartApi
  container: HTMLDivElement
  tooltip: HTMLDivElement
  series: SeriesMeta[]
}

function formatTime(t: any) {
  if (typeof t === "number") {
    const d = new Date(t * 1000)
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, "0")
    const day = String(d.getDate()).padStart(2, "0")
    return `${y}-${m}-${day}`
  }
  if (t && typeof t === "object" && "year" in t) {
    const y = t.year
    const m = String(t.month).padStart(2, "0")
    const day = String(t.day).padStart(2, "0")
    return `${y}-${m}-${day}`
  }
  return String(t ?? "")
}

function pickValue(d: any) {
  if (!d) return null
  if (typeof d === "number") return d
  if (typeof d.value === "number") return d.value
  if (typeof d.close === "number") return d.close
  return null
}

function toFixedMaybe(v: any, digits = 2) {
  if (v == null || Number.isNaN(v)) return "--"
  if (typeof v !== "number") return String(v)
  return v.toFixed(digits)
}

function ensurePaneTooltip(container: HTMLDivElement) {
  let toolTip = container.querySelector(".floating-tooltip") as HTMLDivElement | null
  if (!toolTip) {
    toolTip = document.createElement("div")
    toolTip.className = "floating-tooltip"
    Object.assign(toolTip.style, {
      position: "absolute",
      display: "none",
      padding: "8px 10px",
      fontSize: "12px",
      zIndex: "1200",
      top: "10px",
      left: "10px",
      pointerEvents: "none",
      border: "1px solid rgba(255,255,255,0.15)",
      borderRadius: "8px",
      background: "rgba(20, 20, 20, 0.88)",
      color: "#ececec",
      boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
      fontFamily:
        "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Ubuntu,'Helvetica Neue',Arial",
    })
    const style = getComputedStyle(container)
    if (style.position === "static") container.style.position = "relative"
    container.appendChild(toolTip)
  }
  return toolTip
}

function ensureGlobalVLine(host: HTMLDivElement) {
  let line = host.querySelector(".global-vline") as HTMLDivElement | null
  if (!line) {
    line = document.createElement("div")
    line.className = "global-vline"
    Object.assign(line.style, {
      position: "absolute",
      top: "0px",
      bottom: "0px",
      width: "2px",
      background: "rgba(255,255,255,0.55)", // 🔥 直線更明顯
      display: "none",
      pointerEvents: "none",
      zIndex: "2000",
      transform: "translateX(-1px)",
    })
    const style = getComputedStyle(host)
    if (style.position === "static") host.style.position = "relative"
    host.appendChild(line)
  }
  return line
}

const LightweightChartsMultiplePanes: React.VFC = () => {
  const renderData = useRenderData()
  const chartsData = renderData.args["charts"] || []

  const chartsContainerRef = useRef<HTMLDivElement>(null)
  const panes = useRef<PaneMeta[]>([])
  const chartInstances = useRef<(IChartApi | null)[]>([])
  const globalVLineRef = useRef<HTMLDivElement | null>(null)

  // 建立每個 pane DOM ref
  const chartElRefs = useRef<Array<React.RefObject<HTMLDivElement>>>(
    Array(chartsData.length)
      .fill(null)
      .map(() => React.createRef<HTMLDivElement>())
  ).current

  useEffect(() => {
    if (!chartsData?.length) return
    if (chartElRefs.some((ref) => !ref.current)) return

    // 清理舊 chart
    chartInstances.current.forEach((c) => c && c.remove())
    chartInstances.current = []
    panes.current = []

    const host = chartsContainerRef.current
    if (host) {
      globalVLineRef.current = ensureGlobalVLine(host)
      host.addEventListener("mouseleave", () => {
        panes.current.forEach((p) => (p.tooltip.style.display = "none"))
        if (globalVLineRef.current) globalVLineRef.current.style.display = "none"
      })
    }

    // 建立每個 pane
    chartElRefs.forEach((ref, i) => {
      const container = ref.current as HTMLDivElement | null
      if (!container) return

      const chart = createChart(container, {
        height: 300,
        width: container.clientWidth || 600,
        ...chartsData[i].chart,
        layout: {
          background: { type: "solid", color: "transparent" },
          textColor: "#d1d4dc",
          ...(chartsData[i].chart?.layout || {}),
        },
      })

      // ✅ 只保留主圖的 label（線本體交給 overlay 來畫）
      chart.applyOptions({
        crosshair: {
          mode: 0 as any,
          vertLine: {
            visible: i === 0,
            width: 1,
            color: "rgba(255,255,255,0.01)", // 幾乎透明：保留 label 但不搶線
            style: 0 as any,
            labelBackgroundColor: "rgba(20,20,20,0.9)",
          },
          horzLine: {
            visible: i === 0,
            width: 1,
            color: "rgba(255,255,255,0.18)",
            labelBackgroundColor: "rgba(20,20,20,0.9)",
          },
        },
      })

      chartInstances.current[i] = chart

      const tooltip = ensurePaneTooltip(container)
      panes.current[i] = { chart, container, tooltip, series: [] }

      // 加 series
      for (const s of chartsData[i].series) {
        let api: ISeriesApi<any> | null = null

        switch (s.type) {
          case "Area":
            api = chart.addAreaSeries(s.options)
            break
          case "Bar":
            api = chart.addBarSeries(s.options)
            break
          case "Baseline":
            api = chart.addBaselineSeries(s.options)
            break
          case "Candlestick":
            api = chart.addCandlestickSeries(s.options)
            break
          case "Histogram":
            api = chart.addHistogramSeries(s.options)
            break
          case "Line":
            api = chart.addLineSeries(s.options)
            break
          default:
            api = null
        }

        if (api) {
          if (s.priceScale)
            chart.priceScale(s.options?.priceScaleId || "").applyOptions(s.priceScale)

          api.setData(s.data)
          if (s.markers) api.setMarkers(s.markers)

          const opt = api.options() as any
          panes.current[i].series.push({
            api,
            title: opt.title || s.options?.title || "",
            options: opt,
          })
        }
      }

      chart.timeScale().fitContent()
    })

    const hideAll = () => {
      panes.current.forEach((p) => (p.tooltip.style.display = "none"))
      if (globalVLineRef.current) globalVLineRef.current.style.display = "none"
    }

    const updatePaneTooltip = (pane: PaneMeta, timeStr: string, logical: number) => {
      let html = `<div style="font-weight:800;font-size:13px;margin-bottom:6px;color:#fff;">${timeStr}</div>`

      pane.series.forEach((sm) => {
        const d = sm.api.dataByIndex(logical)
        if (!d) return

        const title = sm.title || ""
        const hasValue = d && typeof d === "object" && "value" in d
        if (hasValue && !title) return

        const so: any = sm.options || {}
        let color = "#fff"
        if (so.color) color = so.color
        else if (so.upColor) color = so.upColor
        else if (so.lineColor) color = so.lineColor

        // ✅ K棒（加入漲跌幅%）
        if (d.open !== undefined) {
          const candleColor = d.close >= d.open ? "#ef5350" : "#26a69a"

          // 漲跌幅%（以開盤為基準）
          const pct =
            typeof d.open === "number" && d.open !== 0 && typeof d.close === "number"
              ? ((d.close - d.open) / d.open) * 100
              : null
          const pctStr = pct == null ? "--" : `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`

          html += `
            <div style="margin-top:6px;">
              <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
                <div style="display:flex;align-items:center;">
                  <span style="width:8px;height:8px;border-radius:50%;background:${candleColor};margin-right:6px;"></span>
                  <span style="font-weight:800;color:${candleColor};">收盤: ${toFixedMaybe(d.close, 2)}</span>
                </div>
                <span style="font-family:monospace;font-weight:800;color:${candleColor};">
                  ${pctStr}
                </span>
              </div>
              <div style="font-size:11px;color:#aaa;margin-left:14px;">
                開:${toFixedMaybe(d.open,2)} 高:${toFixedMaybe(d.high,2)} 低:${toFixedMaybe(d.low,2)}
              </div>
            </div>`
          return
        }

        // 單值
        const v = pickValue(d)
        let displayValue = "--"

        if (title.includes("%")) {
          displayValue = `${toFixedMaybe(Number(v), 2)}%`
        } else if (
          title.includes("量") ||
          title.toLowerCase().includes("vol") ||
          title.includes("資") ||
          title.includes("信") ||
          title.includes("營") ||
          title.includes("戶")
        ) {
          displayValue = v == null ? "--" : `${Math.round(Number(v)).toLocaleString()} 張`
        } else {
          displayValue = v == null ? "--" : toFixedMaybe(Number(v), 2)
        }

        html += `
          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:3px;">
            <div style="display:flex;align-items:center;">
              <span style="width:6px;height:6px;border-radius:50%;background:${color};margin-right:6px;"></span>
              <span style="color:#ddd;margin-right:8px;">${title}</span>
            </div>
            <span style="font-family:monospace;font-weight:800;color:${color};">${displayValue}</span>
          </div>`
      })

      pane.tooltip.innerHTML = html
      pane.tooltip.style.display = "block"
    }

    const syncAll = (sourcePane: PaneMeta, param: MouseEventParams) => {
      const host = chartsContainerRef.current
      const vline = globalVLineRef.current

      if (!host || !vline || !param?.point || param.time == null) {
        hideAll()
        return
      }

      // 取得同一根 K 的 logical index
      const logical = sourcePane.chart.timeScale().coordinateToLogical(param.point.x)
      if (logical == null) {
        hideAll()
        return
      }

      const timeStr = formatTime(param.time)

      // ✅ 1) 畫「全域貫穿」直線（真正貫穿所有附圖）
      const hostRect = host.getBoundingClientRect()
      const srcRect = sourcePane.container.getBoundingClientRect()
      const globalX = (srcRect.left - hostRect.left) + param.point.x
      vline.style.left = `${globalX}px`
      vline.style.display = "block"

      // ✅ 2) 每個 pane 各自更新自己的 tooltip（用同一 logical）
      panes.current.forEach((p) => updatePaneTooltip(p, timeStr, logical))
    }

    // 訂閱：任何 pane 移動 → 同步到全部
    panes.current.forEach((p) => {
      p.chart.subscribeCrosshairMove((param) => syncAll(p, param))
    })

    // 同步時間縮放/拖曳
    const validCharts = chartInstances.current.filter((c): c is IChartApi => c !== null)
    if (validCharts.length > 1) {
      let syncingRange = false
      validCharts.forEach((chart) => {
        chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
          if (!range) return
          if (syncingRange) return
          syncingRange = true
          validCharts
            .filter((c) => c !== chart)
            .forEach((c) => c.timeScale().setVisibleLogicalRange(range))
          syncingRange = false
        })
      })
    }

    return () => {
      chartInstances.current.forEach((c) => c && c.remove())
      chartInstances.current = []
      panes.current = []
    }
  }, [chartsData])

  return (
    <div ref={chartsContainerRef}>
      {chartElRefs.map((ref, i) => (
        <div ref={ref} id={`chart-${i}`} key={i} />
      ))}
    </div>
  )
}

export default LightweightChartsMultiplePanes
