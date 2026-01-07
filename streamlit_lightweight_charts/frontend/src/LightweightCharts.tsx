import { useRenderData } from "streamlit-component-lib-react-hooks"
import {
  createChart,
  IChartApi,
  MouseEventParams,
  ISeriesApi,
} from "lightweight-charts"
import React, { useRef, useEffect } from "react"

const LightweightChartsMultiplePanes: React.VFC = () => {

  // returns the renderData passed from Python
  const renderData = useRenderData()
  const chartsData = renderData.args["charts"]

  const chartsContainerRef = useRef<HTMLDivElement>(null)
  
  // 使用穩定的 ref 陣列宣告方式
  const chartElRefs = useRef<Array<React.RefObject<HTMLDivElement>>>(
      Array(chartsData.length).fill(null).map(() => React.createRef<HTMLDivElement>())
  ).current;

  const chartInstances = useRef<(IChartApi | null)[]>([]);

  useEffect(() => {
      // 確保所有 ref 都存在
      if (chartElRefs.some((ref) => !ref.current)) return;

      // 清理舊圖表
      chartInstances.current.forEach(chart => {
          if (chart) chart.remove();
      });
      chartInstances.current = [];

      chartElRefs.forEach((ref, i) => {
        const container = ref.current;
        if (!container) return;

        // 1. 建立圖表 (保留原本邏輯)
        const chart = createChart(
          container, {
            height: 300,
            width: container.clientWidth || 600,
            ...chartsData[i].chart,
          }
        );
        chartInstances.current[i] = chart;

        // --- 2. 新增 Tooltip DOM 元素 (插入到這裡) ---
        let toolTip = container.querySelector('.floating-tooltip') as HTMLDivElement;
        if (!toolTip) {
            toolTip = document.createElement('div');
            toolTip.className = 'floating-tooltip';
            Object.assign(toolTip.style, {
                width: '150px', height: 'auto', position: 'absolute', display: 'none',
                padding: '8px', boxSizing: 'border-box', fontSize: '12px', textAlign: 'left',
                zIndex: '1000', top: '12px', left: '12px', pointerEvents: 'none',
                border: '1px solid', borderRadius: '4px',
                fontFamily: 'sans-serif', background: 'rgba(255, 255, 255, 0.95)',
                color: 'black', borderColor: '#2962FF', boxShadow: '0 2px 5px rgba(0,0,0,0.2)'
            });
            container.style.position = 'relative';
            container.appendChild(toolTip);
        }

        // --- 3. 新增 Tooltip 監聽事件 (v4 寫法) ---
        chart.subscribeCrosshairMove((param: MouseEventParams) => {
            if (!param.point || !param.time || param.point.x < 0 || param.point.y < 0) {
                toolTip.style.display = 'none';
                return;
            }
            
            toolTip.style.display = 'block';
            const dateStr = param.time.toString();
            let priceInfo = "";
            
            // 讀取數據 (支援 K棒與一般線圖)
            param.seriesData.forEach((value: any, series: ISeriesApi<any>) => {
                // K線數據 (Open, High, Low, Close)
                if (value.open !== undefined) {
                    const color = value.close >= value.open ? '#ef5350' : '#26a69a';
                    priceInfo += `
                        <div style="border-bottom: 1px solid #eee; margin-bottom: 4px; padding-bottom: 2px;">
                            <div style="font-weight: bold; color: ${color}; font-size: 13px;">收: ${value.close.toFixed(2)}</div>
                            <div style="display:flex;justify-content:space-between"><span>開:</span><span>${value.open.toFixed(2)}</span></div>
                            <div style="display:flex;justify-content:space-between"><span>高:</span><span>${value.high.toFixed(2)}</span></div>
                            <div style="display:flex;justify-content:space-between"><span>低:</span><span>${value.low.toFixed(2)}</span></div>
                        </div>`;
                } 
                // 單一數值 (Line, Area, Histogram 等)
                else if (value.value !== undefined) {
                    // 如果需要顯示成交量或其他指標數值，可以取消下面註解
                    // priceInfo += `<div style="font-size: 12px;">值: ${value.value.toFixed(2)}</div>`;
                }
            });

            toolTip.innerHTML = `<div style="color:#333;font-weight:bold;margin-bottom:4px">${dateStr}</div>${priceInfo}`;
            
            // 計算位置 (防止超出邊界)
            const boxW = 150, boxH = 130, margin = 15;
            let left = param.point.x + margin;
            let top = param.point.y + margin;
            if (left > (container.clientWidth - boxW)) left = param.point.x - margin - boxW;
            if (top > (container.clientHeight - boxH)) top = param.point.y - boxH - margin;
            
            toolTip.style.left = left + 'px';
            toolTip.style.top = top + 'px';
        });

        // 4. 加入 Series 數據 (保留原本邏輯)
        for (const series of chartsData[i].series){
          let chartSeries;
          switch(series.type) {
            case 'Area': chartSeries = chart.addAreaSeries(series.options); break;
            case 'Bar': chartSeries = chart.addBarSeries(series.options); break;
            case 'Baseline': chartSeries = chart.addBaselineSeries(series.options); break;
            case 'Candlestick': chartSeries = chart.addCandlestickSeries(series.options); break;
            case 'Histogram': chartSeries = chart.addHistogramSeries(series.options); break;
            case 'Line': chartSeries = chart.addLineSeries(series.options); break;
            default: return;
          }

          if (chartSeries) {
              if(series.priceScale) chart.priceScale(series.options.priceScaleId || '').applyOptions(series.priceScale);
              chartSeries.setData(series.data);
              if(series.markers) chartSeries.setMarkers(series.markers);
          }
        }

        // 5. 自動縮放 (保留原本邏輯)
        chart.timeScale().fitContent();
      });
  
      // 6. 同步圖表 (保留原本邏輯)
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
      <div ref={chartsContainerRef}>
        {chartElRefs.map((ref, i) => (
          <div ref={ref} id={`chart-${i}`} key={i} />
        ))}
      </div>
    )
}

export default LightweightChartsMultiplePanes;