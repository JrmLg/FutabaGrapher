import { buildNumericColumn } from "./parseCsv.js";

const DEFAULT_COLORS = [
  "#1f77b4",
  "#d62728",
  "#2ca02c",
  "#ff7f0e",
  "#9467bd",
  "#17becf",
  "#8c564b",
  "#e377c2"
];

function movingAverage(values, windowSize) {
  if (windowSize <= 1) return values.slice();
  const out = new Array(values.length).fill(null);
  let sum = 0;
  let count = 0;
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i];
    if (v != null && Number.isFinite(v)) {
      sum += v;
      count += 1;
    }
    const oldIdx = i - windowSize;
    if (oldIdx >= 0) {
      const old = values[oldIdx];
      if (old != null && Number.isFinite(old)) {
        sum -= old;
        count -= 1;
      }
    }
    out[i] = count ? sum / count : null;
  }
  return out;
}

function clampRange(x, y, rangeMin, rangeMax) {
  const px = [];
  const py = [];
  for (let i = 0; i < x.length; i += 1) {
    const xv = x[i];
    if (xv == null || !Number.isFinite(xv)) continue;
    if (rangeMin != null && xv < rangeMin) continue;
    if (rangeMax != null && xv > rangeMax) continue;
    px.push(xv);
    py.push(y[i]);
  }
  return [px, py];
}

function decimateMinMax(x, y, maxPoints = 3000) {
  if (x.length <= maxPoints) {
    return x.map((xv, idx) => [xv, y[idx]]);
  }
  const bucketSize = Math.ceil(x.length / maxPoints);
  const points = [];
  for (let i = 0; i < x.length; i += bucketSize) {
    let minY = null;
    let maxY = null;
    let minX = null;
    let maxX = null;
    const end = Math.min(i + bucketSize, x.length);
    for (let j = i; j < end; j += 1) {
      const yy = y[j];
      const xx = x[j];
      if (yy == null || xx == null || !Number.isFinite(yy) || !Number.isFinite(xx)) continue;
      if (minY == null || yy < minY) {
        minY = yy;
        minX = xx;
      }
      if (maxY == null || yy > maxY) {
        maxY = yy;
        maxX = xx;
      }
    }
    if (minY != null) points.push([minX, minY]);
    if (maxY != null && maxX !== minX) points.push([maxX, maxY]);
  }
  points.sort((a, b) => a[0] - b[0]);
  return points;
}

function computeExtrema(data) {
  let min = null;
  let max = null;
  let minIdx = -1;
  let maxIdx = -1;
  for (let i = 0; i < data.length; i += 1) {
    const val = data[i]?.[1];
    if (val == null || !Number.isFinite(val)) continue;
    if (min == null || val < min) {
      min = val;
      minIdx = i;
    }
    if (max == null || val > max) {
      max = val;
      maxIdx = i;
    }
  }
  return { min, max, minIdx, maxIdx };
}

function getAxisLabel(name, unit) {
  return unit ? `${name} (${unit})` : name;
}

function effectiveName(col) {
  return (col?.customName || "").trim() || col?.name || "Column";
}

function effectiveUnit(col) {
  return (col?.customUnit || "").trim() || col?.unit || "";
}

function resolveTimeScale(meta) {
  if (!meta || meta.type !== "time") return { scale: 1, unit: effectiveUnit(meta) };
  const unit = effectiveUnit(meta).toLowerCase();
  if (unit === "ms" || unit === "millisecond" || unit === "milliseconds") {
    return { scale: 0.001, unit: "s" };
  }
  if (unit === "s" || unit === "sec" || unit === "second" || unit === "seconds") {
    return { scale: 1, unit: "s" };
  }
  return { scale: 1, unit: "s" };
}

function formatTimeValue(value, scale) {
  if (!Number.isFinite(value)) return "";
  return (value * scale).toFixed(1);
}

function computeAxisRange(seriesList) {
  let min = null;
  let max = null;
  for (const entry of seriesList) {
    const points = entry?.obj?.data || [];
    for (const point of points) {
      const y = point?.[1];
      if (!Number.isFinite(y)) continue;
      if (min == null || y < min) min = y;
      if (max == null || y > max) max = y;
    }
  }
  if (min == null || max == null) return null;
  if (min === max) {
    const delta = Math.max(1, Math.abs(min) * 0.05);
    return { min: min - delta, max: max + delta };
  }
  const pad = (max - min) * 0.05;
  return { min: min - pad, max: max + pad };
}

function finalizeRange(min, max) {
  if (min == null || max == null) return null;
  if (min === max) {
    const delta = Math.max(1, Math.abs(min) * 0.05);
    return { min: min - delta, max: max + delta };
  }
  const pad = (max - min) * 0.05;
  return { min: min - pad, max: max + pad };
}

function formatAxisValue(value) {
  if (!Number.isFinite(value)) return "";
  const abs = Math.abs(value);
  if (abs >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(1)}k`;
  if (abs >= 100) return value.toFixed(0);
  if (abs >= 10) return value.toFixed(1);
  if (abs >= 1) return value.toFixed(2);
  return value.toFixed(3);
}

export function computeYAxisRanges(dataset, graphConfig, rangeMin, rangeMax) {
  if (!dataset || !graphConfig) return { leftRange: null, rightRange: null };
  const xColumn = buildNumericColumn(dataset.rows, graphConfig.xColumnIndex);
  let leftMin = null;
  let leftMax = null;
  let rightMin = null;
  let rightMax = null;

  for (const serie of graphConfig.series || []) {
    if (!serie.visible) continue;
    const yValues = buildNumericColumn(dataset.rows, serie.columnIndex);
    const [xr, yr] = clampRange(
      xColumn,
      movingAverage(yValues, graphConfig.smoothing || 1),
      rangeMin,
      rangeMax
    );
    for (let i = 0; i < xr.length; i += 1) {
      const yv = yr[i];
      if (yv == null || !Number.isFinite(yv)) continue;
      if (serie.axis === "right") {
        if (rightMin == null || yv < rightMin) rightMin = yv;
        if (rightMax == null || yv > rightMax) rightMax = yv;
      } else {
        if (leftMin == null || yv < leftMin) leftMin = yv;
        if (leftMax == null || yv > leftMax) leftMax = yv;
      }
    }
  }

  const leftRange = finalizeRange(leftMin, leftMax);
  const rightRange = finalizeRange(rightMin, rightMax);
  if (graphConfig.showMinMax) {
    const expand = (range) => {
      if (!range) return range;
      const span = range.max - range.min;
      const pad = span * 0.12;
      return { min: range.min - pad, max: range.max + pad };
    };
    return {
      leftRange: expand(leftRange),
      rightRange: expand(rightRange)
    };
  }
  return { leftRange, rightRange };
}

export function makeDefaultSeries(column, i) {
  return {
    columnIndex: i,
    label: effectiveName(column),
    color: DEFAULT_COLORS[i % DEFAULT_COLORS.length],
    axis: "left",
    visible: true
  };
}

export function buildGraphOption(dataset, graphConfig) {
  const xColumn = buildNumericColumn(dataset.rows, graphConfig.xColumnIndex);
  const xMeta = dataset.columns[graphConfig.xColumnIndex];
  const timeScale = resolveTimeScale(xMeta);
  const leftSeries = [];
  const rightSeries = [];
  const allSeries = [];
  const legendSelected = {};

  for (const [idx, serie] of graphConfig.series.entries()) {
    const yValues = buildNumericColumn(dataset.rows, serie.columnIndex);
    const [xr, yr] = clampRange(
      xColumn,
      movingAverage(yValues, graphConfig.smoothing || 1),
      graphConfig.rangeMin,
      graphConfig.rangeMax
    );
    const data = decimateMinMax(xr, yr);
    const extrema = graphConfig.showMinMax ? computeExtrema(data) : null;
    const colMeta = dataset.columns[serie.columnIndex];
    const obj = {
      type: graphConfig.type,
      name: serie.label || effectiveName(colMeta),
      yAxisIndex: serie.axis === "right" ? 1 : 0,
      showSymbol: graphConfig.type === "scatter",
      symbolSize: graphConfig.type === "scatter" ? 4 : 2,
      connectNulls: false,
      lineStyle: { width: 1.5, color: serie.color },
      itemStyle: { color: serie.color },
      data,
      large: data.length > 8000,
      animation: false
    };
    if (extrema && extrema.minIdx >= 0 && extrema.maxIdx >= 0) {
      const labelColor = "#111111";
      obj.markPoint = {
        symbolSize: 42,
        label: { color: labelColor, fontSize: 10 },
        itemStyle: { color: "#ffffff", borderColor: serie.color, borderWidth: 2 },
        data: [
          { type: "min", name: "Min", symbol: "pin", symbolRotate: 180, label: { offset: [0, 9] } },
          { type: "max", name: "Max", symbol: "pin", symbolRotate: 0 }
        ]
      };
    }
    allSeries.push(obj);
    legendSelected[obj.name] = serie.visible !== false;
    if (serie.visible !== false) {
      if (serie.axis === "right") rightSeries.push({ obj, colMeta, serie });
      else leftSeries.push({ obj, colMeta, serie });
    }
    if (idx > 20) break;
  }

  const leftUnit = (leftSeries[0]?.serie?.unit || "").trim() || effectiveUnit(leftSeries[0]?.colMeta) || "";
  const rightUnit = (rightSeries[0]?.serie?.unit || "").trim() || effectiveUnit(rightSeries[0]?.colMeta) || "";
  const leftRange = computeAxisRange(leftSeries);
  const rightRange = computeAxisRange(rightSeries);
  return {
    backgroundColor: "#ffffff",
    color: graphConfig.series.map((s) => s.color),
    title: { text: graphConfig.title, left: 10, top: 8, textStyle: { fontSize: 14 } },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "cross" },
      formatter: (params) => {
        const items = Array.isArray(params) ? params : [params];
        if (!items.length) return "";
        const rawX = items[0]?.value?.[0];
        const xText = xMeta?.type === "time"
          ? `${formatTimeValue(rawX, timeScale.scale)} s`
          : `${rawX}`;
        const lines = [`${xText}`];
        items.forEach((item) => {
          const y = item?.value?.[1];
          const yText = Number.isFinite(y) ? String(y) : "-";
          lines.push(`${item.marker || ""}${item.seriesName}: ${yText}`);
        });
        return lines.join("<br>");
      }
    },
    legend: { top: 36, selected: legendSelected },
    grid: { left: 65, right: rightSeries.length ? 65 : 25, top: 68, bottom: 70 },
    xAxis: {
      type: "value",
      name: getAxisLabel(effectiveName(xMeta), xMeta?.type === "time" ? timeScale.unit : effectiveUnit(xMeta)),
      nameLocation: "middle",
      nameGap: 30,
      axisLabel: xMeta?.type === "time"
        ? { formatter: (value) => `${formatTimeValue(value, timeScale.scale)} ${timeScale.unit}` }
        : undefined
    },
    yAxis: [
      {
        type: "value",
        name: leftUnit || "Y",
        splitLine: { show: true },
        axisLabel: { formatter: (v) => formatAxisValue(v) },
        min: leftRange ? leftRange.min : null,
        max: leftRange ? leftRange.max : null
      },
      {
        type: "value",
        show: rightSeries.length > 0,
        name: rightUnit || "Y2",
        axisLabel: { formatter: (v) => formatAxisValue(v) },
        min: rightRange ? rightRange.min : null,
        max: rightRange ? rightRange.max : null
      }
    ],
    dataZoom: [{ type: "slider", bottom: 18 }],
    toolbox: {
      right: 10,
      feature: {
        saveAsImage: { pixelRatio: 2 },
        dataZoom: {}
      }
    },
    series: allSeries
  };
}

export function mountChart(dom, option) {
  const chart = echarts.init(dom, null, { renderer: "canvas" });
  chart.setOption(option, true);
  return chart;
}

export function exportChartPng(chart, filename) {
  const url = chart.getDataURL({ type: "png", pixelRatio: 2, backgroundColor: "#fff" });
  downloadDataUrl(url, filename);
}

export function exportChartSvg(option, filename) {
  const holder = document.createElement("div");
  holder.style.cssText = "position:absolute;left:-9999px;top:-9999px;width:1200px;height:700px;";
  document.body.appendChild(holder);
  const svgChart = echarts.init(holder, null, { renderer: "svg" });
  svgChart.setOption(option, true);
  const url = svgChart.getDataURL({ type: "svg", backgroundColor: "#fff" });
  svgChart.dispose();
  holder.remove();
  downloadDataUrl(url, filename);
}

function downloadDataUrl(url, filename) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
}
