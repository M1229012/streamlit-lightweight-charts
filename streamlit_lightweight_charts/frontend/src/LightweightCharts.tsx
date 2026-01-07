import { useRenderData } from "streamlit-component-lib-react-hooks"
import {
  createChart,
  IChartApi,
  MouseEventParams,
  ISeriesApi,
} from "lightweight-charts"
import React, { useRef, useEffect } from "react"

type SeriesMeta = {
  api: ISeriesApi<any>
  type: string
  title: string
  options: any
}

type PaneMeta = {
  chart: IChartApi
  container: HTMLDivElement
  series: SeriesMeta[]
}

function formatTime(t: any) {
  // t 可能是 unix seconds 或 business day 物件
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

const LightweightChartsMultiplePanes: React.VFC = () => {
  const renderData = useRenderData()
  const chartsData = renderData.args["charts"] || []

  const chartsContainerRef = useRef<HTMLDivElement>(null)

  // 建立每個 pane DOM ref
  const chartElRefs = useRef<Array<React.RefObject<HTMLDivElement>>>(
    Array(chartsData.length).fill(null).map(() => React.createRef<HTMLDivElement>())
  ).current

  // chart instances
  const chartInstances = useRef<(IChartApi | null)[]>([])

  // 收集每個 pane 的 series api（用來跨面板抓同一根 K 的值）
  const panesMeta = useRef<PaneMeta[]>([])

  // 單一統一 tooltip（掛在最外層）
  const unifiedTooltipRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!chartsData?.length) return
    if (chartElRefs.some((ref) => !ref.current)) return

    // 清理舊圖
    chartInstances.current.forEach((chart) => chart && chart.remove())
    chartInstances.current = []
    panesMeta.current = []

    // 建立/取得統一 tooltip
    const host = chartsContainerRef.current
    if (host) {
      const hostStyle = getComputedStyle(host)
      if (hostStyle.position === "static") host.style.position = "relative"

      let tip = unifiedTooltipRef.current
      if (!tip) {
        tip = document.createElement("div")
        unifiedTooltipRef.current = tip
        Object.assign(tip.style, {
          position: "absolute",
          display: "none",
          zIndex: "9999",
          pointerEvents: "none",
          minWidth: "240px",
          maxWidth: "360px",
          padding: "10px 12px",
          borderRadius: "8px",
          border: "1px solid rgba(120,120,120,0.35)",
          background: "rgba(20, 20, 20, 0.92)",
          color: "#ececec",
          fontSize: "12px",
          lineHeight: "1.4",
          boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
          fontFamily:
            "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Ubuntu,'Helvetica Neue',Arial",
        })
        host.appendChild(tip)

        host.addEventListener("mouseleave", () => {
          if (unifiedTooltipRef.current) unifiedTooltipRef.current.style.display = "none"
        })
      }
    }

    // 同步鎖（防止無窮迴圈）
    let isCrosshairSyncing = false
    let isRangeSyncing = false

    // 建立每個 pane chart + series
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

      chartInstances.current[i] = chart
      panesMeta.current[i] = { chart, container, series: [] }

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
          if (s.priceScale) chart.priceScale(s.options?.priceScaleId || "").applyOptions(s.priceScale)
          api.setData(s.data)
          if (s.markers) api.setMarkers(s.markers)

          const opt = api.options() as any
          panesMeta.current[i].series.push({
            api,
            type: s.type,
            title: opt.title || s.options?.title || "",
            options: opt,
          })
        }
      }

      chart.timeScale().fitContent()

      // ---- Crosshair move：同步所有 pane 的垂直線 + 統一 tooltip ----
      chart.subscribeCrosshairMove((param: MouseEventParams) => {
        const tip = unifiedTooltipRef.current
        if (!tip || !host) return

        if (!param || !param.point || param.time == null) {
          tip.style.display = "none"
          // 清掉其他 pane 的 crosshair
          if (!isCrosshairSyncing) {
            isCrosshairSyncing = true
            chartInstances.current.forEach((c) => c && (c as any).clearCrosshairPosition?.())
            isCrosshairSyncing = false
          }
          return
        }

        const logical = chart.timeScale().coordinateToLogical(param.point.x)
        if (logical == null) {
          tip.style.display = "none"
          return
        }

        // 1) 讓十字線「往下貫穿所有附圖」：每個 pane 用相同 logical → x 對齊
        if (!isCrosshairSyncing) {
          isCrosshairSyncing = true

          panesMeta.current.forEach((pane) => {
            const x = pane.chart.timeScale().logicalToCoordinate(logical)
            if (x == null) {
              ;(pane.chart as any).clearCrosshairPosition?.()
              return
            }
            // y 用面板中間，確保一定落在面板內，垂直線就會顯示出來
            const y = Math.max(1, Math.floor(pane.container.clientHeight / 2))
            ;(pane.chart as any).moveCrosshair?.({ x, y })
          })

          isCrosshairSyncing = false
        }

        // 2) 統一 tooltip：把所有 pane、所有 series 同一根 K 的數值列出來
        const timeStr = formatTime(param.time)

        let html = `<div style="font-weight:800;font-size:13px;margin-bottom:8px;border-bottom:1px solid rgba(255,255,255,0.12);padding-bottom:6px;color:#fff;">${timeStr}</div>`

        panesMeta.current.forEach((pane, idx) => {
          const rows: string[] = []

          pane.series.forEach((sm) => {
            const d = sm.api.dataByIndex(logical)
            if (!d) return

            // 沒 title 的線（例如你說的基準線）不顯示
            const title = sm.title || ""
            const hasValue = d && typeof d === "object" && "value" in d
            if (hasValue && !title) return

            // 顏色
            const so: any = sm.options || {}
            let color = "#fff"
            if (so.color) color = so.color
            else if (so.upColor) color = so.upColor
            else if (so.lineColor) color = so.lineColor

            // K棒
            if (d.open !== undefined) {
              const candleColor = d.close >= d.open ? "#ef5350" : "#26a69a"
              rows.push(
                `<div style="margin-top:4px;">
                  <div style="display:flex;align-items:center;">
                    <span style="width:8px;height:8px;border-radius:50%;background:${candleColor};margin-right:6px;"></span>
                    <span style="font-weight:800;color:${candleColor};">收盤: ${toFixedMaybe(d.close, 2)}</span>
                  </div>
                  <div style="font-size:11px;color:#aaa;margin-left:14px;">
                    開:${toFixedMaybe(d.open,2)} 高:${toFixedMaybe(d.high,2)} 低:${toFixedMaybe(d.low,2)}
                  </div>
                </div>`
              )
              return
            }

            // 單一數值（成交量/KD/MACD/RSI...）
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
              displayValue =
                v == null ? "--" : `${Math.round(Number(v)).toLocaleString()} 張`
            } else {
              displayValue = v == null ? "--" : toFixedMaybe(Number(v), 2)
            }

            rows.push(
              `<div style="display:flex;justify-content:space-between;align-items:center;margin-top:2px;">
                <div style="display:flex;align-items:center;">
                  <span style="width:6px;height:6px;border-radius:50%;background:${color};margin-right:6px;"></span>
                  <span style="color:#ddd;margin-right:8px;">${title}</span>
                </div>
                <span style="font-family:monospace;font-weight:800;color:${color};">${displayValue}</span>
              </div>`
            )
          })

          if (rows.length) {
            html += `
              <div style="margin-top:10px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.10);">
                <div style="font-weight:800;opacity:.95;margin-bottom:4px;">Pane ${idx + 1}</div>
                ${rows.join("")}
              </div>
            `
          }
        })

        tip.innerHTML = html
        tip.style.display = "block"

        // tooltip 位置（以滑鼠 clientX/Y 來定位）
        const ev: any = (param as any).sourceEvent
        if (ev && typeof ev.clientX === "number" && typeof ev.clientY === "number") {
          const hostRect = host.getBoundingClientRect()
          const x = ev.clientX - hostRect.left
          const y = ev.clientY - hostRect.top

          const margin = 12
          const tw = tip.offsetWidth || 260
          const th = tip.offsetHeight || 180

          let left = x + margin
          if (left + tw > hostRect.width - margin) left = x - tw - margin

          let top = y + margin
          if (top + th > hostRect.height - margin) top = y - th - margin

          tip.style.left = `${Math.max(margin, left)}px`
          tip.style.top = `${Math.max(margin, top)}px`
        }
      })
    })

    // ---- 同步時間軸（拖拉/縮放） ----
    const validCharts = chartInstances.current.filter((c): c is IChartApi => c !== null)
    if (validCharts.length > 1) {
      validCharts.forEach((chart) => {
        chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
          if (!range) return
          if (isRangeSyncing) return
          isRangeSyncing = true
          validCharts.filter((c) => c !== chart).forEach((c) => c.timeScale().setVisibleLogicalRange(range))
          isRangeSyncing = false
        })
      })
    }

    // cleanup
    return () => {
      chartInstances.current.forEach((chart) => chart && chart.remove())
      chartInstances.current = []
      panesMeta.current = []
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
