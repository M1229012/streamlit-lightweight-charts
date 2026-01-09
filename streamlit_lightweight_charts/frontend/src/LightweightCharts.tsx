import { useRenderData } from "streamlit-component-lib-react-hooks"
import { createChart, IChartApi, MouseEventParams, ISeriesApi } from "lightweight-charts"
import React, { useRef, useEffect, useMemo } from "react"

// ====================================================================
// 1. 輔助函式：統一日期處理 (解決 String vs Object 比較失敗的問題)
// ====================================================================

// 將任何格式的日期 (String 'YYYY-MM-DD', Object {year,month,day}, Number timestamp)
// 統一轉換為 UNIX Timestamp (秒) 以便比較
function normalizeDate(d: any): number | null {
  if (d == null) return null
  
  // 1. 如果已經是數字 (Unix Timestamp)
  if (typeof d === "number") return d

  // 2. 如果是字串 (YYYY-MM-DD)
  if (typeof d === "string") {
    const dateObj = new Date(d)
    if (!isNaN(dateObj.getTime())) {
      // 處理時區問題，這裡簡單用 UTC
      return dateObj.getTime() / 1000
    }
    return null
  }

  // 3. 如果是 Lightweight Charts 的物件格式 { year: 2023, month: 1, day: 1 }
  if (typeof d === "object" && "year" in d && "month" in d && "day" in d) {
    const dateObj = new Date(d.year, d.month - 1, d.day)
    return dateObj.getTime() / 1000
  }

  return null
}

function formatTime(t: any) {
  if (t == null) return ""
  // 嘗試轉成 Date 物件輸出字串
  if (typeof t === "number") {
    const d = new Date(t * 1000)
    return d.toISOString().split('T')[0] // YYYY-MM-DD
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
      zIndex: "1000", // Tooltip 在最上層
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
      zIndex: "900", // 十字線
      transform: "translateX(-0.5px)",
    })
    const style = getComputedStyle(host)
    if (style.position === "static") host.style.position = "relative"
    host.appendChild(line)
  }
  return line
}

// 建立全域遮罩 (黃色背景區塊)
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
      // ✅ 關鍵：zIndex 要在 Canvas 之上，但在 Tooltip 之下
      zIndex: "50", 
      // ✅ 樣式：半透明黃色 (模仿籌碼K線)
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
// 3. React Component
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
  
  // 儲存主圖的時間序列 (用於計算遮罩位置)
  const primaryTimesRef = useRef<number[]>([]) 

  const chartElRefs = useMemo(() => {
    return Array(chartsData.length)
      .fill(null)
      .map(() => React.createRef<HTMLDivElement>())
  }, [chartsData.length])

  // 監聽 highlightRange 變化字串，確保 Python 端改變時觸發更新
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
    const times = primaryTimesRef.current // 這裡是已經 normalize 過的 timestamps

    // 1. 檢查資料是否充足
    if (!hr || !hr.start || !hr.end || !times || times.length === 0 || panes.current.length === 0) {
      mask.style.display = "none"
      return
    }

    // 2. 將 Python 傳來的 start/end 轉成 Timestamp
    const tStart = normalizeDate(hr.start)
    const tEnd = normalizeDate(hr.end)

    if (tStart === null || tEnd === null) {
      mask.style.display = "none"
      return
    }

    // 3. 在 times 陣列中尋找對應的 Index
    // startIdx: 第一個 >= tStart 的位置
    let startIdx = -1
    for (let i = 0; i < times.length; i++) {
      if (times[i] >= tStart) {
        startIdx = i
        break
      }
    }

    // endIdx: 最後一個 <= tEnd 的位置
    let endIdx = -1
    for (let i = times.length - 1; i >= 0; i--) {
      if (times[i] <= tEnd) {
        endIdx = i
        break
      }
    }

    // 如果找不到或範圍無效
    if (startIdx === -1 || endIdx === -1 || startIdx > endIdx) {
      mask.style.display = "none"
      return
    }

    // 4. 計算像素位置
    const p0 = panes.current[0]
    const timeScale = p0.chart.timeScale()

    // 獲取可視範圍的 logical range (如果完全在畫面外就不畫)
    // 但為了簡單，直接計算坐標，library 會處理負值
    const x1 = timeScale.logicalToCoordinate(startIdx as any)
    const x2 = timeScale.logicalToCoordinate(endIdx as any)

    // 如果 x1, x2 是 null，代表尚未渲染或異常
    if (x1 === null || x2 === null) {
      // 嘗試用 barSpacing 估算 (當部分在畫面外時)
      // 這裡簡單處理：若 convert 失敗通常代表 chart 未 ready，先隱藏
      // 但 Lightweight charts 4.0+ logicalToCoordinate 在畫面外也會回傳數值，除非 index 無效
      // 我們依賴 ResizeObserver 持續更新
    }

    // 重新取得確實的座標 (若是 null 則用 0 或 max)
    const safeX1 = x1 ?? -1000
    const safeX2 = x2 ?? 1000

    const hostRect = host.getBoundingClientRect()
    const paneRect = p0.container.getBoundingClientRect()
    
    // 計算相對於 host 的偏移量
    const offsetX = paneRect.left - hostRect.left
    
    // 計算遮罩的 left 和 width
    // 為了美觀，稍微加寬半個 bar spacing
    const barWidth = (timeScale.scrollPosition() - timeScale.coordinateToLogical(0)) !== 0 
                     ? (timeScale.width() / (timeScale.getVisibleLogicalRange()?.to! - timeScale.getVisibleLogicalRange()?.from!)) 
                     : 6 // fallback
    
    const finalLeft = Math.min(safeX1, safeX2) - (barWidth * 0.4)
    const finalRight = Math.max(safeX1, safeX2) + (barWidth * 0.4)
    
    const styleLeft = offsetX + finalLeft
    const styleWidth = finalRight - finalLeft

    if (styleWidth <= 0) {
      mask.style.display = "none"
    } else {
      mask.style.display = "block"
      mask.style.left = `${styleLeft}px`
      mask.style.width = `${styleWidth}px`
    }
  }

  // =========================================================
  // 初始化 Chart
  // =========================================================
  useEffect(() => {
    if (!chartsData?.length) return
    if (chartElRefs.some((ref) => !ref.current)) return

    // Cleanup
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
      // 記住 cleanup
      return () => host.removeEventListener("mouseleave", mouseLeaveHandler)
    }
  }, [chartsData.length]) // 僅在圖表數量改變時重置 DOM 結構

  // =========================================================
  // 建立/更新 Series 與 Data
  // =========================================================
  useEffect(() => {
    if (!chartsData?.length) return
    
    // 如果已經有 instances，我們可以選擇 destroy 重建以確保資料乾淨
    // 為求穩健，這裡採用重建策略
    chartInstances.current.forEach((c) => c && c.remove())
    chartInstances.current = []
    panes.current = []
    primaryTimesRef.current = []

    chartElRefs.forEach((ref, i) => {
      const container = ref.current
      if (!container) return

      // Create Chart
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
        }
      })

      // Crosshair config
      chart.applyOptions({
        crosshair: {
          mode: 1, // Magnet
          vertLine: {
            visible: false, // 我們用 global vline
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

      // Add Series
      for (const s of chartsData[i].series) {
        let api: ISeriesApi<any> | null = null
        switch (s.type) {
          case "Candlestick": api = chart.addCandlestickSeries(s.options); break
          case "Histogram": api = chart.addHistogramSeries(s.options); break
          case "Line": api = chart.addLineSeries(s.options); break
          case "Area": api = chart.addAreaSeries(s.options); break
          case "Bar": api = chart.addBarSeries(s.options); break
          case "Baseline": api = chart.addBaselineSeries(s.options); break
        }

        if (api) {
          if (s.priceScale) chart.priceScale(s.options?.priceScaleId || "").applyOptions(s.priceScale)
          
          api.setData(s.data)
          if (s.markers) api.setMarkers(s.markers)

          // 儲存主圖 (第一張圖) 的時間序列，並正規化
          if (i === 0 && s.type === "Candlestick" && Array.isArray(s.data)) {
            primaryTimesRef.current = s.data.map((d: any) => normalizeDate(d.time)).filter((t): t is number => t !== null)
          }

          panes.current[i].series.push({
            api,
            title: (api.options() as any).title || s.options?.title || "",
            options: api.options(),
          })
        }
      }
      
      // Fit Content
      chart.timeScale().fitContent()
    })

    // =========================================================
    // 事件同步邏輯
    // =========================================================
    
    // Crosshair Sync
    const syncCrosshair = (sourceChart: IChartApi, param: MouseEventParams, sourcePaneIndex: number) => {
      const vline = globalVLineRef.current
      const host = chartsContainerRef.current
      if (!vline || !host || !param.point || !param.time) {
        panes.current.forEach(p => p.tooltip.style.display = "none")
        if (vline) vline.style.display = "none"
        return
      }

      // 顯示 VLine
      const sourcePane = panes.current[sourcePaneIndex]
      const rawX = sourcePane.chart.timeScale().timeToCoordinate(param.time)
      if (rawX === null) return

      const hostRect = host.getBoundingClientRect()
      const srcRect = sourcePane.container.getBoundingClientRect()
      const absoluteX = (srcRect.left - hostRect.left) + rawX
      
      vline.style.left = `${absoluteX}px`
      vline.style.display = "block"

      // 同步 Tooltip 與 Crosshair position
      panes.current.forEach((target, idx) => {
        // Tooltip
        const timeStr = formatTime(param.time)
        // 這裡需要用 coordinate 反推 logical index 來找數據
        const logical = sourceChart.timeScale().coordinateToLogical(param.point!.x)
        if (logical !== null) {
           updatePaneTooltip(target, timeStr, Math.round(logical))
        }

        // Sync chart crosshair (如果不是來源圖表)
        if (idx !== sourcePaneIndex) {
           target.chart.setCrosshairPosition(0, param.time!, target.series[0]?.api)
        }
      })
    }

    panes.current.forEach((p, idx) => {
      p.chart.subscribeCrosshairMove((param) => syncCrosshair(p.chart, param, idx))
    })

    // Time Scale Sync (Visible Range)
    const validCharts = chartInstances.current.filter((c): c is IChartApi => c !== null)
    if (validCharts.length > 1) {
      let isSyncing = false
      validCharts.forEach((chart) => {
        chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
          if (!range || isSyncing) return
          isSyncing = true
          validCharts.filter(c => c !== chart).forEach(c => c.timeScale().setVisibleLogicalRange(range))
          isSyncing = false
          // 更新遮罩
          requestAnimationFrame(updateGlobalMask)
        })
      })
    } else if (validCharts.length === 1) {
        validCharts[0].timeScale().subscribeVisibleLogicalRangeChange(() => {
            requestAnimationFrame(updateGlobalMask)
        })
    }

    // 初始化遮罩
    setTimeout(updateGlobalMask, 100)

    // Resize Observer
    const ro = new ResizeObserver(() => {
        panes.current.forEach(p => p.chart.resize(p.container.clientWidth, 300))
        updateGlobalMask()
    })
    if (chartsContainerRef.current) ro.observe(chartsContainerRef.current)

    return () => {
      ro.disconnect()
      chartInstances.current.forEach((c) => c && c.remove())
    }

  }, [chartsData]) // 當 chartsData 變更時 (包含 highlightRange) 重繪

  // 額外 Effect: 當 highlightRange 改變時，強制更新 Mask (不做整圖重繪)
  useEffect(() => {
    updateGlobalMask()
  }, [highlightRangeSig])

  return (
    <div ref={chartsContainerRef} style={{ position: 'relative' }}>
      {chartElRefs.map((ref, i) => (
        <div ref={ref} key={i} className="chart-pane" />
      ))}
    </div>
  )
}

// Helper for tooltip content generation (Keep logic same as before)
const updatePaneTooltip = (pane: PaneMeta, timeStr: string, logical: number) => {
    let html = `<div style="font-weight:bold;margin-bottom:4px;">${timeStr}</div>`
    pane.series.forEach(s => {
        const data = s.api.dataByIndex(logical) as any
        if (!data) return
        
        let valStr = "--"
        let color = "#fff"
        const opts = s.options as any

        if (data.close !== undefined) {
            // Candlestick
            const isUp = data.close >= data.open
            color = isUp ? opts.upColor : opts.downColor
            valStr = `O:${toFixedMaybe(data.open)} H:${toFixedMaybe(data.high)} L:${toFixedMaybe(data.low)} C:${toFixedMaybe(data.close)}`
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