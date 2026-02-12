import { parseCsvFile, parseCsvText, parseLocaleNumber } from "./parseCsv.js";
import { buildGraphOption, computeYAxisRanges, exportChartPng, exportChartSvg, makeDefaultSeries, mountChart } from "./chartRenderer.js";
import { downloadJson, loadSettingsStore, readJsonFile, saveSettingsStore } from "./storage.js";

const state = {
  dataset: null,
  graphs: [],
  chartInstances: new Map(),
  pendingImportedConfig: null,
  printOrientation: "portrait",
  dragColumnIndex: null,
  graphErrors: {},
  chartAspect: { w: 16, h: 9 },
  hideNullColumns: false,
  settingsStore: { autoLoadSetting: null, settings: [] },
  activeSettingId: null,
  previewExpanded: false
};


const dom = {
  dropZone: document.querySelector("#dropZone"),
  csvInput: document.querySelector("#csvInput"),
  pickFileBtn: document.querySelector("#pickFileBtn"),
  loadSampleBtn: document.querySelector("#loadSampleBtn"),
  fileMeta: document.querySelector("#fileMeta"),
  errorBox: document.querySelector("#errorBox"),
  summaryGrid: document.querySelector("#summaryGrid"),
  previewTable: document.querySelector("#previewTable"),
  openColumnSettingsBtn: document.querySelector("#openColumnSettingsBtn"),
  closeColumnSettingsBtn: document.querySelector("#closeColumnSettingsBtn"),
  columnSettingsOverlay: document.querySelector("#columnSettingsOverlay"),
  columnSettingsList: document.querySelector("#columnSettingsList"),
  hideNullColumnsToggle: document.querySelector("#hideNullColumnsToggle"),
  pageDate: document.querySelector("#pageDate"),
  printNoteInput: document.querySelector("#printNoteInput"),
  printNoteOutput: document.querySelector("#printNoteOutput"),
  main: document.querySelector(".main"),
  settingsList: document.querySelector("#settingsList"),
  settingNameInput: document.querySelector("#settingNameInput"),
  settingNewBtn: document.querySelector("#settingNewBtn"),
  settingUpdateBtn: document.querySelector("#settingUpdateBtn"),
  settingDeleteBtn: document.querySelector("#settingDeleteBtn"),
  settingExportBtn: document.querySelector("#settingExportBtn"),
  settingImportBtn: document.querySelector("#settingImportBtn"),
  settingsImportInput: document.querySelector("#settingsImportInput"),
  chartsContainer: document.querySelector("#chartsContainer"),
  ratioPreset: document.querySelector("#ratioPreset"),
  ratioCustomWrap: document.querySelector("#ratioCustomWrap"),
  ratioWidth: document.querySelector("#ratioWidth"),
  ratioHeight: document.querySelector("#ratioHeight"),
  printBtn: document.querySelector("#printBtn"),
  printOrientation: document.querySelector("#printOrientation")
};


function setError(message = "") {
  dom.errorBox.hidden = !message;
  dom.errorBox.textContent = message;
}

function setGraphError(graphId, message = "") {
  if (!graphId) return;
  if (!message) delete state.graphErrors[graphId];
  else state.graphErrors[graphId] = message;
}

function resetCharts() {
  for (const payload of state.chartInstances.values()) {
    if (payload?.chart && typeof payload.chart.dispose === "function") {
      payload.chart.dispose();
    }
  }
  state.chartInstances.clear();
}

function renderSummary(dataset) {
  const visibleColumns = state.hideNullColumns && dataset.nullishColumns
    ? dataset.columns.length - dataset.nullishColumns.size
    : dataset.columnCount;
  const rows = [
    ["Fichier", dataset.fileName],
    ["Lignes", dataset.rowCount],
    ["Colonnes", visibleColumns]
  ];
  dom.summaryGrid.innerHTML = rows.map(([k, v]) => `
    <div class="summary-item">
      <span class="k">${escapeHtml(String(k))}</span>
      <span class="v">${escapeHtml(String(v))}</span>
    </div>
  `).join("");
}

function renderPreview(dataset) {
  const visibleIndices = getVisibleColumnIndices();
  const headers = visibleIndices.map((idx) => getColumnBaseName(dataset.columns[idx]));
  const rows = state.previewExpanded ? dataset.previewRows : dataset.previewRows.slice(0, 5);
  const head = `<thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead>`;
  const body = `<tbody>${rows.map((row) => (
    `<tr>${visibleIndices.map((idx) => `<td>${escapeHtml(row[idx])}</td>`).join("")}</tr>`
  )).join("")}</tbody>`;
  dom.previewTable.innerHTML = head + body;
}

function renderPreviewToggle(dataset) {
  const wrap = document.querySelector("#previewToggleWrap");
  const btn = document.querySelector("#previewToggleBtn");
  if (!wrap || !btn) return;
  if (!dataset || dataset.previewRows.length <= 5) {
    wrap.hidden = true;
    return;
  }
  wrap.hidden = false;
  btn.textContent = state.previewExpanded ? "Voir moins" : "Voir plus";
}

function getColumnDisplayName(col) {
  return (col?.customName || "").trim() || col?.name || "";
}

function getColumnBaseName(col) {
  return col?.name || "";
}
function getColumnDisplayUnit(col) {
  return (col?.customUnit || "").trim() || col?.unit || "";
}

function propagateColumnMetaChange(columnIndex, nextName, nextUnit) {
  if (!state.dataset) return;
  const col = state.dataset.columns[columnIndex];
  if (!col) return;
  if (typeof nextName === "string") {
    col.customName = nextName.trim();
    const resolvedName = getColumnDisplayName(col);
    state.graphs.forEach((g) => {
      g.series.forEach((s) => {
        if (s.columnIndex === columnIndex) s.label = resolvedName;
      });
    });
  }
  if (typeof nextUnit === "string") {
    col.customUnit = nextUnit.trim();
    const resolvedUnit = getColumnDisplayUnit(col);
    state.graphs.forEach((g) => {
      g.series.forEach((s) => {
        if (s.columnIndex === columnIndex) s.unit = resolvedUnit;
      });
    });
  }
}

function refreshAllGraphCharts() {
  for (const graph of state.graphs) {
    if (graph?.id) refreshGraphChart(graph.id);
  }
}

function updateColumnUi(columnIndex) {
  if (!state.dataset) return;
  const col = state.dataset.columns[columnIndex];
  if (!col) return;
  const displayName = getColumnDisplayName(col);
  const displayUnit = getColumnDisplayUnit(col);

  if (state.hideNullColumns) {
    renderPreview(state.dataset);
    renderPreviewToggle(state.dataset);
  } else {
    const previewHeader = dom.previewTable.querySelector(`thead th:nth-child(${columnIndex + 1})`);
    if (previewHeader) previewHeader.textContent = displayName;
  }

  const colSettingsName = dom.columnSettingsList.querySelector(`input[data-col-setting="name"][data-col-index="${columnIndex}"]`);
  if (colSettingsName) colSettingsName.value = col.customName || "";
  const colSettingsUnit = dom.columnSettingsList.querySelector(`input[data-col-setting="unit"][data-col-index="${columnIndex}"]`);
  if (colSettingsUnit) colSettingsUnit.value = col.customUnit || "";

  document.querySelectorAll(`.chart-col-item[data-colindex="${columnIndex}"]`).forEach((item) => {
    const nameWrap = item.querySelector("div");
    if (nameWrap) {
      nameWrap.innerHTML = `<strong>${columnIndex}.</strong> ${escapeHtml(displayName)}`;
    }
    const meta = item.querySelector(".meta");
    if (meta) {
      meta.textContent = `${col.type} ${displayUnit ? `| ${displayUnit}` : ""}`.trim();
    }
  });

  document.querySelectorAll(`.series-source-cell[data-colindex="${columnIndex}"]`).forEach((cell) => {
    cell.textContent = `${columnIndex}. ${col.name || "Column"}`;
    cell.title = `${columnIndex}. ${col.name || "Column"}`;
  });

  document.querySelectorAll(`input[data-field="label"][data-colindex="${columnIndex}"]`).forEach((input) => {
    input.value = displayName;
  });
  document.querySelectorAll(`input[data-field="unit"][data-colindex="${columnIndex}"]`).forEach((input) => {
    input.value = displayUnit;
  });
  notifyConfigChanged();
}

function renderColumnSettings() {
  if (!state.dataset || !dom.columnSettingsList) {
    if (dom.columnSettingsList) dom.columnSettingsList.innerHTML = "";
    return;
  }
  dom.columnSettingsList.innerHTML = `
    <div class="column-settings-table-wrap">
      <table class="column-settings-table">
        <colgroup>
          <col class="col-idx">
          <col class="col-source">
          <col class="col-display">
          <col class="col-unit">
        </colgroup>
        <thead>
          <tr>
            <th>#</th>
            <th>Nom source</th>
            <th>Nom affiche</th>
            <th>Unite</th>
          </tr>
        </thead>
        <tbody>
          ${state.dataset.columns
            .map((col, idx) => ({ col, idx }))
            .filter(({ idx }) => shouldShowColumn(idx))
            .map(({ col, idx }) => `
            <tr>
              <td>${idx}</td>
              <td class="source-cell" title="${escapeHtml(col.name)}">${escapeHtml(col.name)}</td>
              <td class="input-cell">
                <input
                  type="text"
                  data-col-setting="name"
                  data-col-index="${idx}"
                  name="col_display_${idx}"
                  autocomplete="off"
                  autocapitalize="off"
                  autocorrect="off"
                  spellcheck="false"
                  data-lpignore="true"
                  data-1p-ignore="true"
                  data-form-type="other"
                  value="${escapeHtml(col.customName || "")}"
                  placeholder="${escapeHtml(getColumnDisplayName(col) || "Nom affiche...")}"
                >
              </td>
              <td class="input-cell">
                <input
                  type="text"
                  data-col-setting="unit"
                  data-col-index="${idx}"
                  name="col_unit_${idx}"
                  autocomplete="off"
                  autocapitalize="off"
                  autocorrect="off"
                  spellcheck="false"
                  data-lpignore="true"
                  data-1p-ignore="true"
                  data-form-type="other"
                  value="${escapeHtml(col.customUnit || "")}"
                  placeholder="${escapeHtml(getColumnDisplayUnit(col) || "Unite (V, A, mAh, ...)")}"
                >
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function openColumnSettingsOverlay() {
  if (!dom.columnSettingsOverlay) return;
  dom.columnSettingsOverlay.classList.remove("hidden");
  dom.columnSettingsOverlay.setAttribute("aria-hidden", "false");
}

function closeColumnSettingsOverlay() {
  if (!dom.columnSettingsOverlay) return;
  dom.columnSettingsOverlay.classList.add("hidden");
  dom.columnSettingsOverlay.setAttribute("aria-hidden", "true");
}

function sanitizeGraphConfig(config) {
  if (!state.dataset) return null;
  const maxIndex = state.dataset.columns.length - 1;
  const series = (config.series || [])
    .filter((s) => Number.isInteger(s.columnIndex) && s.columnIndex >= 0 && s.columnIndex <= maxIndex)
    .map((s) => ({
      columnIndex: s.columnIndex,
      label: s.label || getColumnDisplayName(state.dataset.columns[s.columnIndex]) || "Serie",
      unit: typeof s.unit === "string" ? s.unit : getColumnDisplayUnit(state.dataset.columns[s.columnIndex]),
      color: s.color || "#1f77b4",
      axis: s.axis === "right" ? "right" : "left",
      visible: s.visible !== false
    }));
  const xColumnIndex = Number.isInteger(config.xColumnIndex) && config.xColumnIndex >= 0 && config.xColumnIndex <= maxIndex
    ? config.xColumnIndex
    : state.dataset.timeColumnIndex;
  return {
    id: config.id || crypto.randomUUID(),
    title: config.title || `Graphique ${state.graphs.length + 1}`,
    xColumnIndex,
    type: config.type === "scatter" ? "scatter" : "line",
    smoothing: Math.max(1, Number(config.smoothing) || 1),
    showMinMax: Boolean(config.showMinMax),
    rangeMin: Number.isFinite(config.rangeMin) ? config.rangeMin : null,
    rangeMax: Number.isFinite(config.rangeMax) ? config.rangeMax : null,
    printSelected: config.printSelected !== false,
    series
  };
}

function nextGraphTitle() {
  return `Graphique ${state.graphs.length + 1}`;
}

function buildEmptyGraphConfig() {
  return sanitizeGraphConfig({
    id: crypto.randomUUID(),
    title: nextGraphTitle(),
    xColumnIndex: state.dataset.timeColumnIndex,
    type: "line",
    smoothing: 1,
    showMinMax: false,
    rangeMin: null,
    rangeMax: null,
    printSelected: true,
    series: []
  });
}

function addColumnAsCurve(graph, columnIndex) {
  if (!state.dataset || !graph) return { ok: false, message: "Graphique invalide." };
  if (!Number.isInteger(columnIndex)) return { ok: false, message: "Colonne invalide." };
  if (columnIndex < 0 || columnIndex >= state.dataset.columns.length) return { ok: false, message: "Colonne hors limite." };
  if (columnIndex === graph.xColumnIndex) return { ok: false, message: "La colonne X ne peut pas être ajoutée en courbe." };
  const meta = state.dataset.columns[columnIndex];
  if (!meta || meta.type === "text") return { ok: false, message: "Cette colonne n'est pas numérique." };
  if (graph.series.some((s) => s.columnIndex === columnIndex)) return { ok: false, message: "Cette courbe est déjà présente." };
  const base = makeDefaultSeries(meta, graph.series.length);
  base.columnIndex = columnIndex;
  graph.series.push(base);
  return { ok: true, message: "" };
}

function createGraph() {
  if (!state.dataset) {
    setError("Charge d'abord un CSV.");
    return;
  }
  const cfg = buildEmptyGraphConfig();
  if (!cfg) {
    setError("Impossible de créer un graphique vide.");
    return;
  }
  state.graphs.push(cfg);
  setError("");
  renderCharts();
  notifyConfigChanged();
}

function refreshGraphChart(graphId) {
  if (!state.dataset) return;
  const graph = state.graphs.find((g) => g.id === graphId);
  const payload = state.chartInstances.get(graphId);
  if (!graph || !payload?.chart) return;
  const option = buildGraphOption(state.dataset, graph);
  payload.option = option;
  payload.chart.setOption(option, true);
  applyVerticalFit(payload.chart, graph);
}

function resolveZoomRange(chart, zoomEvent) {
  const payload = Array.isArray(zoomEvent?.batch) ? zoomEvent.batch[0] : zoomEvent;
  let rangeMin = Number.isFinite(payload?.startValue) ? payload.startValue : null;
  let rangeMax = Number.isFinite(payload?.endValue) ? payload.endValue : null;
  if (rangeMin != null && rangeMax != null) return { rangeMin, rangeMax };

  const option = chart.getOption?.() || {};
  const zoom = Array.isArray(option.dataZoom) ? option.dataZoom[0] : null;
  const start = Number.isFinite(payload?.start) ? payload.start : zoom?.start;
  const end = Number.isFinite(payload?.end) ? payload.end : zoom?.end;
  const model = chart.getModel?.();
  const axis = model?.getComponent?.("xAxis", 0)?.axis;
  const extent = axis?.scale?.getExtent?.();
  if (!extent || !Number.isFinite(extent[0]) || !Number.isFinite(extent[1])) {
    return { rangeMin: null, rangeMax: null };
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return { rangeMin: null, rangeMax: null };
  }
  const span = extent[1] - extent[0];
  return {
    rangeMin: extent[0] + span * (start / 100),
    rangeMax: extent[0] + span * (end / 100)
  };
}

function applyVerticalFit(chart, graph, zoomEvent) {
  if (!state.dataset || !chart || !graph) return;
  const { rangeMin, rangeMax } = resolveZoomRange(chart, zoomEvent);
  const ranges = computeYAxisRanges(state.dataset, graph, rangeMin, rangeMax);
  chart.setOption({
    yAxis: [
      {
        min: ranges.leftRange ? ranges.leftRange.min : null,
        max: ranges.leftRange ? ranges.leftRange.max : null
      },
      {
        min: ranges.rightRange ? ranges.rightRange.min : null,
        max: ranges.rightRange ? ranges.rightRange.max : null
      }
    ]
  });
}

function applyChartAspectToCard(card, graphId) {
  if (!card) return;
  const host = card.querySelector(".chart-host");
  if (!host) return;
  const width = host.clientWidth;
  if (!Number.isFinite(width) || width <= 0) return;
  const ratio = state.chartAspect;
  const height = Math.max(200, Math.round(width * (ratio.h / ratio.w)));
  host.style.height = `${height}px`;
  const payload = state.chartInstances.get(graphId);
  if (payload?.chart) payload.chart.resize();
}

function applyChartAspectAll() {
  const cards = [...document.querySelectorAll(".chart-card")];
  cards.forEach((card) => {
    const id = card.dataset.id;
    if (id) applyChartAspectToCard(card, id);
  });
}

function syncSeriesVisibilityUi(card, graph) {
  if (!card || !graph) return;
  const inputs = card.querySelectorAll("input[data-field='visible'][data-sidx]");
  inputs.forEach((input) => {
    const sIdx = Number(input.dataset.sidx);
    if (!Number.isInteger(sIdx) || !graph.series[sIdx]) return;
    input.checked = graph.series[sIdx].visible !== false;
  });
}

function renderCharts() {
  const scrollTop = dom.main ? dom.main.scrollTop : 0;
  resetCharts();
  dom.chartsContainer.innerHTML = "";
  state.graphs.forEach((graph, idx) => {
    const card = document.createElement("article");
    card.className = "chart-card";
    card.dataset.id = graph.id;
    card.innerHTML = `
      <div class="chart-top">
        <div class="chart-head-row">
          <div class="chart-head-left">
            <label class="title-field">
              <span class="title-label">Titre</span>
              <input class="title-input" type="text" value="${escapeHtml(graph.title)}" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" data-lpignore="true" data-1p-ignore="true" data-form-type="other">
              <span class="chart-title-print">${escapeHtml(graph.title)}</span>
            </label>
            <label class="inline print-toggle">
              <input class="print-check" type="checkbox" ${graph.printSelected ? "checked" : ""}>
              Inclure dans impression
            </label>
          </div>
          <div class="chart-actions">
            <button type="button" data-action="png">Exporter PNG</button>
            <button type="button" data-action="svg" class="ghost">Exporter SVG</button>
            <button type="button" data-action="delete" class="ghost">Supprimer</button>
          </div>
        </div>
        <div class="series-editor"></div>
        <p class="chart-error ${state.graphErrors[graph.id] ? "" : "hidden"}">${escapeHtml(state.graphErrors[graph.id] || "")}</p>
      </div>
      <div class="chart-content">
        <div class="chart-dropzone">
          <div class="chart-host"></div>
        </div>
        <aside class="chart-column-panel">
          <h3>Colonnes</h3>
          <div class="chart-column-list">
            ${state.dataset.columns
            .map((col, colIdx) => ({ col, colIdx }))
            .filter(({ colIdx }) => shouldShowColumn(colIdx))
            .filter(({ colIdx }) => colIdx !== graph.xColumnIndex)
            .filter(({ colIdx }) => !graph.series.some((s) => s.columnIndex === colIdx))
            .map(({ col, colIdx }) => {
              const isNumeric = col.type !== "text";
              const draggable = isNumeric;
              return `
                <div
                  class="chart-col-item ${draggable ? "" : "disabled"}"
                  draggable="${draggable ? "true" : "false"}"
                  data-colindex="${colIdx}"
                  title="${draggable ? "Glisser vers le graphique" : "Non disponible"}"
                >
                  <div><strong>${colIdx}.</strong> ${escapeHtml(getColumnDisplayName(col))}</div>
                  <div class="meta">${escapeHtml(col.type)} ${getColumnDisplayUnit(col) ? `| ${escapeHtml(getColumnDisplayUnit(col))}` : ""}</div>
                </div>
              `;
            }).join("")}
          </div>
        </aside>
      </div>
    `;
    dom.chartsContainer.appendChild(card);


    const editor = card.querySelector(".series-editor");
    if (!graph.series.length) {
      const empty = document.createElement("p");
      empty.className = "muted series-empty";
      empty.textContent = "Aucune courbe pour le moment.";
      editor.appendChild(empty);
    } else {
      editor.innerHTML = `
        <div class="series-table-wrap">
          <table class="series-table">
            <thead>
              <tr>
                <th>Source</th>
                <th>Nom</th>
                <th>Unite</th>
                <th>Min/Max</th>
                <th>Couleur</th>
                <th>Axe</th>
                <th>Afficher</th>
                <th>Suppr.</th>
              </tr>
            </thead>
            <tbody></tbody>
          </table>
        </div>
      `;
    }
    const seriesTbody = card.querySelector(".series-table tbody");
    graph.series.forEach((serie, sIdx) => {
      if (!seriesTbody) return;
      const sourceCol = state.dataset.columns[serie.columnIndex];
      const sourceLabel = `${serie.columnIndex}. ${sourceCol?.name || "Column"}`;
      const row = document.createElement("tr");
      row.className = "series-row";
      row.dataset.colindex = String(serie.columnIndex);
      row.innerHTML = `
        <td class="series-source-cell" data-colindex="${serie.columnIndex}" title="${escapeHtml(sourceLabel)}">
          ${escapeHtml(sourceLabel)}
        </td>
        <td class="input-cell">
          <input data-field="label" data-sidx="${sIdx}" data-colindex="${serie.columnIndex}" type="text" value="${escapeHtml(serie.label)}">
        </td>
        <td class="input-cell">
          <input data-field="unit" data-sidx="${sIdx}" data-colindex="${serie.columnIndex}" type="text" value="${escapeHtml(serie.unit || "")}" placeholder="${escapeHtml(getColumnDisplayUnit(sourceCol) || "Unite")}">
        </td>
        <td class="series-minmax-cell input-cell">
          <input data-field="showMinMax" type="checkbox" ${graph.showMinMax ? "checked" : ""}>
        </td>
        <td class="series-color-cell input-cell">
          <div class="color-cell-control" style="--series-color: ${escapeHtml(serie.color)};">
            <input data-field="color" data-sidx="${sIdx}" type="color" value="${escapeHtml(serie.color)}">
          </div>
        </td>
        <td class="input-cell">
          <select data-field="axis" data-sidx="${sIdx}">
            <option value="left" ${serie.axis === "left" ? "selected" : ""}>Gauche</option>
            <option value="right" ${serie.axis === "right" ? "selected" : ""}>Droit</option>
          </select>
        </td>
        <td class="series-on-cell input-cell">
          <input data-field="visible" data-sidx="${sIdx}" type="checkbox" ${serie.visible ? "checked" : ""}>
        </td>
        <td class="series-delete-cell">
          <button type="button" class="ghost series-delete-btn" data-action="remove-series" data-sidx="${sIdx}" aria-label="Supprimer la courbe">X</button>
        </td>
      `;
      seriesTbody.appendChild(row);
    });

    const host = card.querySelector(".chart-host");
    const option = buildGraphOption(state.dataset, graph);
    const chart = mountChart(host, option);
    state.chartInstances.set(graph.id, { chart, option });
    applyVerticalFit(chart, graph);
    applyChartAspectToCard(card, graph.id);
    chart.on("dataZoom", (event) => {
      applyVerticalFit(chart, graph, event);
    });
    chart.on("legendselectchanged", (event) => {
      const selected = event?.selected || {};
      graph.series.forEach((serie) => {
        const name = serie.label || getColumnDisplayName(state.dataset.columns[serie.columnIndex]) || "Column";
        if (Object.prototype.hasOwnProperty.call(selected, name)) {
          serie.visible = selected[name] !== false;
        }
      });
      syncSeriesVisibilityUi(card, graph);
      applyVerticalFit(chart, graph);
    });

    const colPanel = card.querySelector(".chart-column-panel");
    const colList = card.querySelector(".chart-column-list");
    if (colPanel && colList) {
      const syncScrollShadow = () => {
        const hasOverflow = colList.scrollHeight > colList.clientHeight + 1;
        const hasScrolled = colList.scrollTop > 1;
        colPanel.classList.toggle("has-more-below", hasOverflow && hasScrolled);
      };
      colList.addEventListener("scroll", syncScrollShadow, { passive: true });
      syncScrollShadow();
    }
  });

  const addWrap = document.createElement("div");
  addWrap.className = "add-graph-wrap no-print";
  addWrap.innerHTML = `
    <button id="addGraphInlineBtn" type="button">Ajouter un graphique</button>
  `;
  dom.chartsContainer.appendChild(addWrap);

  if (dom.main) {
    requestAnimationFrame(() => {
      dom.main.scrollTop = scrollTop;
    });
  }
  notifyConfigChanged();
}

function wireChartEvents() {
  const closestFromEvent = (event, selector) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return null;
    return target.closest(selector);
  };

  const resolveDropZone = (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return null;
    return target.closest(".chart-dropzone") || target.closest(".chart-host")?.closest(".chart-dropzone");
  };

  dom.chartsContainer.addEventListener("click", (event) => {
    const btn = closestFromEvent(event, "button[data-action]");
    if (!btn) return;
    const card = closestFromEvent(event, ".chart-card");
    if (!card) return;
    const id = card.dataset.id;
    const idx = state.graphs.findIndex((g) => g.id === id);
    if (idx < 0) return;
    const action = btn.dataset.action;
    if (action === "remove-series") {
      const sIdx = Number(btn.dataset.sidx);
      if (!Number.isInteger(sIdx) || !state.graphs[idx]?.series?.[sIdx]) return;
      state.graphs[idx].series.splice(sIdx, 1);
      setGraphError(id, "");
      renderCharts();
      notifyConfigChanged();
      return;
    }
    if (action === "delete") {
      state.graphs.splice(idx, 1);
      setGraphError(id, "");
      renderCharts();
      notifyConfigChanged();
      return;
    }
    if (action === "png") {
      const payload = state.chartInstances.get(id);
      if (payload) exportChartPng(payload.chart, `${slugify(state.graphs[idx].title)}.png`);
      return;
    }
    if (action === "svg") {
      const payload = state.chartInstances.get(id);
      if (payload) exportChartSvg(payload.option, `${slugify(state.graphs[idx].title)}.svg`);
    }
  });

  dom.chartsContainer.addEventListener("click", (event) => {
    const addBtn = closestFromEvent(event, "#addGraphInlineBtn");
    if (!addBtn) return;
    createGraph();
  });


  dom.chartsContainer.addEventListener("dragstart", (event) => {
    const item = closestFromEvent(event, ".chart-col-item");
    if (!item || item.getAttribute("draggable") !== "true") return;
    const colIndex = item.dataset.colindex;
    if (!event.dataTransfer || colIndex == null) return;
    state.dragColumnIndex = Number(colIndex);
    item.classList.add("dragging");
    event.dataTransfer.setData("text/plain", colIndex);
    event.dataTransfer.setData("application/x-futaba-column", colIndex);
    event.dataTransfer.effectAllowed = "copy";
  });

  dom.chartsContainer.addEventListener("dragend", (event) => {
    const item = closestFromEvent(event, ".chart-col-item");
    if (item) item.classList.remove("dragging");
    document.querySelectorAll(".chart-dropzone.drag-over").forEach((zone) => zone.classList.remove("drag-over"));
    state.dragColumnIndex = null;
  });

  dom.chartsContainer.addEventListener("dragenter", (event) => {
    const zone = resolveDropZone(event);
    if (!zone) return;
    event.preventDefault();
    zone.classList.add("drag-over");
  });

  dom.chartsContainer.addEventListener("dragover", (event) => {
    const zone = resolveDropZone(event);
    if (!zone) return;
    event.preventDefault();
    zone.classList.add("drag-over");
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  });

  dom.chartsContainer.addEventListener("dragleave", (event) => {
    const zone = resolveDropZone(event);
    if (!zone) return;
    zone.classList.remove("drag-over");
  });

  dom.chartsContainer.addEventListener("drop", (event) => {
    const zone = resolveDropZone(event);
    if (!zone) return;
    event.preventDefault();
    zone.classList.remove("drag-over");
    const card = zone.closest(".chart-card");
    if (!card) return;
    const id = card.dataset.id;
    const graph = state.graphs.find((g) => g.id === id);
    if (!graph) return;
    const raw = event.dataTransfer?.getData("application/x-futaba-column")
      || event.dataTransfer?.getData("text/plain");
    const parsed = Number(raw);
    const colIndex = Number.isInteger(parsed) ? parsed : state.dragColumnIndex;
    const result = addColumnAsCurve(graph, colIndex);
    if (!result.ok) {
      setGraphError(id, result.message);
      state.dragColumnIndex = null;
      renderCharts();
      return;
    }
    setGraphError(id, "");
    state.dragColumnIndex = null;
    renderCharts();
    notifyConfigChanged();
  });

  dom.chartsContainer.addEventListener("input", (event) => {
    const card = closestFromEvent(event, ".chart-card");
    if (!card) return;
    const id = card.dataset.id;
    const graph = state.graphs.find((g) => g.id === id);
    if (!graph) return;

    if (event.target.classList.contains("title-input")) {
      graph.title = event.target.value || "Sans titre";
      const titlePrint = card.querySelector(".chart-title-print");
      if (titlePrint) titlePrint.textContent = graph.title;
      refreshGraphChart(id);
      notifyConfigChanged();
      return;
    }
    if (event.target.classList.contains("print-check")) {
      graph.printSelected = event.target.checked;
      notifyConfigChanged();
      return;
    }

    const field = event.target.dataset.field;
    const sIdx = Number(event.target.dataset.sidx);
    if (!field) return;
    if (field === "showMinMax") {
      graph.showMinMax = event.target.checked;
      refreshGraphChart(id);
      notifyConfigChanged();
      return;
    }
    if (!Number.isInteger(sIdx) || !graph.series[sIdx]) return;
    if (field === "visible") graph.series[sIdx].visible = event.target.checked;
    if (field === "label") {
      const colIdx = graph.series[sIdx].columnIndex;
      propagateColumnMetaChange(colIdx, event.target.value, null);
      updateColumnUi(colIdx);
      refreshAllGraphCharts();
      notifyConfigChanged();
      return;
    }
    if (field === "unit") {
      const colIdx = graph.series[sIdx].columnIndex;
      propagateColumnMetaChange(colIdx, null, event.target.value);
      updateColumnUi(colIdx);
      refreshAllGraphCharts();
      notifyConfigChanged();
      return;
    }
    if (field === "color") {
      graph.series[sIdx].color = event.target.value;
      const swatch = event.target.closest(".color-cell-control");
      if (swatch) swatch.style.setProperty("--series-color", event.target.value);
    }
    if (field === "axis") graph.series[sIdx].axis = event.target.value === "right" ? "right" : "left";
    refreshGraphChart(id);
    notifyConfigChanged();
  });
}

function onDatasetReady(dataset) {
  state.dataset = dataset;
  state.dataset.nullishColumns = computeNullishColumns(dataset);
  dom.fileMeta.textContent = `${dataset.fileName} | ${dataset.rowCount} lignes`;
  state.previewExpanded = false;
  renderSummary(dataset);
  renderPreview(dataset);
  renderPreviewToggle(dataset);
  renderColumnSettings();
  setError("");
  if (state.pendingImportedConfig) {
    loadGraphConfig(state.pendingImportedConfig);
    state.pendingImportedConfig = null;
  } else if (state.activeSettingId) {
    const active = state.settingsStore.settings.find((s) => s.id === state.activeSettingId);
    if (active?.config) loadGraphConfig(active.config);
  } else {
    state.graphs = [];
    state.graphErrors = {};
    renderCharts();
  }
}

function getConfigPayload() {
  const columnSettings = state.dataset
    ? state.dataset.columns.map((col, idx) => ({
      index: idx,
      customName: normalizeCustomValue(col.customName, col.name),
      customUnit: normalizeCustomValue(col.customUnit, col.unit)
    }))
    : [];
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    printOrientation: state.printOrientation,
    chartAspect: state.chartAspect,
    hideNullColumns: state.hideNullColumns,
    graphs: state.graphs,
    columnSettings
  };
}

function normalizeCustomValue(customValue, baseValue) {
  const custom = String(customValue || "").trim();
  const base = String(baseValue || "").trim();
  if (!custom || custom === base) return "";
  return custom;
}

function loadGraphConfig(payload) {
  if (!state.dataset) {
    state.pendingImportedConfig = payload;
    setError("Config importée. Charge un CSV pour appliquer les graphiques.");
    return;
  }
  const next = (payload?.graphs || [])
    .map((g) => sanitizeGraphConfig(g))
    .filter(Boolean);
  state.graphs = next;
  const incomingColumnSettings = Array.isArray(payload?.columnSettings) ? payload.columnSettings : [];
  for (const item of incomingColumnSettings) {
    const idx = Number(item?.index);
    if (!Number.isInteger(idx) || idx < 0 || idx >= state.dataset.columns.length) continue;
    if (typeof item?.customName === "string") {
      state.dataset.columns[idx].customName = item.customName.trim();
    } else if (typeof item?.name === "string") {
      state.dataset.columns[idx].customName = item.name.trim();
    }
    if (typeof item?.customUnit === "string") {
      state.dataset.columns[idx].customUnit = item.customUnit.trim();
    } else if (typeof item?.unit === "string") {
      state.dataset.columns[idx].customUnit = item.unit.trim();
    }
  }
  state.graphErrors = {};
  state.printOrientation = payload?.printOrientation === "landscape" ? "landscape" : "portrait";
  dom.printOrientation.value = state.printOrientation;
  state.hideNullColumns = payload?.hideNullColumns === true;
  if (dom.hideNullColumnsToggle) dom.hideNullColumnsToggle.checked = state.hideNullColumns;
  if (payload?.chartAspect) {
    const w = Number(payload.chartAspect.w);
    const h = Number(payload.chartAspect.h);
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
      state.chartAspect = { w, h };
      if (dom.ratioWidth) dom.ratioWidth.value = w;
      if (dom.ratioHeight) dom.ratioHeight.value = h;
      if (dom.ratioPreset) dom.ratioPreset.value = resolvePresetFromAspect();
      setCustomVisibility(dom.ratioPreset?.value || "custom");
      applyChartAspectAll();
    }
  }
  renderColumnSettings();
  if (state.dataset) {
    renderSummary(state.dataset);
    renderPreview(state.dataset);
    renderPreviewToggle(state.dataset);
  }
  renderCharts();
  renderSettingsUi();
}

async function loadSample() {
  const candidates = ["./public/sample.csv", "./Exemples/00022779.csv"];
  let lastErr = null;
  for (const path of candidates) {
    try {
      const response = await fetch(path);
      if (!response.ok) continue;
      const text = await response.text();
      const dataset = await parseCsvText(text, path.split("/").pop() || "sample.csv");
      onDatasetReady(dataset);
      return;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error("Impossible de charger l'exemple.");
}

function handleFile(file) {
  if (!file) return;
  parseCsvFile(file)
    .then(onDatasetReady)
    .catch((err) => setError(`Erreur CSV: ${err.message || err}`));
}

async function loadCsvFromPath(path) {
  const cleanPath = String(path || "").trim();
  if (!cleanPath) {
    setError("Indique un chemin CSV dev.");
    return;
  }
  try {
    const response = await fetch(cleanPath);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} sur ${cleanPath}`);
    }
    const text = await response.text();
    const fileName = cleanPath.split("/").pop() || cleanPath;
    const dataset = await parseCsvText(text, fileName);
    onDatasetReady(dataset);
    setError("");
  } catch (err) {
    setError(`Erreur chargement chemin dev: ${err.message || err}`);
  }
}

function printSelectedCharts() {
  const selected = state.graphs.filter((g) => g.printSelected);
  if (!selected.length) {
    setError("Aucun graphique sélectionné pour impression.");
    return;
  }
  document.documentElement.classList.add("force-print-layout");
  applyPrintCardWidth();
  updatePrintPageStyle();
  const selectedIds = new Set(selected.map((g) => g.id));
  const cards = [...document.querySelectorAll(".chart-card")];
  const hiddenCards = [];
  for (const card of cards) {
    const id = card.dataset.id;
    if (!selectedIds.has(id)) {
      card.classList.add("print-hidden");
      hiddenCards.push(card);
    }
  }

  applyChartAspectAll();
  void document.body.offsetHeight;

  const cleanup = () => {
    hiddenCards.forEach((card) => card.classList.remove("print-hidden"));
    document.documentElement.classList.remove("force-print-layout");
    window.removeEventListener("afterprint", cleanup);
  };
  window.addEventListener("afterprint", cleanup);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      window.print();
    });
  });
}

function wireImportUi() {
  dom.pickFileBtn.addEventListener("click", () => dom.csvInput.click());
  dom.csvInput.addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    if (file) handleFile(file);
  });
  dom.loadSampleBtn.addEventListener("click", () => {
    loadSample().catch((err) => setError(`Erreur exemple: ${err.message || err}`));
  });

  dom.dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dom.dropZone.classList.add("drag-over");
  });
  dom.dropZone.addEventListener("dragleave", () => dom.dropZone.classList.remove("drag-over"));
  dom.dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dom.dropZone.classList.remove("drag-over");
    const file = e.dataTransfer?.files?.[0];
    if (file) handleFile(file);
  });
}

function loadSettingsState() {
  const stored = loadSettingsStore();
  if (stored && Array.isArray(stored.settings)) {
    state.settingsStore = {
      autoLoadSetting: stored.autoLoadSetting || null,
      settings: stored.settings.map((item) => ({
        id: item.id || crypto.randomUUID(),
        name: item.name || "Réglage",
        config: item.config || {}
      }))
    };
    return;
  }
}

function getActiveSetting() {
  return state.settingsStore.settings.find((s) => s.id === state.activeSettingId) || null;
}

function persistSettingsStore() {
  saveSettingsStore(state.settingsStore);
  renderSettingsUi();
}

function setActiveSettingName(value) {
  const active = getActiveSetting();
  if (!active) return;
  active.name = value;
  persistSettingsStore();
}

function saveActiveSettingConfig() {
  const active = getActiveSetting();
  if (!active) return;
  active.config = getConfigPayload();
  persistSettingsStore();
}

function notifyConfigChanged() {
  renderSettingsUi();
}

function isActiveSettingDirty(active) {
  if (!active) return false;
  const current = normalizeConfigForCompare(getConfigPayload());
  const saved = normalizeConfigForCompare(active.config || {});
  return JSON.stringify(current) !== JSON.stringify(saved);
}

function normalizeConfigForCompare(config) {
  if (!config || typeof config !== "object") return {};
  const {
    createdAt: _createdAt,
    ...rest
  } = config;
  return rest;
}

function renderSettingsUi() {
  if (!dom.settingsList || !dom.settingNameInput) return;
  dom.settingsList.innerHTML = "";
  state.settingsStore.settings.forEach((setting) => {
    const item = document.createElement("div");
    item.className = `settings-item ${setting.id === state.activeSettingId ? "active" : ""}`;
    item.dataset.settingId = setting.id;
    item.setAttribute("role", "option");
    item.setAttribute("aria-selected", setting.id === state.activeSettingId ? "true" : "false");
    const isStar = state.settingsStore.autoLoadSetting === setting.id;
    const displayName = (setting.name || "").trim() || "Réglage";
    item.innerHTML = `
      <button type="button" class="settings-star ${isStar ? "active" : ""}" data-setting-id="${setting.id}" title="Réglage au démarrage" aria-label="Définir comme réglage de démarrage">
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M12 3.5l2.6 5.3 5.9.9-4.2 4.1 1 5.9-5.3-2.8-5.3 2.8 1-5.9L3.5 9.7l5.9-.9L12 3.5z" fill="currentColor"/>
        </svg>
      </button>
      <span class="settings-item-name">${escapeHtml(displayName)}</span>
    `;
    dom.settingsList.appendChild(item);
  });
  const active = getActiveSetting();
  dom.settingNameInput.value = active?.name || "";
  dom.settingNameInput.disabled = !active;
  dom.settingUpdateBtn.disabled = !active || !isActiveSettingDirty(active);
  dom.settingDeleteBtn.disabled = !active;
}

function applySettingById(settingId) {
  const setting = state.settingsStore.settings.find((s) => s.id === settingId);
  if (!setting) return;
  state.activeSettingId = setting.id;
  if (state.dataset) {
    loadGraphConfig(setting.config);
  } else {
    state.pendingImportedConfig = setting.config;
  }
}

function createNewSetting() {
  if (!state.dataset) {
    setError("Charge un CSV avant de creer un reglage.");
    return;
  }
  const index = state.settingsStore.settings.length + 1;
  const id = crypto.randomUUID();
  const name = `Réglage ${index}`;
  const config = getConfigPayload();
  state.settingsStore.settings.push({ id, name, config });
  state.activeSettingId = id;
  persistSettingsStore();
}

function updateActiveSetting() {
  saveActiveSettingConfig();
}

function deleteActiveSetting() {
  const active = getActiveSetting();
  if (!active) return;
  state.settingsStore.settings = state.settingsStore.settings.filter((s) => s.id !== active.id);
  if (state.settingsStore.autoLoadSetting === active.id) {
    state.settingsStore.autoLoadSetting = null;
  }
  state.activeSettingId = state.settingsStore.settings[0]?.id || null;
  persistSettingsStore();
}

function wireSettingsUi() {
  if (!dom.settingsList) return;
  dom.settingsList.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const star = target.closest(".settings-star");
    if (star) {
      event.stopPropagation();
      const id = star.dataset.settingId || null;
      if (!id) return;
      state.settingsStore.autoLoadSetting = state.settingsStore.autoLoadSetting === id ? null : id;
      persistSettingsStore();
      return;
    }
    const item = target.closest(".settings-item");
    if (!item) return;
    const id = item.dataset.settingId || null;
    state.activeSettingId = id;
    if (id) applySettingById(id);
    renderSettingsUi();
  });
  dom.settingNameInput.addEventListener("input", () => {
    setActiveSettingName(dom.settingNameInput.value);
  });
  dom.settingNewBtn.addEventListener("click", () => {
    createNewSetting();
  });
  dom.settingUpdateBtn.addEventListener("click", () => {
    updateActiveSetting();
  });
  dom.settingDeleteBtn.addEventListener("click", () => {
    deleteActiveSetting();
  });
  dom.settingExportBtn.addEventListener("click", () => {
    downloadJson("futaba-grapher-settings.json", state.settingsStore);
  });
  dom.settingImportBtn.addEventListener("click", () => {
    dom.settingsImportInput.click();
  });
  dom.settingsImportInput.addEventListener("change", async (event) => {
    try {
      const file = event.target.files?.[0];
      if (!file) return;
      const json = await readJsonFile(file);
      if (!json || !Array.isArray(json.settings)) {
        setError("JSON invalide (liste de réglages manquante).");
        return;
      }
      state.settingsStore = {
        autoLoadSetting: json.autoLoadSetting || null,
        settings: json.settings.map((item) => ({
          id: item.id || crypto.randomUUID(),
          name: item.name || "Réglage",
          config: item.config || {}
        }))
      };
      state.activeSettingId = state.settingsStore.autoLoadSetting || state.settingsStore.settings[0]?.id || null;
      persistSettingsStore();
      setError("");
    } catch (err) {
      setError(`JSON invalide: ${err.message || err}`);
    }
  });
}

function wireColumnSettingsUi() {
  if (!dom.columnSettingsList) return;
  if (dom.hideNullColumnsToggle) {
    dom.hideNullColumnsToggle.checked = state.hideNullColumns;
    dom.hideNullColumnsToggle.addEventListener("change", () => {
      state.hideNullColumns = dom.hideNullColumnsToggle.checked;
      if (state.dataset) {
        renderSummary(state.dataset);
        renderPreview(state.dataset);
        renderColumnSettings();
        renderCharts();
        notifyConfigChanged();
      }
    });
  }
  dom.openColumnSettingsBtn?.addEventListener("click", () => {
    if (!state.dataset) {
      setError("Charge un CSV avant de configurer les colonnes.");
      return;
    }
    setError("");
    openColumnSettingsOverlay();
  });
  dom.closeColumnSettingsBtn?.addEventListener("click", closeColumnSettingsOverlay);
  dom.columnSettingsOverlay?.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (target.closest("[data-overlay-close='true']")) {
      closeColumnSettingsOverlay();
    }
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeColumnSettingsOverlay();
  });

  dom.columnSettingsList.addEventListener("change", (event) => {
    if (!state.dataset) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const input = target.closest("input[data-col-setting]");
    if (!input) return;
    const idx = Number(input.dataset.colIndex);
    if (!Number.isInteger(idx) || idx < 0 || idx >= state.dataset.columns.length) return;
    const field = input.dataset.colSetting;
    if (field === "name") {
      propagateColumnMetaChange(idx, input.value, null);
      updateColumnUi(idx);
      refreshAllGraphCharts();
      notifyConfigChanged();
    } else if (field === "unit") {
      propagateColumnMetaChange(idx, null, input.value);
      updateColumnUi(idx);
      refreshAllGraphCharts();
      notifyConfigChanged();
    }
  });
}

function wireBuilderUi() {
  dom.printBtn.addEventListener("click", printSelectedCharts);
  dom.printOrientation.addEventListener("change", (event) => {
    state.printOrientation = event.target.value === "landscape" ? "landscape" : "portrait";
    applyPrintCardWidth();
    updatePrintPageStyle();
    notifyConfigChanged();
  });
}

function applyPresetToInputs(value) {
  if (!value) return;
  if (value === "custom") return;
  const parts = String(value).split(":");
  const w = Number(parts[0]);
  const h = Number(parts[1]);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return;
  if (dom.ratioWidth) dom.ratioWidth.value = w;
  if (dom.ratioHeight) dom.ratioHeight.value = h;
}

function resolvePresetFromAspect() {
  const w = state.chartAspect.w;
  const h = state.chartAspect.h;
  const presets = [
    "16:9",
    "4:3",
    "3:2",
    "5:4",
    "1:1",
    "21:9",
    "9:16"
  ];
  for (const preset of presets) {
    const [pw, ph] = preset.split(":").map(Number);
    if (pw === w && ph === h) return preset;
  }
  return "custom";
}

function setCustomVisibility(presetValue) {
  if (!dom.ratioCustomWrap) return;
  dom.ratioCustomWrap.hidden = presetValue !== "custom";
}

function applyChartAspectFromInputs(options = {}) {
  const w = Number(dom.ratioWidth?.value);
  const h = Number(dom.ratioHeight?.value);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return;
  state.chartAspect = { w, h };
  const keepCustom = options?.keepCustom === true;
  if (!keepCustom && dom.ratioPreset) dom.ratioPreset.value = resolvePresetFromAspect();
  const currentPreset = dom.ratioPreset?.value || "custom";
  setCustomVisibility(currentPreset);
  setError("");
  applyChartAspectAll();
  notifyConfigChanged();
}

function wireChartAspectUi() {
  if (dom.ratioWidth) dom.ratioWidth.value = state.chartAspect.w;
  if (dom.ratioHeight) dom.ratioHeight.value = state.chartAspect.h;
  const initialPreset = resolvePresetFromAspect();
  if (dom.ratioPreset) dom.ratioPreset.value = initialPreset;
  setCustomVisibility(initialPreset);
  dom.ratioPreset?.addEventListener("change", (event) => {
    const value = event.target.value;
    setCustomVisibility(value);
    applyPresetToInputs(value);
    applyChartAspectFromInputs({ keepCustom: value === "custom" });
  });
  dom.ratioWidth?.addEventListener("input", () => {
    const keepCustom = dom.ratioPreset?.value === "custom";
    applyChartAspectFromInputs({ keepCustom });
  });
  dom.ratioHeight?.addEventListener("input", () => {
    const keepCustom = dom.ratioPreset?.value === "custom";
    applyChartAspectFromInputs({ keepCustom });
  });
  window.addEventListener("resize", applyChartAspectAll);
}

function slugify(value) {
  return String(value || "graphique")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "graphique";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");
}

function isNullishValue(value) {
  const raw = value == null ? "" : String(value).trim();
  if (!raw || raw === "---") return true;
  const parsed = parseLocaleNumber(raw);
  if (Number.isFinite(parsed)) return parsed === 0;
  return false;
}

function computeNullishColumns(dataset) {
  const out = new Set();
  for (let colIdx = 0; colIdx < dataset.columns.length; colIdx += 1) {
    let allNullish = true;
    for (let r = 0; r < dataset.rows.length; r += 1) {
      if (!isNullishValue(dataset.rows[r]?.[colIdx])) {
        allNullish = false;
        break;
      }
    }
    if (allNullish) out.add(colIdx);
  }
  return out;
}

function shouldShowColumn(colIdx) {
  if (!state.hideNullColumns) return true;
  if (!state.dataset?.nullishColumns) return true;
  return !state.dataset.nullishColumns.has(colIdx);
}

function getVisibleColumnIndices() {
  if (!state.dataset) return [];
  const indices = [];
  for (let i = 0; i < state.dataset.columns.length; i += 1) {
    if (shouldShowColumn(i)) indices.push(i);
  }
  return indices;
}

function init() {
  if (dom.pageDate) {
    const today = new Date();
    dom.pageDate.textContent = today.toLocaleDateString("fr-FR", {
      year: "numeric",
      month: "long",
      day: "2-digit"
    });
  }
  loadSettingsState();
  state.activeSettingId = state.settingsStore.autoLoadSetting || null;
  if (state.activeSettingId) {
    const active = state.settingsStore.settings.find((s) => s.id === state.activeSettingId);
    if (active?.config) state.pendingImportedConfig = active.config;
  }
  renderSettingsUi();
  updatePrintPageStyle();
  applyPrintCardWidth();
  if (dom.printNoteInput && dom.printNoteOutput) {
    const syncPrintNote = () => {
      const raw = dom.printNoteInput.value || "";
      const trimmed = raw.trim();
      if (!trimmed) {
        dom.printNoteOutput.hidden = true;
        dom.printNoteOutput.innerHTML = "";
        if (dom.printNoteInput.closest(".print-note")) {
          dom.printNoteInput.closest(".print-note").classList.add("empty");
        }
        return;
      }
      const wrapper = dom.printNoteInput.closest(".print-note");
      if (wrapper) wrapper.classList.remove("empty");
      dom.printNoteOutput.hidden = false;
      dom.printNoteOutput.innerHTML = `
        <div class="print-note-title">Note:</div>
        <div class="print-note-body">${escapeHtml(raw).replaceAll("\n", "<br>")}</div>
      `;
    };
    dom.printNoteInput.addEventListener("input", syncPrintNote);
    syncPrintNote();
  }
  const handlePrintResize = () => {
    applyChartAspectAll();
  };
  if ("matchMedia" in window) {
    const media = window.matchMedia("print");
    if (media.addEventListener) {
      media.addEventListener("change", () => handlePrintResize());
    } else if (media.addListener) {
      media.addListener(() => handlePrintResize());
    }
  }
  window.addEventListener("beforeprint", handlePrintResize);
  window.addEventListener("afterprint", handlePrintResize);
  wireImportUi();
  wireBuilderUi();
  wireChartEvents();
  wireSettingsUi();
  wireColumnSettingsUi();
  wireChartAspectUi();
  const previewBtn = document.querySelector("#previewToggleBtn");
  if (previewBtn) {
    previewBtn.addEventListener("click", () => {
      if (!state.dataset) return;
      state.previewExpanded = !state.previewExpanded;
      renderPreview(state.dataset);
      renderPreviewToggle(state.dataset);
    });
  }
}

function applyPrintCardWidth() {
  const orientation = state.printOrientation === "landscape" ? "landscape" : "portrait";
  const pageWidth = orientation === "landscape" ? 297 : 210;
  const margin = 20;
  const contentWidth = Math.max(0, pageWidth - margin);
  const target = Math.round(contentWidth * 0.8 * 10) / 10;
  document.documentElement.style.setProperty("--print-card-width", `${target}mm`);
}

function applyPrintPageBreaks() {
  const cards = [...document.querySelectorAll(".chart-card:not(.print-hidden)")];
  cards.forEach((card) => card.classList.remove("print-break-auto"));
  if (!cards.length) return;
  const orientation = state.printOrientation === "landscape" ? "landscape" : "portrait";
  const pageHeightMm = orientation === "landscape" ? 210 : 297;
  const marginMm = 20;
  const contentHeightMm = Math.max(1, pageHeightMm - marginMm);
  const pxPerMm = 96 / 25.4;
  const pageHeightPx = contentHeightMm * pxPerMm;

  for (let pass = 0; pass < 2; pass += 1) {
    let changed = false;
    let pageStart = cards[0].getBoundingClientRect().top + window.scrollY;
    for (const card of cards) {
      if (card.classList.contains("print-break-manual")) {
        pageStart = card.getBoundingClientRect().top + window.scrollY;
      }
      const rect = card.getBoundingClientRect();
      const top = rect.top + window.scrollY;
      const bottom = top + rect.height;
      const used = top - pageStart;
      if (used + rect.height > pageHeightPx && used > 0) {
        if (!card.classList.contains("print-break-auto") && !card.classList.contains("print-break-manual")) {
          card.classList.add("print-break-auto");
          changed = true;
        }
        pageStart = top;
      }
      if (bottom - pageStart > pageHeightPx) {
        pageStart = top;
      }
    }
    if (!changed) break;
    void document.body.offsetHeight;
  }
}

function updatePrintPageStyle() {
  const title = "Futaba Grapher";
  const dateText = dom.pageDate?.textContent || new Date().toLocaleDateString("fr-FR", {
    year: "numeric",
    month: "long",
    day: "2-digit"
  });
  const escapeCss = (value) => String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, "\\\"");
  const styleId = "dynamic-print-orientation";
  let style = document.getElementById(styleId);
  if (!style) {
    style = document.createElement("style");
    style.id = styleId;
    document.head.appendChild(style);
  }
  style.textContent = `
    @page {
      size: A4 ${state.printOrientation};
      margin: 8mm 10mm 12mm;
      @top-right {
        content: "";
      }
      @bottom-center {
        content: "Page " counter(page) " / " counter(pages);
        font-family: "Space Grotesk", sans-serif;
        font-size: 11pt;
        color: #51604d;
      }
    }
  `;
}

init();
