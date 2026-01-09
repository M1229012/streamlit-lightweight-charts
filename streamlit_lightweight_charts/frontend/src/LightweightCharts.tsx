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
      zIndex: "1000",
      top: "10px",
      left: "10px",
      pointerEvents: "none",
      border: "1px solid rgba(255,255,255,0.15)",
      borderRadius: "8px",
      background: "rgba(20, 20, 20, 0.88)",
      color: "#ececec",
      boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
      fontFamily: "sans-serif",
    })
    // 確保 tooltip 的容器有定位
    if (getComputedStyle(container).position === "static") {
      container.style.position = "relative"
    }
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
      zIndex: "2000",
    })
    if (getComputedStyle(host).position === "static") {
        host.style.position = "relative"
    }
    host.appendChild(line)
  }
  return line
}

// ✅ [修改] 遮罩改為掛載在 Chart Container 內部，並加入 Debug Label
function ensureGlobalMask(container: HTMLDivElement) {
  let mask = container.querySelector(".global-mask") as HTMLDivElement | null
  if (!mask) {
    mask = document.createElement("div")
    mask.className = "global-mask"
    Object.assign(mask.style, {
      position: "absolute",
      top: "0px",
      bottom: "0px", // 填滿高度
      left: "0px",
      width: "0px",
      display: "none",
      pointerEvents: "none",
      zIndex: "3", // 在 Canvas (z=0/1) 之上
      background: "rgba(255, 215, 0, 0.15)", // 亮黃色
      borderLeft: "2px solid rgba(255, 215, 0, 0.6)",
      borderRight: "2px solid rgba(255, 215, 0, 0.6)",
      boxSizing: "border-box"
    })
    if (getComputedStyle(container).position === "static") {
        container.style.position = "relative"
    }
    container.appendChild(mask)
  }
  return mask
}

// ✅ [新增] 建立 Debug 標籤 (確認資料有沒有傳進來)
function ensureDebugLabel(container: HTMLDivElement) {
  let label = container.querySelector(".debug-range-label") as HTMLDivElement | null
  if (!label) {
    label = document.createElement("div")
    label.className = "debug-range-label"
    Object.assign(label.style, {
      position: "absolute",
      bottom: "35px", 
      left: "10px",
      color: "rgba(255, 215, 0, 0.8)",
      fontSize: "10px",
      fontFamily: "monospace",
      pointerEvents: "none",
      zIndex: "3000",
      background: "rgba(0,0,0,0.5)",
      padding: "2px 4px",
      borderRadius: "4px"
    })
    container.appendChild(label)
  }
  return label
}

// 時間字串轉數字 key (YYYYMMDD)
function timeKey(t: any): number | null {
  if (t == null) return null
  if (typeof t === "string") {
    // 移除分隔符
    const s = t.replace(/\D/g, "")
    if (s.length === 8) return parseInt(s, 10)
    return null
  }
  if (typeof t === "object" && t && "year" in t) {
    return t.year * 10000 + t.month * 100 + t.day
  }
  if (typeof t === "number") {
     // 簡單判斷：如果是 UNIX timestamp (seconds) > 1980年
     if (t > 315532800) {
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
  const primaryTimesRef = useRef<any[]>([])

  const updateGlobalMaskRef = useRef<null | (() => void)>(null)

  // 監聽 highlightRange 變化
  const highlightRangeSig = useMemo(() => {
    const hr = (renderData.args?.["charts"]?.[0] as any)?.highlightRange
    if (!hr) return "N/A"
    return `${String(hr.start)}|${String(hr.end)}`
  }, [renderData.args])

  // 建立 refs
  const chartElRefs = useMemo(() => {
    return Array(chartsData.length).fill(null).map(() => React.createRef<HTMLDivElement>());
  }, [chartsData.length]);

  useEffect(() => {
    if (!chartsData?.length) return
    if (chartElRefs.some((ref) => !ref.current)) return

    // Clean up
    chartInstances.current.forEach((c) => c && c.remove())
    chartInstances.current = []
    panes.current = []
    primaryTimesRef.current = []

    // Global VLine 放在最外層容器
    const host = chartsContainerRef.current
    if (host) {
      globalVLineRef.current = ensureGlobalVLine(host)
      host.addEventListener("mouseleave", () => {
        panes.current.forEach((p) => (p.tooltip.style.display = "none"))
        if (globalVLineRef.current) globalVLineRef.current.style.display = "none"
      })
    }

    // 初始化圖表
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
          mode: 0 as any, // 0 = Magnet
          vertLine: { visible: i === 0, width: 1, color: "rgba(255,255,255,0.01)", labelBackgroundColor: "#333" },
          horzLine: { visible: i === 0, width: 1, color: "rgba(255,255,255,0.2)", labelBackgroundColor: "#333" },
        },
      })

      chartInstances.current[i] = chart

      const tooltip = ensurePaneTooltip(container)
      panes.current[i] = { chart, container, tooltip, series: [] }

      // Add Series
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
          if (s.priceScale) chart.priceScale(s.options?.priceScaleId || "").applyOptions(s.priceScale)
          api.setData(s.data)
          if (s.markers) api.setMarkers(s.markers)

          // 抓取主時間軸 (K線)
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
    }) // end loop

    // Helper functions
    const hideAll = () => {
      panes.current.forEach((p) => (p.tooltip.style.display = "none"))
      if (globalVLineRef.current) globalVLineRef.current.style.display = "none"
    }

    const updatePaneTooltip = (pane: PaneMeta, timeStr: string, logical: number) => {
       // ...Tooltip logic (保持不變)...
       // 為了精簡程式碼，此處使用簡單版
       let html = `<div style="font-weight:bold;margin-bottom:4px;color:#fff;">${timeStr}</div>`
       pane.series.forEach((sm) => {
         const d = sm.api.dataByIndex(logical)
         if (!d) return
         const v = pickValue(d)
         const valStr = v == null ? "--" : toFixedMaybe(Number(v), 2)
         const col = (sm.options as any).color || "#fff"
         // 簡單判斷如果是K線
         if (d.open !== undefined) {
             const c = d.close >= d.open ? "#ef5350" : "#26a69a"
             html += `<div style="color:${c}">收: ${d.close}</div>`
         } else {
             html += `<div style="display:flex;justify-content:space-between;gap:10px;"><span style="color:${col}">${sm.title}</span><span>${valStr}</span></div>`
         }
       })
       pane.tooltip.innerHTML = html
       pane.tooltip.style.display = "block"
    }

    // ✅ [重寫] Update Mask Logic
    const updateGlobalMask = () => {
      // 我們只在第一個圖表容器 (K線圖) 裡畫 Mask，但高度會自動適應
      const p0 = panes.current[0]
      if (!p0) return

      // 在第一個 pane 的容器內建立 Mask
      const mask = ensureGlobalMask(p0.container)
      const debugLabel = ensureDebugLabel(p0.container)

      const hr = chartsData?.[0]?.highlightRange
      const times = primaryTimesRef.current

      // Debug: 顯示接收到的資料
      debugLabel.innerText = `Range: ${hr?.start || '?'} ~ ${hr?.end || '?'}`

      const startKey = timeKey(hr?.start)
      const endKey = timeKey(hr?.end)

      if (startKey == null || endKey == null || !times?.length) {
        mask.style.display = "none"
        return
      }

      // 找 Index
      let startIdx = -1
      for (let i = 0; i < times.length; i++) {
        const k = timeKey(times[i])
        if (k != null && k >= startKey) {
          startIdx = i
          break
        }
      }
      let endIdx = -1
      for (let i = times.length - 1; i >= 0; i--) {
        const k = timeKey(times[i])
        if (k != null && k <= endKey) {
          endIdx = i
          break
        }
      }

      if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
        mask.style.display = "none"
        debugLabel.innerText += " (No Data Match)"
        return
      }

      const chart0 = p0.chart
      const timeScale = chart0.timeScale()
      const visibleRange = timeScale.getVisibleLogicalRange()
      
      if (!visibleRange) return
      
      // 計算座標
      const width = timeScale.width()
      let left = 0
      let right = width

      // 嚴格座標計算
      if (startIdx >= visibleRange.from) {
         const c = timeScale.logicalToCoordinate(startIdx as any)
         left = c !== null ? c : 0
      } else {
         left = 0
      }

      if (endIdx <= visibleRange.to) {
         const c = timeScale.logicalToCoordinate(endIdx as any)
         right = c !== null ? c : width
      } else {
         right = width
      }

      // Bar Spacing 修正
      let barSpacing = 6 // default
      try { barSpacing = (timeScale as any).options().barSpacing } catch {}
      
      if (startIdx >= visibleRange.from) left -= barSpacing * 0.5
      if (endIdx <= visibleRange.to) right += barSpacing * 0.5

      // 畫出來
      // 注意：這次 mask 是在 container 內，所以 left 直接是相對於 container 的 left
      const w = Math.max(0, right - left)
      
      // ✅ 強制覆蓋所有圖表高度：找出所有 pane 的總高度 (大略估算)
      // 但為了簡單，我們先只蓋住 K 線圖本身，這也是最重要的地方
      // 如果要蓋住全部，需要計算 parent container height
      // 這裡先設 bottom: 0，就是蓋住 K 線圖的高度
      
      mask.style.left = `${left}px`
      mask.style.width = `${w}px`
      mask.style.display = w > 0 ? "block" : "none"
    }

    updateGlobalMaskRef.current = updateGlobalMask

    // 綁定同步
    const syncAll = (sourcePane: PaneMeta, param: MouseEventParams) => {
       const host = chartsContainerRef.current
       const vline = globalVLineRef.current
       if (!host || !vline || !param?.point || param.time == null) {
         hideAll()
         return
       }
       // 座標轉換
       const rawLogical = sourcePane.chart.timeScale().coordinateToLogical(param.point.x)
       if (rawLogical == null) { hideAll(); return }
       const logical = Math.round(rawLogical)
       const snappedX = sourcePane.chart.timeScale().logicalToCoordinate(logical as any)
       if (snappedX == null) { hideAll(); return }

       // 計算 Global X for VLine (VLine is in HOST)
       const hostRect = host.getBoundingClientRect()
       const srcRect = sourcePane.container.getBoundingClientRect()
       const globalX = (srcRect.left - hostRect.left) + snappedX
       vline.style.left = `${globalX}px`
       vline.style.display = "block"

       // Tooltip
       const d0: any = panes.current[0].series[0].api.dataByIndex(logical)
       const timeStr = formatTime(d0?.time || param.time)
       panes.current.forEach(p => updatePaneTooltip(p, timeStr, logical))

       // Crosshair Sync
       panes.current.forEach(p => {
          const s0 = p.series[0]
          if (s0) {
             const dd:any = s0.api.dataByIndex(logical)
             const vv = pickValue(dd)
             const tt = dd?.time
             if (vv != null && tt != null) {
               (p.chart as any).setCrosshairPosition(vv, tt, s0.api)
             }
          }
       })
    }

    panes.current.forEach(p => {
       p.chart.subscribeCrosshairMove(param => syncAll(p, param))
    })

    // 同步縮放 & 更新遮罩
    const validCharts = chartInstances.current.filter((c): c is IChartApi => c !== null)
    if (validCharts.length > 1) {
        let syncing = false
        validCharts.forEach(c => {
           c.timeScale().subscribeVisibleLogicalRangeChange(r => {
              if(!r || syncing) return
              syncing = true
              validCharts.filter(o => o !== c).forEach(o => o.timeScale().setVisibleLogicalRange(r))
              syncing = false
              updateGlobalMask()
           })
        })
    } else if (validCharts.length === 1) {
        validCharts[0].timeScale().subscribeVisibleLogicalRangeChange(() => updateGlobalMask())
    }

    // Trigger initial mask
    setTimeout(updateGlobalMask, 100)
    setTimeout(updateGlobalMask, 500)
    setTimeout(updateGlobalMask, 1000)
    
    // Resize Observer
    const hostEl = chartsContainerRef.current
    let ro: ResizeObserver | null = null
    if (hostEl && "ResizeObserver" in window) {
       ro = new ResizeObserver(() => updateGlobalMask())
       ro.observe(hostEl)
    }
    window.addEventListener("resize", updateGlobalMask)

    return () => {
       window.removeEventListener("resize", updateGlobalMask)
       if(ro) ro.disconnect()
       updateGlobalMaskRef.current = null
       chartInstances.current.forEach(c => c && c.remove())
       chartInstances.current = []
       panes.current = []
    }
  }, [chartsData, chartElRefs])

  useEffect(() => {
     if (updateGlobalMaskRef.current) updateGlobalMaskRef.current()
  }, [highlightRangeSig])

  return (
    <div ref={chartsContainerRef} style={{ position: 'relative' }}>
      {chartElRefs.map((ref, i) => (
        <div ref={ref} id={`chart-${i}`} key={i} />
      ))}
    </div>
  )
}

export default LightweightChartsMultiplePanes