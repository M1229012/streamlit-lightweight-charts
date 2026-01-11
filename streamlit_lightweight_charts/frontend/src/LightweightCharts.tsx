import { useRenderData } from "streamlit-component-lib-react-hooks"
import { createChart, IChartApi, MouseEventParams, ISeriesApi } from "lightweight-charts"
import React, { useRef, useEffect, useMemo, useState } from "react"

// ====================================================================
// 1. 輔助函式：統一日期處理
// ====================================================================

function normalizeDate(d: any): number | null {
  if (d == null) return null
  if (typeof d === "number") return d
  if (typeof d === "string") {
    const dateObj = new Date(d)
    if (!isNaN(dateObj.getTime())) {
      return dateObj.getTime() / 1000
    }
    return null
  }
  if (typeof d === "object" && "year" in d && "month" in d && "day" in d) {
    const dateObj = new Date(d.year, d.month - 1, d.day)
    return dateObj.getTime() / 1000
  }
  return null
}

function formatTime(t: any) {
  if (t == null) return ""
  if (typeof t === "number") {
    const d = new Date(t * 1000)
    return d.toISOString().split("T")[0]
  }
  if (typeof t === "object" && "year" in t) {
    const y = t.year
    const m = String(t.month).padStart(2, "0")
    const d = String(t.day).padStart(2, "0")
    return `${y}-${m}-${d}`
  }
  return String(t)
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

// ====================================================================
// 2. DOM 元素建立 (Tooltip, VLine, Mask)
// ====================================================================

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
      zIndex: "1000",
      top: "10px",
      left: "10px",
      pointerEvents: "none",
      border: "1px solid rgba(255,255,255,0.15)",
      borderRadius: "4px",
      background: "rgba(20, 20, 20, 0.9)",
      color: "#ececec",
      boxShadow: "0 2px 5px rgba(0,0,0,0.5)",
      fontFamily: "monospace",
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
      width: "1px",
      background: "rgba(255,255,255,0.3)",
      display: "none",
      pointerEvents: "none",
      zIndex: "900",
      transform: "translateX(-0.5px)",
    })
    const style = getComputedStyle(host)
    if (style.position === "static") host.style.position = "relative"
    host.appendChild(line)
  }
  return line
}

function ensureGlobalMask(host: HTMLDivElement) {
  let mask = host.querySelector(".global-mask") as HTMLDivElement | null
  if (!mask) {
    mask = document.createElement("div")
    mask.className = "global-mask"
    Object.assign(mask.style, {
      position: "absolute",
      top: "0px",
      bottom: "0px",
      left: "0px",
      width: "0px",
      display: "none",
      pointerEvents: "none",
      zIndex: "800",
      background: "rgba(255, 235, 59, 0.15)",
      borderLeft: "1px solid rgba(255, 235, 59, 0.4)",
      borderRight: "1px solid rgba(255, 235, 59, 0.4)",
    })
    const style = getComputedStyle(host)
    if (style.position === "static") host.style.position = "relative"
    host.appendChild(mask)
  }
  return mask
}

// ====================================================================
// 3. 畫線工具型別定義 (新增)
// ====================================================================

type Point = {
  time: number // Timestamp
  price: number
}

type DrawingLine = {
  id: string
  p1: Point
  p2: Point
}

// ====================================================================
// 4. React Component
// ====================================================================

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

const LightweightChartsMultiplePanes: React.VFC = () => {
  const renderData = useRenderData()
  const chartsData = renderData.args["charts"] || []

  const chartsContainerRef = useRef<HTMLDivElement>(null)
  const panes = useRef<PaneMeta[]>([])
  const chartInstances = useRef<(IChartApi | null)[]>([])
  const globalVLineRef = useRef<HTMLDivElement | null>(null)
  const globalMaskRef = useRef<HTMLDivElement | null>(null)

  // 儲存主圖的時間序列
  const primaryTimesRef = useRef<number[]>([])

  // --- 畫線功能 State (新增) ---
  const [isDrawingMode, setIsDrawingMode] = useState(false)
  const [drawings, setDrawings] = useState<DrawingLine[]>([])
  const [tempStartPoint, setTempStartPoint] = useState<Point | null>(null)
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null)
  // 用來強制刷新 SVG (當圖表捲動時)
  const [renderTick, setRenderTick] = useState(0)

  const chartElRefs = useMemo(() => {
    return Array(chartsData.length)
      .fill(null)
      .map(() => React.createRef<HTMLDivElement>())
  }, [chartsData.length])

  // 監聽 highlightRange
  const highlightRangeSig = useMemo(() => {
    const hr = (renderData.args?.["charts"]?.[0] as any)?.highlightRange
    if (!hr) return ""
    return `${hr.start}|${hr.end}`
  }, [renderData.args])

  // =========================================================
  // 核心邏輯：計算並繪製遮罩
  // =========================================================
  const updateGlobalMask = () => {
    const host = chartsContainerRef.current
    const mask = globalMaskRef.current
    if (!host || !mask) return

    const hr = chartsData?.[0]?.highlightRange
    const times = primaryTimesRef.current

    if (!hr || !hr.start || !hr.end || !times || times.length === 0 || panes.current.length === 0) {
      mask.style.display = "none"
      return
    }

    const tStart = normalizeDate(hr.start)
    const tEnd = normalizeDate(hr.end)

    if (tStart === null || tEnd === null) {
      mask.style.display = "none"
      return
    }

    let startIdx = -1
    for (let i = 0; i < times.length; i++) {
      if (times[i] >= tStart) {
        startIdx = i
        break
      }
    }

    let endIdx = -1
    for (let i = times.length - 1; i >= 0; i--) {
      if (times[i] <= tEnd) {
        endIdx = i
        break
      }
    }

    if (startIdx === -1 || endIdx === -1 || startIdx > endIdx) {
      mask.style.display = "none"
      return
    }

    const p0 = panes.current[0]
    const timeScale = p0.chart.timeScale()

    const x1 = timeScale.logicalToCoordinate(startIdx as any)
    const x2 = timeScale.logicalToCoordinate(endIdx as any)

    const safeX1 = x1 ?? -100000
    const safeX2 = x2 ?? -100000

    if (!Number.isFinite(safeX1) || !Number.isFinite(safeX2)) {
      mask.style.display = "none"
      return
    }

    const hostRect = host.getBoundingClientRect()
    const paneRect = p0.container.getBoundingClientRect()
    const offsetX = paneRect.left - hostRect.left

    const padding = 3
    const left = Math.min(safeX1, safeX2) - padding
    const right = Math.max(safeX1, safeX2) + padding

    const styleLeft = offsetX + left
    const styleWidth = right - left

    if (!Number.isFinite(styleLeft) || !Number.isFinite(styleWidth) || styleWidth <= 0) {
      mask.style.display = "none"
      return
    }

    mask.style.display = "block"
    mask.style.left = `${styleLeft}px`
    mask.style.width = `${styleWidth}px`
  }

  // =========================================================
  // 初始化 Chart
  // =========================================================
  useEffect(() => {
    if (!chartsData?.length) return
    if (chartElRefs.some((ref) => !ref.current)) return

    chartInstances.current.forEach((c) => c && c.remove())
    chartInstances.current = []
    panes.current = []
    primaryTimesRef.current = []

    const host = chartsContainerRef.current
    if (host) {
      globalVLineRef.current = ensureGlobalVLine(host)
      globalMaskRef.current = ensureGlobalMask(host)

      const mouseLeaveHandler = () => {
        panes.current.forEach((p) => (p.tooltip.style.display = "none"))
        if (globalVLineRef.current) globalVLineRef.current.style.display = "none"
      }
      host.addEventListener("mouseleave", mouseLeaveHandler)
      return () => host.removeEventListener("mouseleave", mouseLeaveHandler)
    }
  }, [chartsData.length])

  // =========================================================
  // 建立/更新 Series 與 Data
  // =========================================================
  useEffect(() => {
    if (!chartsData?.length) return

    chartInstances.current.forEach((c) => c && c.remove())
    chartInstances.current = []
    panes.current = []
    primaryTimesRef.current = []

    chartElRefs.forEach((ref, i) => {
      const container = ref.current
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
        rightPriceScale: {
          visible: true,
          minimumWidth: 70,
          borderColor: "rgba(197, 203, 206, 0.8)",
          ...(chartsData[i].chart?.rightPriceScale || {}),
        },
        timeScale: {
          timeVisible: true,
          secondsVisible: false,
          ...(chartsData[i].chart?.timeScale || {}),
        },
      })

      chart.applyOptions({
        crosshair: {
          mode: 1,
          vertLine: {
            visible: false,
            labelBackgroundColor: "#4c525e",
          },
          horzLine: {
            visible: true,
            labelBackgroundColor: "#4c525e",
          },
        },
      })

      chartInstances.current[i] = chart
      const tooltip = ensurePaneTooltip(container)
      panes.current[i] = { chart, container, tooltip, series: [] }

      for (const s of chartsData[i].series) {
        let api: ISeriesApi<any> | null = null
        switch (s.type) {
          case "Candlestick":
            api = chart.addCandlestickSeries(s.options)
            break
          case "Histogram":
            api = chart.addHistogramSeries(s.options)
            break
          case "Line":
            api = chart.addLineSeries(s.options)
            break
          case "Area":
            api = chart.addAreaSeries(s.options)
            break
          case "Bar":
            api = chart.addBarSeries(s.options)
            break
          case "Baseline":
            api = chart.addBaselineSeries(s.options)
            break
        }

        if (api) {
          if (s.priceScale) chart.priceScale(s.options?.priceScaleId || "").applyOptions(s.priceScale)

          api.setData(s.data)
          if (s.markers) api.setMarkers(s.markers)

          if (i === 0 && s.type === "Candlestick" && Array.isArray(s.data)) {
            primaryTimesRef.current = s.data
              .map((d: any) => normalizeDate(d.time))
              .filter((t): t is number => t !== null)
          }

          panes.current[i].series.push({
            api,
            title: (api.options() as any).title || s.options?.title || "",
            options: api.options(),
          })
        }
      }

      chart.timeScale().fitContent()

      // ✅ 新增：訂閱可見範圍變更，強制 React 重新渲染 SVG 線條
      chart.timeScale().subscribeVisibleLogicalRangeChange(() => {
        setRenderTick((t) => t + 1)
        requestAnimationFrame(updateGlobalMask)
      })
    })

    // =========================================================
    // 事件同步邏輯
    // =========================================================

    const syncCrosshair = (sourceChart: IChartApi, param: MouseEventParams, sourcePaneIndex: number) => {
      const vline = globalVLineRef.current
      const host = chartsContainerRef.current
      if (!vline || !host || !param.point || !param.time) {
        panes.current.forEach((p) => (p.tooltip.style.display = "none"))
        if (vline) vline.style.display = "none"
        return
      }

      const sourcePane = panes.current[sourcePaneIndex]
      const rawX = sourcePane.chart.timeScale().timeToCoordinate(param.time)
      if (rawX === null) return

      const hostRect = host.getBoundingClientRect()
      const srcRect = sourcePane.container.getBoundingClientRect()
      const absoluteX = srcRect.left - hostRect.left + rawX

      vline.style.left = `${absoluteX}px`
      vline.style.display = "block"

      panes.current.forEach((target, idx) => {
        const timeStr = formatTime(param.time)
        const logical = sourceChart.timeScale().coordinateToLogical(param.point!.x)
        if (logical !== null) {
          updatePaneTooltip(target, timeStr, Math.round(logical))
        }

        if (idx !== sourcePaneIndex) {
          target.chart.setCrosshairPosition(0, param.time!, target.series[0]?.api)
        }
      })
    }

    panes.current.forEach((p, idx) => {
      p.chart.subscribeCrosshairMove((param) => syncCrosshair(p.chart, param, idx))
    })

    const validCharts = chartInstances.current.filter((c): c is IChartApi => c !== null)
    if (validCharts.length > 1) {
      let isSyncing = false
      validCharts.forEach((chart) => {
        chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
          if (!range || isSyncing) return
          isSyncing = true
          validCharts
            .filter((c) => c !== chart)
            .forEach((c) => c.timeScale().setVisibleLogicalRange(range))
          isSyncing = false
        })
      })
    }

    setTimeout(updateGlobalMask, 100)

    const ro = new ResizeObserver(() => {
      panes.current.forEach((p) => p.chart.resize(p.container.clientWidth, 300))
      updateGlobalMask()
      // Resize 也需要重繪 SVG
      setRenderTick((t) => t + 1)
    })
    if (chartsContainerRef.current) ro.observe(chartsContainerRef.current)

    return () => {
      ro.disconnect()
      chartInstances.current.forEach((c) => c && c.remove())
    }
  }, [chartsData])

  useEffect(() => {
    updateGlobalMask()
  }, [highlightRangeSig])

  // =========================================================
  // 畫線邏輯處理 (新增)
  // =========================================================

  // 1. 將螢幕座標轉為 Chart 邏輯座標
  const getChartPoint = (e: React.MouseEvent<HTMLDivElement>): Point | null => {
    if (panes.current.length === 0) return null
    
    // 我們假設畫線主要在第一張圖 (主圖)
    const pane = panes.current[0] 
    const rect = pane.container.getBoundingClientRect()
    
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    const timeScale = pane.chart.timeScale()
    const series = pane.series[0]?.api // 取得主序列來計算價格

    if (!series) return null

    const time = timeScale.coordinateToTime(x)
    const price = series.coordinateToPrice(y)

    // normalize time
    const normalizedTime = normalizeDate(time)

    if (normalizedTime === null || price === null) return null
    return { time: normalizedTime, price }
  }

  // 2. 點擊處理
  const handlePaneClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDrawingMode) return

    const point = getChartPoint(e)
    if (!point) return

    if (!tempStartPoint) {
      // 第一點
      setTempStartPoint(point)
    } else {
      // 第二點：完成畫線
      const newLine: DrawingLine = {
        id: Date.now().toString(),
        p1: tempStartPoint,
        p2: point,
      }
      setDrawings((prev) => [...prev, newLine])
      setTempStartPoint(null)
      // 可以選擇畫完一條就退出模式，或者繼續畫，這裡選擇繼續畫
    }
  }

  // 3. 滑鼠移動 (為了預覽線)
  const handlePaneMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDrawingMode) return
    const rect = e.currentTarget.getBoundingClientRect()
    setMousePos({ x: e.clientX - rect.left, y: e.clientY - rect.top })
  }

  // 4. 計算 SVG 線條座標
  const getLineCoordinates = (p1: Point, p2: Point) => {
    if (panes.current.length === 0) return null
    const pane = panes.current[0]
    const timeScale = pane.chart.timeScale()
    const series = pane.series[0]?.api

    if (!series) return null

    const x1 = timeScale.timeToCoordinate(p1.time as any)
    const y1 = series.priceToCoordinate(p1.price)
    const x2 = timeScale.timeToCoordinate(p2.time as any)
    const y2 = series.priceToCoordinate(p2.price)

    if (x1 === null || y1 === null || x2 === null || y2 === null) return null
    return { x1, y1, x2, y2 }
  }

  // 5. 渲染預覽線
  const renderPreviewLine = () => {
    if (!tempStartPoint || !mousePos || panes.current.length === 0) return null
    
    const pane = panes.current[0]
    const timeScale = pane.chart.timeScale()
    const series = pane.series[0]?.api
    if (!series) return null

    const x1 = timeScale.timeToCoordinate(tempStartPoint.time as any)
    const y1 = series.priceToCoordinate(tempStartPoint.price)
    
    // 第二點直接用滑鼠位置，比較流暢
    const x2 = mousePos.x
    const y2 = mousePos.y

    if(x1 === null || y1 === null) return null

    return (
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke="#2962FF"
        strokeWidth="2"
        strokeDasharray="4"
      />
    )
  }

  return (
    <div>
      {/* 畫線工具列 */}
      <div style={{ marginBottom: "10px", display: "flex", gap: "10px" }}>
        <button
          onClick={() => {
            setIsDrawingMode(!isDrawingMode)
            setTempStartPoint(null) // 切換模式時重置
          }}
          style={{
            padding: "5px 10px",
            background: isDrawingMode ? "#2962FF" : "#444",
            color: "#fff",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer",
          }}
        >
          {isDrawingMode ? "Exit Drawing Mode" : "Draw Trend Line"}
        </button>
        {drawings.length > 0 && (
          <button
            onClick={() => setDrawings([])}
            style={{
              padding: "5px 10px",
              background: "#D32F2F",
              color: "#fff",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
            }}
          >
            Clear Drawings
          </button>
        )}
      </div>

      <div ref={chartsContainerRef} style={{ position: "relative" }}>
        {chartElRefs.map((ref, i) => (
          <div 
            ref={ref} 
            key={i} 
            className="chart-pane" 
            style={{ position: 'relative' }} // 確保相對定位
            // 只有主圖 (Index 0) 支援畫線互動
            onClick={i === 0 ? handlePaneClick : undefined}
            onMouseMove={i === 0 ? handlePaneMouseMove : undefined}
          >
            {/* SVG Overlay Layer (只加在主圖) */}
            {i === 0 && (
              <svg
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: "100%",
                  zIndex: 1001, // 比 Tooltip 高或低可自行調整，這裡設高一點確保可互動
                  pointerEvents: isDrawingMode ? "auto" : "none", // 繪圖模式下才接收滑鼠事件
                  overflow: "hidden"
                }}
              >
                {/* 已完成的線 */}
                {drawings.map((d) => {
                  const coords = getLineCoordinates(d.p1, d.p2)
                  if (!coords) return null
                  return (
                    <line
                      key={d.id}
                      x1={coords.x1}
                      y1={coords.y1}
                      x2={coords.x2}
                      y2={coords.y2}
                      stroke="#2962FF"
                      strokeWidth="2"
                    />
                  )
                })}
                {/* 預覽線 */}
                {isDrawingMode && renderPreviewLine()}
              </svg>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// Helper for tooltip content generation (Keep logic same as before)
const updatePaneTooltip = (pane: PaneMeta, timeStr: string, logical: number) => {
  let html = `<div style="font-weight:bold;margin-bottom:4px;">${timeStr}</div>`
  pane.series.forEach((s) => {
    const data = s.api.dataByIndex(logical) as any
    if (!data) return

    let valStr = "--"
    let color = "#fff"
    const opts = s.options as any

    if (data.close !== undefined) {
      // Candlestick
      const isUp = data.close >= data.open
      color = isUp ? opts.upColor : opts.downColor
      valStr = `O:${toFixedMaybe(data.open)} H:${toFixedMaybe(data.high)} L:${toFixedMaybe(
        data.low
      )} C:${toFixedMaybe(data.close)}`
    } else if (data.value !== undefined) {
      // Line / Histogram
      valStr = toFixedMaybe(data.value)
      if (data.color) color = data.color
      else if (opts.color) color = opts.color
      else if (opts.lineColor) color = opts.lineColor
    }

    html += `<div style="display:flex;justify-content:space-between;gap:10px;color:${color}">
            <span>${s.title}</span>
            <span style="font-family:monospace">${valStr}</span>
        </div>`
  })
  pane.tooltip.innerHTML = html
  pane.tooltip.style.display = "block"
}

export default LightweightChartsMultiplePanes