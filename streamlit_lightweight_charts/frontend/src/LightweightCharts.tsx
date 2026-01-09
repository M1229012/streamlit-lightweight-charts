import { useRenderData } from "streamlit-component-lib-react-hooks"
import { createChart, IChartApi, MouseEventParams, ISeriesApi } from "lightweight-charts"
import React, { useRef, useEffect, useMemo } from "react"

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
      width: "1px",
      background: "rgba(255,255,255,0.4)",
      display: "none",
      pointerEvents: "none",
      zIndex: "2000",
      transform: "translateX(-0.5px)",
    })
    const style = getComputedStyle(host)
    if (style.position === "static") host.style.position = "relative"
    host.appendChild(line)
  }
  return line
}

// 建立全域遮罩元素 (Global Mask)
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
      zIndex: "900", 
      // 針對黑色背景，使用非常明顯的亮黃色
      background: "rgba(255, 235, 59, 0.2)", 
      borderLeft: "2px solid rgba(255, 235, 59, 0.8)", // 加粗邊框確保可見
      borderRight: "2px solid rgba(255, 235, 59, 0.8)",
    })
    const style = getComputedStyle(host)
    if (style.position === "static") host.style.position = "relative"
    host.appendChild(mask)
  }
  return mask
}

/**
 * ✅ 終極版時間比對鍵值生成器
 * 無論是 String "2023-01-01", Object {year:2023...}, Number 1672531200
 * 全部轉為 YYYYMMDD 整數格式，確保比對萬無一失。
 */
function timeKey(t: any): number | null {
  if (t == null) return null

  // Case 1: String "YYYY-MM-DD"
  if (typeof t === "string") {
    // 嘗試解析 YYYY-MM-DD
    const parts = t.split(/[-/]/)
    if (parts.length === 3) {
      const y = parseInt(parts[0], 10)
      const m = parseInt(parts[1], 10)
      const d = parseInt(parts[2], 10)
      if (!isNaN(y) && !isNaN(m) && !isNaN(d)) {
        return y * 10000 + m * 100 + d
      }
    }
    return null
  }

  // Case 2: Object {year, month, day}
  if (typeof t === "object" && t && "year" in t && "month" in t && "day" in t) {
    return t.year * 10000 + t.month * 100 + t.day
  }

  // Case 3: Number (Timestamp or already YYYYMMDD)
  if (typeof t === "number") {
    // 如果數字很大 (Timestamp in seconds)，轉回日期
    if (t > 30000000) { 
       const d = new Date(t * 1000)
       return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate()
    }
    return t 
  }

  return null
}

const LightweightChartsMultiplePanes: React.VFC = () => {
  const renderData = useRenderData()
  const chartsData = renderData.args["charts"] || []

  const chartsContainerRef = useRef<HTMLDivElement>(null)
  const panes = useRef<PaneMeta[]>([])
  const chartInstances = useRef<(IChartApi | null)[]>([])
  const globalVLineRef = useRef<HTMLDivElement | null>(null)
  const globalMaskRef = useRef<HTMLDivElement | null>(null)
  const primaryTimesRef = useRef<any[]>([])

  const updateGlobalMaskRef = useRef<null | (() => void)>(null)

  const chartElRefs = useMemo(() => {
    return Array(chartsData.length)
      .fill(null)
      .map(() => React.createRef<HTMLDivElement>());
  }, [chartsData.length]);

  const highlightRangeSig = useMemo(() => {
    const hr = (renderData.args?.["charts"]?.[0] as any)?.highlightRange
    if (!hr) return ""
    return `${String(hr.start ?? "")}|${String(hr.end ?? "")}`
  }, [renderData.args])

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
      host.addEventListener("mouseleave", () => {
        panes.current.forEach((p) => (p.tooltip.style.display = "none"))
        if (globalVLineRef.current) globalVLineRef.current.style.display = "none"
      })
    }

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
        rightPriceScale: {
          visible: true,
          minimumWidth: 70, 
          borderColor: "rgba(197, 203, 206, 0.8)",
          ...(chartsData[i].chart?.rightPriceScale || {}),
        },
      })

      chart.applyOptions({
        crosshair: {
          mode: 0 as any,
          vertLine: {
            visible: i === 0,
            width: 1,
            color: "rgba(255,255,255,0.01)",
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

      for (const s of chartsData[i].series) {
        let api: ISeriesApi<any> | null = null

        switch (s.type) {
          case "Area": api = chart.addAreaSeries(s.options); break
          case "Bar": api = chart.addBarSeries(s.options); break
          case "Baseline": api = chart.addBaselineSeries(s.options); break
          case "Candlestick": api = chart.addCandlestickSeries(s.options); break
          case "Histogram": api = chart.addHistogramSeries(s.options); break
          case "Line": api = chart.addLineSeries(s.options); break
          default: api = null
        }

        if (api) {
          if (s.priceScale)
            chart.priceScale(s.options?.priceScaleId || "").applyOptions(s.priceScale)

          api.setData(s.data)
          if (s.markers) api.setMarkers(s.markers)

          // ✅ [FIX] 嘗試從所有可能的圖表中抓取時間軸數據 (不只限制第一個)
          if (primaryTimesRef.current.length === 0 && Array.isArray(s.data) && s.data.length > 0) {
             primaryTimesRef.current = s.data.map((d: any) => d?.time)
          }

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
      // (Tooltip logic remains same, omitting for brevity to focus on mask)
      let html = `<div style="font-weight:800;font-size:13px;margin-bottom:6px;color:#fff;">${timeStr}</div>`
      pane.series.forEach((sm) => {
        const d = sm.api.dataByIndex(logical)
        if (!d) return
        const title = sm.title || ""
        const so: any = sm.options || {}
        let color = so.color || so.upColor || so.lineColor || "#fff"
        const v = pickValue(d)
        let displayValue = v == null ? "--" : toFixedMaybe(Number(v), 2)
        
        if (d.open !== undefined) {
             const candleColor = d.close >= d.open ? "#ef5350" : "#26a69a"
             html += `<div style="margin-top:4px;"><span style="color:${candleColor}">收: ${d.close}</span></div>`
        } else {
             html += `<div style="display:flex;justify-content:space-between;margin-top:2px;"><span style="color:${color}">${title}</span><span>${displayValue}</span></div>`
        }
      })
      pane.tooltip.innerHTML = html
      pane.tooltip.style.display = "block"
    }

    // ✅ [核心修正] 強制顯示遮罩
    const updateGlobalMask = () => {
      const host = chartsContainerRef.current
      const mask = globalMaskRef.current
      if (!host || !mask) return

      const hr = chartsData?.[0]?.highlightRange
      const times = primaryTimesRef.current

      // console.log("Debug Mask:", { hr, timesLength: times.length });

      const startKey = timeKey(hr?.start)
      const endKey = timeKey(hr?.end)

      if (startKey == null || endKey == null || !times?.length || !panes.current?.length) {
        mask.style.display = "none"
        return
      }

      // 寬鬆比對：找到 >= startKey 的第一個
      let startIdx = -1
      for (let i = 0; i < times.length; i++) {
        const k = timeKey(times[i])
        if (k != null && k >= startKey) {
          startIdx = i
          break
        }
      }

      // 寬鬆比對：找到 <= endKey 的最後一個
      let endIdx = -1
      for (let i = times.length - 1; i >= 0; i--) {
        const k = timeKey(times[i])
        if (k != null && k <= endKey) {
          endIdx = i
          break
        }
      }

      // 若完全沒交集，隱藏
      if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
        mask.style.display = "none"
        return
      }

      const p0 = panes.current[0]
      const chart0 = p0.chart
      const timeScale = chart0.timeScale()
      const visibleRange = timeScale.getVisibleLogicalRange()

      if (!visibleRange) {
        mask.style.display = "none"
        return
      }

      // 只要有一部分在畫面內就顯示
      if (endIdx < visibleRange.from || startIdx > visibleRange.to) {
        mask.style.display = "none"
        return
      }

      const width = timeScale.width()
      let left = 0
      let right = width

      // 計算左邊界 (含視窗外處理)
      if (startIdx >= visibleRange.from) {
        const c = timeScale.logicalToCoordinate(startIdx as any)
        left = c !== null ? c : 0
      } else {
        left = 0
      }

      // 計算右邊界 (含視窗外處理)
      if (endIdx <= visibleRange.to) {
        const c = timeScale.logicalToCoordinate(endIdx as any)
        right = c !== null ? c : width
      } else {
        right = width
      }

      const hostRect = host.getBoundingClientRect()
      const paneRect = p0.container.getBoundingClientRect()
      const offsetX = paneRect.left - hostRect.left

      let barSpacing: any = null
      try { barSpacing = (timeScale as any).options().barSpacing } catch {}
      
      if (typeof barSpacing === "number") {
        if (startIdx >= visibleRange.from) left -= barSpacing / 2
        if (endIdx <= visibleRange.to) right += barSpacing / 2
      }

      const w = Math.max(0, right - left)
      
      // ✅ 強制套用樣式
      mask.style.left = `${offsetX + left}px`
      mask.style.width = `${w}px`
      mask.style.display = w > 0 ? "block" : "none"
    }

    updateGlobalMaskRef.current = updateGlobalMask

    // 綁定 Crosshair
    const syncAll = (sourcePane: PaneMeta, param: MouseEventParams) => {
       // ... (Logics same as before) ...
       // 為了節省篇幅，此處邏輯與上個版本相同，維持 Crosshair 同步
       // 如果需要我再完整列出這段，請告訴我
       const host = chartsContainerRef.current
       const vline = globalVLineRef.current
       if (!host || !vline || !param?.point || param.time == null) {
         hideAll()
         return
       }
       const rawLogical = sourcePane.chart.timeScale().coordinateToLogical(param.point.x)
       if (rawLogical == null) { hideAll(); return }
       const logical = Math.round(rawLogical)
       const snappedX = sourcePane.chart.timeScale().logicalToCoordinate(logical as any)
       if (snappedX == null) { hideAll(); return }
       
       const hostRect = host.getBoundingClientRect()
       const srcRect = sourcePane.container.getBoundingClientRect()
       const globalX = (srcRect.left - hostRect.left) + snappedX
       vline.style.left = `${globalX}px`
       vline.style.display = "block"
       
       const d0: any = panes.current[0].series[0].api.dataByIndex(logical)
       const timeStr = formatTime(d0?.time || param.time)
       panes.current.forEach((p) => updatePaneTooltip(p, timeStr, logical))
    }

    panes.current.forEach((p) => {
      p.chart.subscribeCrosshairMove((param) => syncAll(p, param))
    })

    // 同步可視範圍
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
          updateGlobalMask()
        })
      })
    } else if (validCharts.length === 1) {
      validCharts[0].timeScale().subscribeVisibleLogicalRangeChange(() => updateGlobalMask())
    }

    // ✅ 多次延遲觸發，確保 DOM 渲染完畢後遮罩能畫上去
    setTimeout(() => updateGlobalMask(), 50)
    setTimeout(() => updateGlobalMask(), 200)
    setTimeout(() => updateGlobalMask(), 500)

    const hostEl = chartsContainerRef.current
    let ro: ResizeObserver | null = null
    if (hostEl && "ResizeObserver" in window) {
      ro = new ResizeObserver(() => updateGlobalMask())
      ro.observe(hostEl)
    }

    const onResize = () => updateGlobalMask()
    window.addEventListener("resize", onResize)

    return () => {
      window.removeEventListener("resize", onResize)
      if (ro) ro.disconnect()
      updateGlobalMaskRef.current = null
      chartInstances.current.forEach((c) => c && c.remove())
      chartInstances.current = []
      panes.current = []
    }
  }, [chartsData, chartElRefs])

  useEffect(() => {
    if (updateGlobalMaskRef.current) updateGlobalMaskRef.current()
  }, [highlightRangeSig])

  return (
    <div ref={chartsContainerRef}>
      {chartElRefs.map((ref, i) => (
        <div ref={ref} id={`chart-${i}`} key={i} />
      ))}
    </div>
  )
}

export default LightweightChartsMultiplePanes