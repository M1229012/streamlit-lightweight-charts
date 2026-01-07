import { useRenderData } from "streamlit-component-lib-react-hooks"
import {
  createChart,
  IChartApi,
  MouseEventParams,
  ISeriesApi,
} from "lightweight-charts"
import React, { useRef, useEffect } from "react"

const LightweightChartsMultiplePanes: React.VFC = () => {

  // 接收 Python 傳來的數據
  const renderData = useRenderData()
  const chartsData = renderData.args["charts"]

  const chartsContainerRef = useRef<HTMLDivElement>(null)
  
  // 建立圖表參考
  const chartElRefs = useRef<Array<React.RefObject<HTMLDivElement>>>(
      Array(chartsData.length).fill(null).map(() => React.createRef<HTMLDivElement>())
  ).current;

  // 儲ul所有圖表實例
  const chartInstances = useRef<(IChartApi | null)[]>([]);

  useEffect(() => {
      // 基本檢查
      if (chartElRefs.some((ref) => !ref.current) || !chartsContainerRef.current) return;

      const mainContainer = chartsContainerRef.current;

      // 清理舊圖表
      chartInstances.current.forEach(chart => {
          if (chart) chart.remove();
      });
      chartInstances.current = [];

      // ---------------------------------------------------------
      // 🎨 全局浮動 Tooltip (放到最外層容器，確保貫穿顯示)
      // ---------------------------------------------------------
      let toolTip = mainContainer.querySelector('.global-tooltip') as HTMLDivElement;
      if (!toolTip) {
          toolTip = document.createElement('div');
          toolTip.className = 'global-tooltip';
          Object.assign(toolTip.style, {
              width: 'auto', height: 'auto', position: 'absolute', display: 'none',
              padding: '10px', boxSizing: 'border-box', fontSize: '12px', textAlign: 'left',
              zIndex: '2000', pointerEvents: 'none', border: '1px solid #444',
              borderRadius: '6px', fontFamily: 'sans-serif',
              background: 'rgba(20, 20, 20, 0.9)', color: '#ececec',
              boxShadow: '0 4px 8px rgba(0,0,0,0.6)'
          });
          mainContainer.style.position = 'relative';
          mainContainer.appendChild(toolTip);
      }

      // 同步鎖，防止無窮迴圈
      let isCrosshairSyncing = false;

      chartElRefs.forEach((ref, i) => {
        const container = ref.current;
        if (!container) return;

        // 1. 建立圖表
        const chart = createChart(
          container, {
            height: 300,
            width: container.clientWidth || 600,
            ...chartsData[i].chart,
            layout: { 
                background: { type: 'solid', color: 'transparent' }, 
                textColor: '#d1d4dc',
                ...chartsData[i].chart.layout 
            }
          }
        );
        chartInstances.current[i] = chart;

        // 2. 加入 Series 數據 (這部分完全保留您原本的邏輯)
        for (const series of chartsData[i].series){
          let chartSeries;
          switch(series.type) {
            case 'Area': chartSeries = chart.addAreaSeries(series.options); break;
            case 'Bar': chartSeries = chart.addBarSeries(series.options); break;
            case 'Baseline': chartSeries = chart.addBaselineSeries(series.options); break;
            case 'Candlestick': chartSeries = chart.addCandlestickSeries(series.options); break;
            case 'Histogram': chartSeries = chart.addHistogramSeries(series.options); break;
            case 'Line': chartSeries = chart.addLineSeries(series.options); break;
            default: continue;
          }

          if (chartSeries) {
              if(series.priceScale) chart.priceScale(series.options.priceScaleId || '').applyOptions(series.priceScale);
              chartSeries.setData(series.data);
              if(series.markers) chartSeries.setMarkers(series.markers);
          }
        }

        // ---------------------------------------------------------
        // 🔗 核心修改：全局十字線同步 與 統一 Tooltip 顯示
        // ---------------------------------------------------------
        chart.subscribeCrosshairMove((param: MouseEventParams) => {
            if (!param.point || !param.time || param.point.x < 0 || param.point.y < 0) {
                // 如果目前的圖表滑鼠移出了，隱藏 Tooltip
                if (!isCrosshairSyncing) toolTip.style.display = 'none';
            } else {
                toolTip.style.display = 'block';
                const dateStr = param.time.toString();
                let tooltipHtml = `<div style="font-weight: bold; margin-bottom: 6px; border-bottom: 1px solid #555; padding-bottom: 4px; color: #fff; font-size: 13px;">${dateStr}</div>`;
                
                // 🔥 關鍵步驟：遍歷「所有」圖表實例，抓取同一時間點的數據
                chartInstances.current.forEach((inst) => {
                    if (!inst) return;
                    // 取得該圖表在目前時間點的數據
                    const data = inst.seriesData(); 
                    data.forEach((value: any, series: ISeriesApi<any>) => {
                        const seriesOptions = series.options() as any;
                        const title = seriesOptions.title || ''; 

                        if (value.value !== undefined && !title) return; // 隱藏基準線

                        let color = seriesOptions.color || seriesOptions.upColor || seriesOptions.lineColor || 'white';

                        // 1. 處理 K 線
                        if (value.open !== undefined) {
                            const candleColor = value.close >= value.open ? '#ef5350' : '#26a69a';
                            tooltipHtml += `
                                <div style="margin: 4px 0;">
                                    <div style="display:flex; align-items:center;">
                                        <span style="width: 8px; height: 8px; border-radius: 50%; background-color: ${candleColor}; margin-right: 6px;"></span>
                                        <span style="font-weight: bold; color: ${candleColor};">收盤: ${value.close.toFixed(2)}</span>
                                    </div>
                                    <div style="font-size: 11px; color: #aaa; margin-left: 14px;">
                                        開:${value.open.toFixed(2)} 高:${value.high.toFixed(2)} 低:${value.low.toFixed(2)}
                                    </div>
                                </div>`;
                        } 
                        // 2. 處理副圖數據 (成交量、KD、MACD、持股)
                        else if (value.value !== undefined) {
                            let displayValue = "";
                            if (title.includes('%')) {
                                displayValue = Number(value.value).toFixed(2) + '%';
                            } else if (title.includes('量') || title.includes('Vol') || title.includes('資') || title.includes('信') || title.includes('營') || title.includes('戶')) {
                                displayValue = Math.round(value.value).toLocaleString() + ' 張';
                            } else {
                                displayValue = Number(value.value).toFixed(2);
                            }
                            tooltipHtml += `
                                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px;">
                                    <div style="display: flex; align-items: center;">
                                        <span style="width: 6px; height: 6px; border-radius: 50%; background-color: ${color}; margin-right: 6px;"></span>
                                        <span style="color: #ddd; margin-right: 12px;">${title}</span>
                                    </div>
                                    <span style="font-family: monospace; font-weight: bold; color: ${color};">${displayValue}</span>
                                </div>`;
                        }
                    });
                });

                toolTip.innerHTML = tooltipHtml;
                
                // 計算位置 (相對於 mainContainer)
                const rect = mainContainer.getBoundingClientRect();
                const margin = 15;
                let left = param.point.x + margin + container.offsetLeft;
                let top = param.point.y + margin + container.offsetTop;
                
                // 防止跑出右邊界
                if (left > (mainContainer.clientWidth - 190)) left -= (190 + margin * 2);
                
                toolTip.style.left = left + 'px';
                toolTip.style.top = top + 'px';
            }

            // --- B. 同步貫穿邏輯 ---
            if (!isCrosshairSyncing) {
                isCrosshairSyncing = true;
                chartInstances.current.forEach((c) => {
                    if (c && c !== chart) {
                        if (param.point && param.point.x >= 0 && param.point.y >= 0) {
                            (c as any).moveCrosshair(param.point);
                        } else {
                            (c as any).clearCrosshairPosition();
                        }
                    }
                });
                isCrosshairSyncing = false;
            }
        });

        // 3. 自動縮放
        chart.timeScale().fitContent();
      });
  
      // 4. 同步時間軸
      const validCharts = chartInstances.current.filter((c): c is IChartApi => c !== null);
      if(chartsData.length > 1){
        validCharts.forEach((chart) => {
          chart.timeScale().subscribeVisibleTimeRangeChange(() => {
            validCharts.filter(c => c !== chart).forEach(c => {
                c.timeScale().applyOptions({ rightOffset: chart.timeScale().scrollPosition() });
            });
          });
          chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
            if (range) {
              validCharts.filter(c => c !== chart).forEach(c => {
                  c.timeScale().setVisibleLogicalRange(range);
              });
            }
          });
      });}

      return () => { 
        chartInstances.current.forEach(chart => chart && chart.remove());
        chartInstances.current = [];
      }
    }, [chartsData]);

    return (
      <div ref={chartsContainerRef} style={{ position: 'relative' }}>
        {chartElRefs.map((ref, i) => (
          <div ref={ref} id={`chart-${i}`} key={i} />
        ))}
      </div>
    )
}

export default LightweightChartsMultiplePanes;