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
      width: "auto",
      height: "auto",
      position: "absolute",
      display: "none",
      padding: "8px 10px",
      boxSizing: "border-box",
      fontSize: "12px",
      textAlign: "left",
      zIndex: "1000",
      top: "10px",
      left: "10px",
      pointerEvents: "none",
      border: "1px solid rgba(255,255,255,0.15)",
      borderRadius: "8px",
      fontFamily:
        "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Ubuntu,'Helvetica Neue',Arial",
      background: "rgba(20, 20, 20, 0.88)",
      color: "#ececec",
      boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
    })
    container.style.position = "relative"
    container.appendChild(toolTip)
  }
  return toolTip
}

const LightweightChartsMultiplePanes: React.VFC = () => {
  const renderData = useRenderData()
  const chartsData = renderData.args["charts"] || []

  const chartsContainerRef = useRef<HTMLDivElement>(null)

  const chartElRefs = useRef<Array<React.RefObject<HTMLDivElement>>>(
    Array(chartsData.length)
      .fill(null)
      .map(() => React.createRef<HTMLDivElement>())
  ).current

  const chartInstances = useRef<(IChartApi | null)[]>([])
  const panes = useRef<PaneMeta[]>([])

  useEffect(() => {
    if (!chartsData?.length) return
    if (chartElRefs.some((ref) => !ref.current)) return

    // 清掉舊 chart
    chartInstances.current.forEach((c) => c && c.remove())
    chartInstances.current = []
    panes.current = []

    let isSyncing = false

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

      // ✅ 讓垂直十字線更明顯（重點）
      chart.applyOptions({
        crosshair: {
          // 0=Normal, 1=Magnet（不想吸附就用 0）
          mode: 0 as any,
          vertLine: {
            visible: true,
            width: 2, // 🔥 加粗
            color: "rgba(255,255,255,0.35)", // 🔥 更亮
            style: 0 as any, // 0=solid
            labelBackgroundColor: "rgba(20,20,20,0.9)",
          },
          // 副圖通常不用水平線，避免雜亂；主圖可以留
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
            chart
              .priceScale(s.options?.priceScaleId || "")
              .applyOptions(s.priceScale)

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

    // ✅ 統一用 logical index：同步十字線 + 更新每個 pane 自己的 tooltip
    const hideAll = () => {
      panes.current.forEach((p) => (p.tooltip.style.display = "none"))
      chartInstances.current.forEach((c) => c && (c as any).clearCrosshairPosition?.())
    }

    const updatePaneTooltip = (pane: PaneMeta, timeStr: string, logical: number) => {
      let html =
        `<div style="font-weight:800;font-size:13px;margin-bottom:6px;color:#fff;">${timeStr}</div>`

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

        // K棒 OHLC
        if (d.open !== undefined) {
          const candleColor = d.close >= d.open ? "#ef5350" : "#26a69a"
          html += `
            <div style="margin-top:6px;">
              <div style="display:flex;align-items:center;">
                <span style="width:8px;height:8px;border-radius:50%;background:${candleColor};margin-right:6px;"></span>
                <span style="font-weight:800;color:${candleColor};">收盤: ${toFixedMaybe(d.close, 2)}</span>
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

    const syncToLogical = (sourceChart: IChartApi, param: MouseEventParams) => {
      if (!param?.point || param.time == null) {
        hideAll()
        return
      }

      const logical = sourceChart.timeScale().coordinateToLogical(param.point.x)
      if (logical == null) {
        hideAll()
        return
      }

      const timeStr = formatTime(param.time)

      // 1) 十字線貫穿同步（每個 pane 用同一 logical 換 x）
      if (!isSyncing) {
        isSyncing = true
        panes.current.forEach((pane) => {
          const x = pane.chart.timeScale().logicalToCoordinate(logical)
          if (x == null) {
            ;(pane.chart as any).clearCrosshairPosition?.()
            return
          }
          const y = Math.max(1, Math.floor(pane.container.clientHeight / 2))
          ;(pane.chart as any).moveCrosshair?.({ x, y })
        })
        isSyncing = false
      }

      // 2) 每個 pane 各自更新自己的 tooltip（不再擠同一個）
      panes.current.forEach((pane) => updatePaneTooltip(pane, timeStr, logical))
    }

    // 訂閱每個 chart 的 crosshair move（任何一個動，都同步全體）
    panes.current.forEach((pane) => {
      pane.chart.subscribeCrosshairMove((param) => syncToLogical(pane.chart, param))
    })

    // 同步時間範圍（縮放/拖拉）
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

    // cleanup
    return () => {
      panes.current.forEach((pane) => {
        try {
          pane.chart.unsubscribeCrosshairMove(() => {})
        } catch {}
      })
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
