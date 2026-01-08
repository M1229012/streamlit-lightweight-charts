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

// ✅ 白色半透明遮罩（主 K 線用）
function ensureRangeMask(container: HTMLDivElement) {
  let mask = container.querySelector(".range-mask") as HTMLDivElement | null
  if (!mask) {
    mask = document.createElement("div")
    mask.className = "range-mask"
    Object.assign(mask.style, {
      position: "absolute",
      top: "0px",
      bottom: "0px",
      left: "0px",
      width: "0px",
      display: "none",
      pointerEvents: "none",
      zIndex: "900",
      background: "rgba(255,255,255,0.12)",
      borderLeft: "1px solid rgba(255,255,255,0.18)",
      borderRight: "1px solid rgba(255,255,255,0.18)",
      borderRadius: "6px",
    })
    const style = getComputedStyle(container)
    if (style.position === "static") container.style.position = "relative"
    container.appendChild(mask)
  }
  return mask
}

function parseDateStrToBusinessDay(s: any) {
  if (!s || typeof s !== "string") return null
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) }
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n))
}

const LightweightChartsMultiplePanes: React.VFC = () => {
  const renderData = useRenderData()
  const chartsData = renderData.args["charts"] || []

  // ✅ 從 Streamlit 傳入：{ start: "YYYY-MM-DD", end: "YYYY-MM-DD" }
  // 你可以用 highlightRange 或 highlight_range 兩種 key（二擇一）
  const highlightRange =
    renderData.args["highlightRange"] ||
    renderData.args["highlight_range"] ||
    null

  const chartsContainerRef = useRef<HTMLDivElement>(null)
  const panes = useRef<PaneMeta[]>([])
  const chartInstances = useRef<(IChartApi | null)[]>([])
  const globalVLineRef = useRef<HTMLDivElement | null>(null)

  // ✅ 主 K 線遮罩 DOM
  const rangeMaskRef = useRef<HTMLDivElement | null>(null)

  // ✅ 十字線吸附：避免同一根 K 重複更新
  const lastLogicalRef = useRef<number | null>(null)

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
    rangeMaskRef.current = null
    lastLogicalRef.current = null

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

      // ✅ 主 K 線（pane 0）建立遮罩容器
      if (i === 0) {
        rangeMaskRef.current = ensureRangeMask(container)
      }

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

    // ✅ 更新「主圖遮罩」位置
    const updateRangeMask = () => {
      const mask = rangeMaskRef.current
      if (!mask) return
      if (!highlightRange || !highlightRange.start || !highlightRange.end) {
        mask.style.display = "none"
        return
      }

      const p0 = panes.current[0]
      if (!p0) {
        mask.style.display = "none"
        return
      }

      const startBD = parseDateStrToBusinessDay(highlightRange.start)
      const endBD = parseDateStrToBusinessDay(highlightRange.end)
      if (!startBD || !endBD) {
        mask.style.display = "none"
        return
      }

      const x1 = p0.chart.timeScale().timeToCoordinate(startBD as any)
      const x2 = p0.chart.timeScale().timeToCoordinate(endBD as any)

      if (x1 == null || x2 == null) {
        mask.style.display = "none"
        return
      }

      const w = p0.container.clientWidth || 0
      const left = clamp(Math.min(x1, x2), 0, w)
      const right = clamp(Math.max(x1, x2), 0, w)
      const width = Math.max(0, right - left)

      mask.style.left = `${left}px`
      mask.style.width = `${width}px`
      mask.style.display = width > 0 ? "block" : "none"
    }

    const syncAll = (sourcePane: PaneMeta, param: MouseEventParams) => {
      const host = chartsContainerRef.current
      const vline = globalVLineRef.current

      if (!host || !vline || !param?.point || param.time == null) {
        hideAll()
        return
      }

      // ✅ 十字線吸附：coordinateToLogical 可能是小數 → 四捨五入成「一天一根」
      const rawLogical = sourcePane.chart.timeScale().coordinateToLogical(param.point.x)
      if (rawLogical == null) {
        hideAll()
        return
      }
      const logical = Math.round(rawLogical)

      // ✅ 同一根 K 不重複刷新（讓移動更像「一格一格」）
      if (lastLogicalRef.current === logical) {
        return
      }
      lastLogicalRef.current = logical

      // ✅ 用主圖的 candle time 當作顯示日期（避免 param.time 被滑鼠連續影響）
      const p0 = panes.current[0]
      let timeStr = formatTime(param.time)
      if (p0?.series?.length) {
        const d0 = p0.series[0].api.dataByIndex(logical) as any
        if (d0?.time != null) timeStr = formatTime(d0.time)
      }

      // ✅ 垂直線也吸附到該根 K 的 x（避免跟著滑鼠「滑動」）
      const snappedX = sourcePane.chart.timeScale().logicalToCoordinate(logical)
      if (snappedX == null) {
        hideAll()
        return
      }

      // ✅ 1) 畫「全域貫穿」直線
      const hostRect = host.getBoundingClientRect()
      const srcRect = sourcePane.container.getBoundingClientRect()
      const globalX = (srcRect.left - hostRect.left) + snappedX
      vline.style.left = `${globalX}px`
      vline.style.display = "block"

      // ✅ 2) 每個 pane 更新 tooltip（同一 logical）
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

          // ✅ 縮放/拖曳後同步更新遮罩位置
          updateRangeMask()
        })
      })
    }

    // ✅ 初次建立後也要畫一次遮罩
    updateRangeMask()

    // ✅ window resize 時重新計算遮罩位置（避免寬度變了遮罩不對）
    const onResize = () => updateRangeMask()
    window.addEventListener("resize", onResize)

    return () => {
      window.removeEventListener("resize", onResize)
      chartInstances.current.forEach((c) => c && c.remove())
      chartInstances.current = []
      panes.current = []
    }
  }, [chartsData, highlightRange])

  return (
    <div ref={chartsContainerRef}>
      {chartElRefs.map((ref, i) => (
        <div ref={ref} id={`chart-${i}`} key={i} />
      ))}
    </div>
  )
}

export default LightweightChartsMultiplePanes
