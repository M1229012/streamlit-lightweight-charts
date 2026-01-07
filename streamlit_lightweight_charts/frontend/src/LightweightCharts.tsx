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

        // 1. 建立圖表
        const chart = createChart(
          container, {
            height: 300,
            width: container.clientWidth || 600,
            ...chartsData[i].chart,
          }
        );
        chartInstances.current[i] = chart;

        // ---------------------------------------------------------
        // 🔥 新增功能：左上角三行圖例 (Legend) DOM 建立
        // ---------------------------------------------------------
        const legend = document.createElement('div');
        // 使用 cssText 設定樣式 (參照您提供的設定)
        legend.style.cssText = `position: absolute; left: 12px; top: 12px; z-index: 1; font-size: 14px; font-family: sans-serif; line-height: 18px; font-weight: 300; pointer-events: none;`;
        legend.style.color = 'black'; 
        container.style.position = 'relative'; // 確保 absolute 定位正確
        container.appendChild(legend);

        // ---------------------------------------------------------
        // 原有功能：跟隨滑鼠的浮動 Tooltip DOM 建立
        // ---------------------------------------------------------
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
            container.appendChild(toolTip);
        }

        // 用來儲存此圖表中的所有 Series，供 Legend 使用
        const chartSeriesList: ISeriesApi<any>[] = [];

        // 4. 加入 Series 數據
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
              
              // 🔥 將建立好的 Series 存起來
              chartSeriesList.push(chartSeries);
          }
        }

        // ---------------------------------------------------------
        // 🔥 新增功能：左上角圖例 (Legend) 更新邏輯
        // ---------------------------------------------------------
        const symbolName = chartsData[i].title || ''; // 使用圖表標題，若無則留空

        const getLastBar = (series: ISeriesApi<any>) => {
            // @ts-ignore: library type definition might be slightly different depending on version
            const lastIndex = series.dataByIndex(Number.MAX_SAFE_INTEGER, -1);
             // @ts-ignore
            return series.dataByIndex(lastIndex);
        };
        
        const formatPrice = (price: number) => (Math.round(price * 100) / 100).toFixed(2);
        
        const setTooltipHtml = (name: string, date: string, price: string) => {
            legend.innerHTML = `<div style="font-size: 24px; margin: 4px 0px;">${name}</div><div style="font-size: 22px; margin: 4px 0px;">${price}</div><div>${date}</div>`;
        };

        const updateLegend = (param: MouseEventParams) => {
            const validCrosshairPoint = !(
                param === undefined || param.time === undefined || param.point === undefined || param.point.x < 0 || param.point.y < 0
            );

            // 預設抓取第一個 Series 當作 Legend 的主要數據來源
            const mainSeries = chartSeriesList[0];
            if (!mainSeries) return;

            const bar = validCrosshairPoint ? param.seriesData.get(mainSeries) : getLastBar(mainSeries);
            
            if (bar) {
                const time = bar.time.toString();
                // 判斷是單一 value 還是 OHLC close
                const price = (bar as any).value !== undefined ? (bar as any).value : (bar as any).close;
                const formattedPrice = formatPrice(price);
                setTooltipHtml(symbolName, time, formattedPrice);
            }
        };

        // 訂閱 Legend 更新
        chart.subscribeCrosshairMove(updateLegend);
        // 初始化一次
        updateLegend({} as MouseEventParams);


        // ---------------------------------------------------------
        // 原有功能：浮動 Tooltip 監聽事件
        // ---------------------------------------------------------
        chart.subscribeCrosshairMove((param: MouseEventParams) => {
            if (!param.point || !param.time || param.point.x < 0 || param.point.y < 0) {
                toolTip.style.display = 'none';
                return;
            }
            
            toolTip.style.display = 'block';
            const dateStr = param.time.toString();
            let priceInfo = "";
            
            param.seriesData.forEach((value: any, series: ISeriesApi<any>) => {
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
                else if (value.value !== undefined) {
                    // priceInfo += `<div style="font-size: 12px;">值: ${value.value.toFixed(2)}</div>`;
                }
            });

            toolTip.innerHTML = `<div style="color:#333;font-weight:bold;margin-bottom:4px">${dateStr}</div>${priceInfo}`;
            
            const boxW = 150, boxH = 130, margin = 15;
            let left = param.point.x + margin;
            let top = param.point.y + margin;
            if (left > (container.clientWidth - boxW)) left = param.point.x - margin - boxW;
            if (top > (container.clientHeight - boxH)) top = param.point.y - boxH - margin;
            
            toolTip.style.left = left + 'px';
            toolTip.style.top = top + 'px';
        });

        // 5. 自動縮放
        chart.timeScale().fitContent();
      });
  
      // 6. 同步圖表
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