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

// 建立全域遮罩元素 (Global Mask) - 覆蓋整個主圖+副圖高度
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
      // ✅ 提高層級：一定蓋在 canvas 上，但仍低於 tooltip(1200) 與 vline(2000)
      zIndex: "900",
      background: "rgba(255, 235, 59, 0.15)",
      borderLeft: "1px dashed rgba(255, 235, 59, 0.65)",
      borderRight: "1px dashed rgba(255, 235, 59, 0.65)",
    })
    const style = getComputedStyle(host)
    if (style.position === "static") host.style.position = "relative"
    host.appendChild(mask)
  }
  return mask
}

/**
 * ✅ 把 time 轉成可比較的「key」
 * - number(UTCTimestamp seconds) -> 直接用
 * - {year,month,day} -> YYYYMMDD number
 * - "YYYY-MM-DD" -> YYYYMMDD number
 * - 其他 -> null
 */
function timeKey(t: any): number | null {
  if (t == null) return null

  if (typeof t === "number" && Number.isFinite(t)) {
    return t // UTCTimestamp 秒
  }

  if (typeof t === "string") {
    // YYYY-MM-DD
    const m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/)
    if (m) {
      const y = Number(m[1])
      const mo = Number(m[2])
      const d = Number(m[3])
      return y * 10000 + mo * 100 + d
    }
    // 若是 "1700000000" 這類 unix 字串
    const n = Number(t)
    if (Number.isFinite(n)) return n
    return null
  }

  if (typeof t === "object" && t && "year" in t && "month" in t && "day" in t) {
    const y = Number(t.year)
    const mo = Number(t.month)
    const d = Number(t.day)
    if ([y, mo, d].every((x) => Number.isFinite(x))) return y * 10000 + mo * 100 + d
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

  // ✅ 讓「highlightRange 變更」可以不重建圖表就更新遮罩
  const updateGlobalMaskRef = useRef<null | (() => void)>(null)

  // 用 useMemo 動態建立 Refs
  const chartElRefs = useMemo(() => {
    return Array(chartsData.length)
      .fill(null)
      .map(() => React.createRef<HTMLDivElement>())
  }, [chartsData.length])

  // 只用來觸發「遮罩更新」
  const highlightRangeSig = useMemo(() => {
    const hr = (renderData.args?.["charts"]?.[0] as any)?.highlightRange
    if (!hr) return ""
    return `${String(hr.start ?? "")}|${String(hr.end ?? "")}`
  }, [renderData.args])

  useEffect(() => {
    if (!chartsData?.length) return
    if (chartElRefs.some((ref) => !ref.current)) return

    // 清理舊 chart
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

          // 儲存主圖時間序列
          if (i === 0 && s.type === "Candlestick" && Array.isArray(s.data)) {
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

        if (d.open !== undefined) {
          const candleColor = d.close >= d.open ? "#ef5350" : "#26a69a"
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

    // ✅ 更新全域遮罩的位置與大小（使用 timeKey，支援 number/object/string）
    const updateGlobalMask = () => {
      const host = chartsContainerRef.current
      const mask = globalMaskRef.current
      if (!host || !mask) return

      const hr = chartsData?.[0]?.highlightRange
      const times = primaryTimesRef.current

      const startKey = timeKey(hr?.start)
      const endKey = timeKey(hr?.end)
      if (startKey == null || endKey == null || !times?.length || !panes.current?.length) {
        mask.style.display = "none"
        return
      }

      const keys = times.map((t: any) => timeKey(t)).filter((k: any) => k != null) as number[]
      if (!keys.length) {
        mask.style.display = "none"
        return
      }

      // 找 startIdx：第一個 >= startKey
      let startIdx = -1
      for (let i = 0; i < times.length; i++) {
        const k = timeKey(times[i])
        if (k == null) continue
        if (k >= startKey) {
          startIdx = i
          break
        }
      }

      // 找 endIdx：最後一個 <= endKey
      let endIdx = -1
      for (let i = times.length - 1; i >= 0; i--) {
        const k = timeKey(times[i])
        if (k == null) continue
        if (k <= endKey) {
          endIdx = i
          break
        }
      }

      if (startIdx < 0 || endIdx < 0 || endIdx < startIdx) {
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

      if (endIdx < visibleRange.from || startIdx > visibleRange.to) {
        mask.style.display = "none"
        return
      }

      const width = timeScale.width()
      let left = 0
      let right = width

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

      const hostRect = host.getBoundingClientRect()
      const paneRect = p0.container.getBoundingClientRect()
      const offsetX = paneRect.left - hostRect.left

      // barSpacing 讓遮罩稍微寬一點包住K線
      let barSpacing: any = null
      try {
        barSpacing = (timeScale as any)?.options?.()?.barSpacing
      } catch {}
      if (barSpacing == null) {
        try {
          barSpacing = (chart0 as any)?.options?.()?.timeScale?.barSpacing
        } catch {}
      }

      if (typeof barSpacing === "number") {
        if (startIdx >= visibleRange.from) left -= barSpacing / 2
        if (endIdx <= visibleRange.to) right += barSpacing / 2
      }

      const w = Math.max(0, right - left)
      mask.style.left = `${offsetX + left}px`
      mask.style.width = `${w}px`
      mask.style.display = w > 0 ? "block" : "none"
    }

    // 讓外部 useEffect 可以直接呼叫更新遮罩
    updateGlobalMaskRef.current = updateGlobalMask

    const syncAll = (sourcePane: PaneMeta, param: MouseEventParams) => {
      const host = chartsContainerRef.current
      const vline = globalVLineRef.current

      if (!host || !vline || !param?.point || param.time == null) {
        hideAll()
        return
      }

      const rawLogical = sourcePane.chart.timeScale().coordinateToLogical(param.point.x)
      if (rawLogical == null) {
        hideAll()
        return
      }
      const logical = Math.round(rawLogical)

      const snappedX = sourcePane.chart.timeScale().logicalToCoordinate(logical as any)
      if (snappedX == null) {
        hideAll()
        return
      }

      let timeForLabel: any = param.time
      const primary = panes.current?.[0]
      const primaryCandle = primary?.series?.find((sm) => {
        const opt: any = sm.options || {}
        return typeof opt.upColor === "string" && typeof opt.downColor === "string"
      })
      if (primaryCandle) {
        const d0: any = primaryCandle.api.dataByIndex(logical)
        if (d0 && (d0 as any).time != null) timeForLabel = (d0 as any).time
      }
      const timeStr = formatTime(timeForLabel)

      const hostRect = host.getBoundingClientRect()
      const srcRect = sourcePane.container.getBoundingClientRect()
      const globalX = (srcRect.left - hostRect.left) + snappedX
      vline.style.left = `${globalX}px`
      vline.style.display = "block"

      panes.current.forEach((p) => updatePaneTooltip(p, timeStr, logical))

      panes.current.forEach((p) => {
        const sm0 = p.series?.[0]
        if (!sm0) return
        const d: any = sm0.api.dataByIndex(logical)
        if (!d) return

        const t = (d as any).time ?? timeForLabel
        const price =
          typeof (d as any).close === "number"
            ? (d as any).close
            : typeof (d as any).value === "number"
              ? (d as any).value
              : pickValue(d)

        const setCrosshairPosition = (p.chart as any).setCrosshairPosition
        if (typeof setCrosshairPosition === "function" && price != null && t != null) {
          setCrosshairPosition(price, t, sm0.api)
        }
      })
    }

    panes.current.forEach((p) => {
      p.chart.subscribeCrosshairMove((param) => syncAll(p, param))
    })

    // 可視範圍改變 (縮放/平移) -> 同步 + 更新遮罩
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
    } else {
      const c0 = validCharts[0]
      if (c0) c0.timeScale().subscribeVisibleLogicalRangeChange(() => updateGlobalMask())
    }

    // 初始化時更新一次遮罩
    setTimeout(() => updateGlobalMask(), 50)

    // ✅ 用 ResizeObserver 比 window resize 更準（容器寬高變了也會更新遮罩）
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

  // ✅ highlightRange 改變時，直接更新遮罩（不重建 chart）
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
