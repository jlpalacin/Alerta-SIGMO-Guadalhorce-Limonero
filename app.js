"use strict";

const Core = window.AlertCore;
const DATASETS = window.RESERVOIR_RASTER_DATA;
const ISOLINES = {};
const { LEVELS, SEVERITY } = Core;
const LAYER_KEYS = ["casasola", "guadalhorce", "limonero"];

const ASSETS = [
  { key: "casasola", label: "Casasola", layer: "casasola", lat: 36.8016, lon: -4.4945, mitecoCode: "6290014" },
  { key: "conde", label: "El Conde de Guadalhorce", layer: "guadalhorce", lat: 36.9352, lon: -4.7995, mitecoCode: "6290035" },
  { key: "guadalhorce", label: "Guadalhorce", layer: "guadalhorce", lat: 36.9427, lon: -4.8009, mitecoCode: "6290030" },
  { key: "guadalteba", label: "Guadalteba", layer: "guadalhorce", lat: 36.9426, lon: -4.7998, mitecoCode: "6290026" },
  { key: "limonero", label: "Limonero", layer: "limonero", lat: 36.765, lon: -4.438, mitecoCode: null },
];

const MAP = {
  width: 2685,
  height: 1724,
  west: -15,
  east: 1,
  north: 42,
  south: 31,
  pxDegX: 167.8125,
  pxDegY: 156.7273,
};

const REPORT_RASTER_WIDTH = 700;
const REPORT_RASTER_HEIGHT = Math.round(REPORT_RASTER_WIDTH * MAP.height / MAP.width);
const REPORT_RASTER_CACHE = new Map();

const SAMPLE_TEXT = `EVENTO: es2026mnvfi
HORA LOCAL(*): 28/06/2026 08:59:40
HORA UTC: 28/06/2026 06:59:40
Latitud: 36.68 grados norte
Longitud: 9.83 grados oeste
Profundidad: 14 km
Magnitud mbLg: 4.3
Zona epicentral: SW CABO DE SAN VICENTE`;

const $ = (id) => document.getElementById(id);
const state = {
  results: [],
  selected: null,
  activeLayer: "casasola",
  mapView: { scale: 1, x: 0, y: 0 },
  tileKey: "",
};

init();

async function init() {
  $("readIgnBtn").addEventListener("click", runIgnRead);
  $("analyzeBtn").addEventListener("click", runBulletinAnalysis);
  $("reportBtn").addEventListener("click", generateSelectedReport);
  $("sampleBtn").addEventListener("click", async () => {
    $("textInput").value = SAMPLE_TEXT;
    await runBulletinAnalysis();
  });
  $("clearBtn").addEventListener("click", clearAnalysis);
  initHelpDialog();
  initFileInput();
  initLayerSwitch();
  initMapInteractions();
  applyMapTransform();
  renderAll();
  setRasterControlsReady(false);
  try {
    await loadRasterData();
    setRasterControlsReady(true);
    renderVectorOverlay();
    $("rasterStatus").textContent = "Bandas 1 cargadas";
  } catch (error) {
    $("rasterStatus").textContent = "Error al cargar los mapas";
    setNotice(`No se pudieron cargar los mapas raster: ${error.message}`, true);
  }
}

async function loadRasterData() {
  const rasterTasks = LAYER_KEYS.flatMap((layerKey) => ["extra", "zero"].map(async (scenario) => {
    const raster = DATASETS?.[layerKey]?.[scenario];
    if (!raster) throw new Error(`falta la capa ${layerKey}/${scenario}`);
    const response = await fetchDataResource(raster.dataUrl);
    if (!response.ok) throw new Error(`${raster.sourceFile}: HTTP ${response.status}`);
    const payload = await response.arrayBuffer();
    const signature = new Uint8Array(payload, 0, Math.min(2, payload.byteLength));
    let buffer = payload;
    if (signature[0] === 0x1f && signature[1] === 0x8b) {
      if (!("DecompressionStream" in window)) throw new Error("el navegador no admite la descompresión de los datos raster");
      const stream = new Blob([payload]).stream().pipeThrough(new DecompressionStream("gzip"));
      buffer = await new Response(stream).arrayBuffer();
    }
    const expectedBytes = raster.width * raster.height * Float32Array.BYTES_PER_ELEMENT;
    if (buffer.byteLength !== expectedBytes) throw new Error(`${raster.sourceFile}: tamaño de datos no válido`);
    raster.values = new Float32Array(buffer);
  }));
  const isolineTasks = LAYER_KEYS.map(async (layerKey) => {
    const config = window.RESERVOIR_ISOLINE_DATA?.[layerKey];
    if (!config) throw new Error(`faltan las isolíneas ${layerKey}`);
    const response = await fetchDataResource(config.dataUrl);
    if (!response.ok) throw new Error(`${config.sourceFile}: HTTP ${response.status}`);
    ISOLINES[layerKey] = await response.json();
  });
  const reportImageTasks = LAYER_KEYS.map(async (layerKey) => {
    const raster = DATASETS?.[layerKey]?.extra;
    if (!raster?.reportImageUrl) return;
    try {
      const response = await fetchDataResource(raster.reportImageUrl);
      if (!response.ok) return;
      raster.reportImageDataUrl = await blobToDataUrl(await response.blob());
    } catch {
      raster.reportImageDataUrl = "";
    }
  });
  await Promise.all([...rasterTasks, ...isolineTasks, ...reportImageTasks]);
}

async function fetchDataResource(dataUrl) {
  let response = await fetch(dataUrl);
  if (response.status === 404 && dataUrl.includes("/")) {
    response = await fetch(dataUrl.split("/").pop());
  }
  return response;
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result));
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsDataURL(blob);
  });
}

function setRasterControlsReady(ready) {
  for (const id of ["readIgnBtn", "analyzeBtn", "sampleBtn"]) $(id).disabled = !ready;
}

function initHelpDialog() {
  const dialog = $("helpDialog");
  const openButton = $("helpBtn");

  openButton.addEventListener("click", () => {
    dialog.showModal();
    dialog.querySelector(".help-content").scrollTop = 0;
  });

  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });

  for (const link of dialog.querySelectorAll("[data-help-target]")) {
    link.addEventListener("click", () => {
      const target = $(link.dataset.helpTarget);
      dialog.close();
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }
}

async function runBulletinAnalysis() {
  const button = $("analyzeBtn");
  const text = $("textInput").value;
  if (!text.trim()) {
    setNotice("Pega un boletín o carga un archivo antes de analizar.", true);
    return;
  }
  setButtonBusy(button, true, "Analizando…");
  try {
    const event = Core.parseBulletin(text);
    const result = Core.evaluateEvent(event, DATASETS);
    state.results = [result];
    state.selected = result;
    renderAll();
    $("detalle").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    setNotice(`No se pudo completar el análisis: ${error.message}`, true);
  } finally {
    setButtonBusy(button, false, "Analizar boletín");
  }
}

async function runIgnRead() {
  const button = $("readIgnBtn");
  const days = Math.max(1, Math.min(10, Math.round(Core.toNumber($("ignDays").value) || 7)));
  $("ignDays").value = String(days);
  setButtonBusy(button, true, "Leyendo IGN…");
  try {
    const html = await fetchIgnHtml(days);
    const cutoff = Date.now() - days * 86400000;
    const events = parseIgnRecentHtml(html)
      .filter((event) => !event.utcDate || event.utcDate.getTime() >= cutoff)
      .sort((a, b) => (b.utcDate?.getTime() || 0) - (a.utcDate?.getTime() || 0));
    if (!events.length) throw new Error(`no se encontraron eventos válidos en los últimos ${days} días`);
    state.results = events.map((event) => Core.evaluateEvent(event, DATASETS));
    state.selected = Core.highestIntensityResult(state.results) || conditioningResult(state.results) || state.results[0];
    renderAll();
  } catch (error) {
    setNotice(`No se pudo leer el listado del IGN: ${error.message}`, true);
  } finally {
    setButtonBusy(button, false, "↻ Leer sismos del IGN");
  }
}

async function fetchIgnHtml(days) {
  const origin = location.origin && location.origin !== "null" ? location.origin : "";
  const candidates = ["./ign-terremotos.html"];
  const isGithubPages = location.protocol === "https:" && /(^|\.)github\.io$/i.test(location.hostname);
  if (!isGithubPages) candidates.push(`${origin}/ign-terremotos`, "./ign-terremotos");
  let lastError = "";
  for (const base of candidates) {
    try {
      const separator = base.includes("?") ? "&" : "?";
      const response = await fetch(`${base}${separator}days=${days}&t=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) {
        lastError = `${base}: código ${response.status}`;
        continue;
      }
      const html = await response.text();
      if (!/terremoto0|<td[^>]*>\s*es\d{4}/i.test(html)) {
        lastError = `${base}: respuesta sin filas sísmicas`;
        continue;
      }
      return html;
    } catch (error) {
      lastError = `${base}: ${error.message}`;
    }
  }
  throw new Error(`${lastError}. En GitHub Pages ejecuta el workflow “Actualizar listado IGN”.`);
}

function parseIgnRecentHtml(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const events = [];
  for (const row of doc.querySelectorAll("tr")) {
    const cells = [...row.querySelectorAll("td")].map((cell) => cell.textContent.replace(/\s+/g, " ").trim());
    if (cells.length < 11 || !/^es\d{4}/i.test(cells[0])) continue;
    const maxIntensityText = cells[9] || "";
    const event = {
      event: cells[0],
      date: cells[1],
      utc: cells[2],
      localTime: cells[3],
      lat: Core.toNumber(cells[4]),
      lon: Core.toNumber(cells[5]),
      depthKm: Core.toNumber(cells[6]),
      magnitude: Core.toNumber(cells[7]),
      magnitudeType: cells[8] || "mbLg",
      maxIntensity: Core.parseIntensity(maxIntensityText),
      maxIntensityText,
      zone: cells[10],
      utcDate: parseIgnUtcDate(cells[1], cells[2]),
    };
    if (event.lat != null && event.lon != null && event.magnitude != null) events.push(event);
  }
  return events;
}

function parseIgnUtcDate(dateText, timeText) {
  const date = String(dateText || "").match(/(\d{2})\/(\d{2})\/(\d{4})/);
  const time = String(timeText || "").match(/(\d{2}):(\d{2}):(\d{2})/);
  if (!date || !time) return null;
  return new Date(Date.UTC(+date[3], +date[2] - 1, +date[1], +time[1], +time[2], +time[3]));
}

function clearAnalysis() {
  state.results = [];
  state.selected = null;
  $("textInput").value = "";
  $("fileInput").value = "";
  renderAll();
}

function renderAll() {
  renderOverview();
  renderEvents();
  renderDetail();
  renderMapMarkers();
}

function renderOverview() {
  $("analysisSummary").style.color = "";
  if (!state.results.length) {
    $("analysisSummary").textContent = "Sin datos analizados";
    for (const asset of ASSETS) updateAssetCard(asset, null, null);
    return;
  }
  $("analysisSummary").textContent = `${state.results.length} evento${state.results.length === 1 ? "" : "s"} · se adopta el estado más grave`;
  for (const asset of ASSETS) {
    const pairs = state.results.map((result) => ({ result, decision: result.layers[asset.layer] }));
    const pair = pairs.reduce((worst, item) => SEVERITY[item.decision.level] > SEVERITY[worst.decision.level] ? item : worst, pairs[0]);
    updateAssetCard(asset, pair.decision, pair.result);
  }
}

function updateAssetCard(asset, decision, eventResult) {
  const card = document.querySelector(`[data-asset="${asset.key}"]`);
  const level = decision?.level || LEVELS.UNKNOWN;
  card.className = `reservoir-card ${statusClass(level)}`;
  card.querySelector(".asset-status").textContent = decision ? Core.statusLabel(level) : "Sin analizar";
  const eventText = card.querySelector(".asset-event");
  if (!decision) {
    eventText.textContent = asset.layer === "guadalhorce" ? "Raster común del sistema Guadalhorce" : `Raster propio de ${asset.label}`;
  } else {
    eventText.textContent = `Condiciona: ${eventResult.data.event || "evento manual"} · Io ${Core.formatThreshold(eventResult.data.intensity)}`;
  }
}

function renderEvents() {
  const list = $("eventList");
  const summary = $("ignSummary");
  if (!state.results.length) {
    summary.textContent = "Sin lectura";
    list.innerHTML = '<p class="empty-state">Pulsa “Leer sismos del IGN” o analiza un boletín para obtener resultados.</p>';
    return;
  }
  summary.textContent = `${state.results.length} analizado${state.results.length === 1 ? "" : "s"} · selección inicial: mayor Io`;
  const rows = state.results.map((result, index) => {
    const data = result.data;
    const assetCells = ASSETS.map((asset) => statusPill(result.layers[asset.layer].level)).join("");
    const selected = result === state.selected;
    return `<tr class="${selected ? "selected-event" : ""}"${selected ? ' aria-current="true"' : ""}>
      <td><button class="event-link" type="button" data-event-index="${index}">${escapeHtml(data.event || "Evento manual")}</button></td>
      <td>${escapeHtml([data.date, data.utc].filter(Boolean).join(" ") || data.utc || "−")}</td>
      <td>${Core.formatThreshold(data.magnitude)} ${escapeHtml(data.magnitudeType || "")}</td>
      <td>${escapeHtml(data.maxIntensityText || Core.formatThreshold(data.maxIntensity))}</td>
      <td>${Core.formatThreshold(data.intensity)}</td>
      ${assetCells}
      <td>${escapeHtml(data.zone || "−")}</td>
    </tr>`;
  }).join("");
  list.innerHTML = `<table class="event-table">
    <thead><tr><th>Evento</th><th>UTC</th><th>Magnitud</th><th>Imax IGN</th><th>Io calculada</th>${ASSETS.map((asset) => `<th>${escapeHtml(asset.label)}</th>`).join("")}<th>Zona</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
  for (const button of list.querySelectorAll("[data-event-index]")) {
    button.addEventListener("click", () => selectResult(state.results[Number(button.dataset.eventIndex)]));
  }
}

function renderDetail() {
  const result = state.selected;
  $("reportBtn").disabled = !result;
  $("reportStatus").textContent = "";
  if (!result) {
    $("detailEvent").textContent = "Ninguno seleccionado";
    $("detailMagnitude").textContent = "−";
    $("detailMaxIntensity").textContent = "−";
    $("detailIntensity").textContent = "−";
    $("detailCoords").textContent = "−";
    $("detailZone").textContent = "−";
    $("calculationTrace").innerHTML = '<p class="empty-state">Selecciona un evento para ver cómo se ha realizado el cálculo.</p>';
    $("layerResults").innerHTML = '<p class="empty-state">Selecciona un evento para ver los umbrales aplicados.</p>';
    return;
  }
  const data = result.data;
  $("detailEvent").textContent = data.event || "Evento manual";
  $("detailMagnitude").textContent = data.magnitude == null ? "−" : `${Core.formatNumber(data.magnitude)} ${data.magnitudeType || ""}`;
  $("detailMaxIntensity").textContent = data.maxIntensityText || Core.formatThreshold(data.maxIntensity);
  $("detailIntensity").textContent = Core.formatThreshold(data.intensity);
  $("detailCoords").textContent = data.lat == null || data.lon == null ? "−" : `${Core.formatNumber(data.lat)}, ${Core.formatNumber(data.lon)}`;
  $("detailZone").textContent = data.zone || "−";
  $("calculationTrace").innerHTML = calculationTraceHtml(result);
  $("layerResults").innerHTML = LAYER_KEYS.map((layerKey) => layerResultHtml(result.layers[layerKey])).join("");
}

function calculationTraceHtml(result) {
  const data = result.data;
  let intensitySteps = "";
  if (data.intensitySource === "reported") {
    intensitySteps = `<ol>
      <li>El boletín aporta directamente <strong>Io = ${Core.formatThreshold(data.intensity)}</strong>.</li>
      <li>No se aplica una conversión de magnitud para obtener Io; se conserva el valor comunicado.</li>
    </ol>`;
  } else if (data.intensitySource === "estimated") {
    intensitySteps = `<ol>
      <li>Magnitud de entrada: <strong>${Core.formatThreshold(data.magnitude)} ${escapeHtml(data.magnitudeType || "")}</strong>.</li>
      <li>Tramo aplicado: <strong>${escapeHtml(data.magnitudeRange || "tipo de magnitud comunicado")}</strong>. ${escapeHtml(data.magnitudeConversion || "magnitud expresada en Mw")}.</li>
      <li>Fórmula de magnitud: <code>${escapeHtml(data.magnitudeFormula || "Mw = M")}</code>.</li>
      <li>Sustitución de magnitud: <code>${escapeHtml(data.magnitudeSubstitution || `Mw = ${Core.formatThreshold(data.mw)}`)}</code>.</li>
      <li>Relación de intensidad: <code>Io = (Mw − 1,656) / 0,545</code>.</li>
      <li>Sustitución de intensidad: <code>Io = (${Core.formatThreshold(data.mw)} − 1,656) / 0,545</code> → <strong>Io = ${Core.formatThreshold(data.intensity)}</strong>.</li>
      ${data.maxIntensity != null ? `<li>El IGN comunica además <strong>Imax = ${escapeHtml(data.maxIntensityText || Core.formatThreshold(data.maxIntensity))}</strong>. Se conserva como intensidad máxima observada, pero no se interpreta como Io.</li>` : ""}
    </ol>${magnitudeRulesHtml()}`;
  } else if (data.intensitySource === "reported-max") {
    intensitySteps = `<p>No hay magnitud suficiente para calcular Io. Se usa <strong>Imax = ${escapeHtml(data.maxIntensityText || Core.formatThreshold(data.maxIntensity))}</strong> únicamente como aproximación conservadora y queda identificada como tal.</p>`;
  } else if (data.intensitySource === "pga") {
    intensitySteps = `<p>No se ha obtenido Io. El estado se decide directamente con la PGA: extraordinaria desde 9,4 cm/s² y Escenario 0 desde 26,5 cm/s².</p>`;
  } else {
    intensitySteps = `<p>No hay datos suficientes para calcular Io; se solicita revisión manual.</p>`;
  }
  return `<article class="calculation-card">
      <div class="calculation-number">1</div>
      <div><h3>Cómo se ha obtenido la intensidad Io</h3>${intensitySteps}</div>
    </article>
    <article class="calculation-card">
      <div class="calculation-number">2</div>
      <div><h3>Cómo se obtienen las intensidades de los escenarios</h3>
        <p>Las coordenadas del epicentro se transforman a ETRS89 / UTM zona 30N y se localiza la celda correspondiente en cada GeoTIFF:</p>
        <ul>
          <li><strong>Mapa extraordinario:</strong> valor de la Banda 1 usado como umbral de situación extraordinaria.</li>
          <li><strong>Mapa de Escenario 0:</strong> valor de la Banda 1 usado como umbral de Escenario 0.</li>
          <li>Si alguna celda está fuera del raster o contiene <code>NoData</code>, el resultado solicita revisión manual.</li>
        </ul>
        <p>Finalmente se compara Io con los dos valores de Banda 1. El detalle de cada embalse aparece debajo.</p>
      </div>
    </article>`;
}

function layerResultHtml(decision) {
  const thresholds = decision.thresholds || {};
  const label = layerLabel(decision.layerKey);
  return `<article class="layer-result ${statusClass(decision.level)}">
    <div class="layer-result-head"><h3>${label}</h3>${statusPillInline(decision.level)}</div>
    <div class="threshold-pair">
      <div><span>Extraordinario · Banda 1</span><strong>${Core.formatThreshold(thresholds.extra)}</strong></div>
      <div><span>Escenario 0 · Banda 1</span><strong>${Core.formatThreshold(thresholds.zero)}</strong></div>
    </div>
    ${rasterCellHtml(thresholds)}
    <p class="decision-equation">${decisionEquation(decision)}</p>
    <ul class="reason-list">${decision.reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join("")}</ul>
  </article>`;
}

function rasterCellHtml(thresholds) {
  const extra = thresholds.samples?.extra;
  const zero = thresholds.samples?.zero;
  if (!extra && !zero) return "";
  const cell = (sample) => sample?.row == null || sample?.column == null ? "fuera de cobertura" : `columna ${sample.column}, fila ${sample.row}`;
  return `<p class="raster-cell">Celdas consultadas · Extraordinario: ${cell(extra)} · Escenario 0: ${cell(zero)}</p>`;
}

function layerLabel(layerKey) {
  return DATASETS?.[layerKey]?.label || Core.LAYERS[layerKey]?.label || layerKey;
}

function decisionEquation(decision) {
  const data = decision.data || {};
  const thresholds = decision.thresholds || {};
  if (data.pga != null && data.pga >= 26.5) return `PGA ${Core.formatNumber(data.pga)} ≥ 26,5 → Escenario 0.`;
  if (data.pga != null && data.pga >= 9.4) return `PGA ${Core.formatNumber(data.pga)} ≥ 9,4 → Situación extraordinaria.`;
  if (data.intensity == null) return "Sin Io ni PGA suficiente → revisión manual.";
  if (thresholds.zero != null && data.intensity >= thresholds.zero) {
    return `Io ${Core.formatNumber(data.intensity)} ≥ ${Core.formatNumber(thresholds.zero)} (Escenario 0) → Escenario 0.`;
  }
  if (thresholds.extra != null && data.intensity >= thresholds.extra) {
    return `Io ${Core.formatNumber(data.intensity)} < ${Core.formatThreshold(thresholds.zero)} y ≥ ${Core.formatNumber(thresholds.extra)} → situación extraordinaria.`;
  }
  if (!thresholds.inCoverage) return "Epicentro fuera del ámbito cartográfico → revisión manual.";
  return `Io ${Core.formatNumber(data.intensity)} < ${Core.formatThreshold(thresholds.extra)} → situación ordinaria.`;
}

function selectResult(result) {
  state.selected = result;
  renderEvents();
  renderDetail();
  renderMapMarkers();
  $("detalle").scrollIntoView({ behavior: "smooth", block: "start" });
}

function generateSelectedReport() {
  if (!state.selected) {
    setNotice("Selecciona un evento antes de generar el informe.", true);
    return;
  }
  const reportWindow = window.open("", "_blank");
  const html = buildReportHtml(state.selected);
  if (reportWindow) {
    reportWindow.document.open();
    reportWindow.document.write(html);
    reportWindow.document.close();
    $("reportStatus").textContent = "Informe abierto en una pestaña nueva.";
    return;
  }
  const blobUrl = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = blobUrl;
  link.download = `informe-${safeFilePart(state.selected.data.event || "evento")}.html`;
  link.click();
  $("reportStatus").textContent = "Informe descargado. Ábrelo para imprimirlo o guardarlo como PDF.";
  setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
}

function buildReportHtml(result) {
  const data = result.data;
  const depthKm = data.depthKm ?? data.depth;
  const generated = new Intl.DateTimeFormat("es-ES", { dateStyle: "long", timeStyle: "short" }).format(new Date());
  const icoldMagnitude = data.mw ?? data.magnitude;
  const icoldMagnitudeLabel = data.mw != null
    ? `${Core.formatThreshold(data.mw)} Mw`
    : `${Core.formatThreshold(data.magnitude)} ${escapeHtml(data.magnitudeType || "")}`.trim();
  const actionRadiusKm = Core.icoldActionRadiusKm(icoldMagnitude);
  const distances = reservoirDistances(data);
  const assetRows = distances.map(({ asset, distanceKm }) => {
    const decision = result.layers[asset.layer];
    const actionCheck = distanceKm == null
      ? "No evaluable: distancia no calculable"
      : actionRadiusKm == null
        ? "No evaluable: la tabla comienza en M > 4"
        : distanceKm <= actionRadiusKm
          ? `Sí: d ≤ ${formatDistance(actionRadiusKm)}`
          : `No: d > ${formatDistance(actionRadiusKm)}`;
    const assetCode = asset.mitecoCode ? `<br><span class="subtle">MITECO ${asset.mitecoCode}</span>` : "";
    return `<tr><td><strong>${escapeHtml(asset.label)}</strong>${assetCode}</td><td>${formatDistance(distanceKm)}</td><td>${escapeHtml(actionCheck)}</td><td><span class="pill ${statusClass(decision.level)}">${escapeHtml(Core.statusLabel(decision.level))}</span></td><td>${escapeHtml(decisionEquation(decision))}</td></tr>`;
  }).join("");
  const distanceDetails = distances.map(({ asset, distanceKm }) => `<li><strong>${escapeHtml(asset.label)}:</strong> φ₂ = ${Core.formatNumber(asset.lat)}°, λ₂ = ${Core.formatNumber(asset.lon)}° → <strong>d = ${formatDistance(distanceKm)}</strong>.</li>`).join("");
  const icoldRows = [...Core.ICOLD_ACTION_RADII].reverse().map((row) => `<tr><td>&gt; ${Core.formatNumber(row.magnitudeAbove)}</td><td>${formatDistance(row.distanceKm)}</td></tr>`).join("");
  const layers = LAYER_KEYS.map((layerKey) => reportLayerHtml(result.layers[layerKey])).join("");
  const reportMaps = LAYER_KEYS.map((layerKey) => reportMapHtml(layerKey, data)).join("");
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Informe sísmico · ${escapeHtml(data.event || "Evento")}</title><style>
    :root{--ink:#153237;--muted:#61767a;--line:#d9e3e1;--teal:#0d736e;--ordinary:#247047;--extra:#9b5b00;--zero:#b42318;--unknown:#617079}*{box-sizing:border-box}body{margin:0;background:#eef3f2;color:var(--ink);font-family:Arial,sans-serif;line-height:1.45}.page{max-width:1100px;margin:28px auto;padding:38px;background:#fff;box-shadow:0 8px 30px #1734381c}header{display:flex;justify-content:space-between;gap:24px;padding-bottom:22px;border-bottom:3px solid var(--teal)}h1{margin:0;font-size:27px}h2{margin:28px 0 12px;font-size:17px}h3{margin:0 0 10px;font-size:15px}.meta,.subtle{color:var(--muted);font-size:11px}.meta{text-align:right}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.metric,.card{padding:14px;border:1px solid var(--line);border-radius:10px}.metric span{display:block;color:var(--muted);font-size:11px}.metric strong{display:block;margin-top:6px;font-size:14px}.report-maps{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.report-map{margin:0;padding:10px;border:1px solid var(--line);border-radius:10px;background:#f4f8f7;break-inside:avoid}.report-map svg{display:block;width:100%;height:auto;border-radius:7px;background:#b8c7c2}.report-map figcaption{padding:8px 3px 1px;font-size:11px}.raster-legend{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:6px;margin:7px 3px 2px;color:var(--muted);font-size:9px}.raster-legend i{height:7px;border-radius:8px;background:linear-gradient(90deg,#fee6d2,#f16b5c,#99002d)}.raster-note{display:block;margin-top:5px;color:var(--muted);font-size:9px}.calculation{padding:16px 18px;border-left:4px solid var(--teal);background:#f4f8f7}.calculation p,.calculation li{margin:6px 0;font-size:13px}.magnitude-rules{margin-top:12px;padding:11px;border:1px solid var(--line);border-radius:8px;background:#fff}.magnitude-rules .rueda-note{padding-top:8px;border-top:1px solid var(--line)}.magnitude-rules a{color:var(--teal)}.formula{padding:9px 11px;border-radius:7px;background:#e4efed;font-family:Consolas,monospace;font-size:12px}code{background:#e4efed;padding:2px 4px;border-radius:4px}table{width:100%;border-collapse:collapse;font-size:11px}th,td{padding:9px;border:1px solid var(--line);text-align:left;vertical-align:top}th{background:#f3f7f6}.pill{display:inline-block;padding:4px 8px;border-radius:20px;font-weight:700;white-space:nowrap}.ordinary{color:var(--ordinary);background:#e8f4ec}.extra{color:var(--extra);background:#fff0c8}.zero{color:var(--zero);background:#fde9e7}.unknown{color:var(--unknown);background:#edf1f2}.layers{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.card p,.card li{font-size:12px}.thresholds{display:flex;gap:18px;margin:10px 0}.thresholds span{color:var(--muted);font-size:11px}.thresholds strong{display:block;color:var(--ink);font-size:15px}.icold-layout{display:grid;grid-template-columns:1.4fr .6fr;gap:14px}.source{color:var(--muted);font-size:10px}.notice{margin-top:28px;padding:14px;background:#fff8e7;color:#66542d;font-size:11px}.toolbar{max-width:1100px;margin:20px auto 0;text-align:right}.toolbar button{padding:10px 16px;border:0;border-radius:8px;background:var(--teal);color:#fff;font-weight:700;cursor:pointer}@media(max-width:700px){.page{margin:0;padding:22px}.grid,.layers,.report-maps{grid-template-columns:1fr}.icold-layout{grid-template-columns:1fr}header{display:block}.meta{text-align:left;margin-top:10px}.distance-table{display:block;overflow-x:auto}}@media print{body{background:#fff}.toolbar{display:none}.page{max-width:none;margin:0;padding:0;box-shadow:none}thead{display:table-header-group}.card,.calculation,.report-map{break-inside:avoid}}
  </style></head><body><div class="toolbar"><button type="button" onclick="window.print()">Imprimir / Guardar como PDF</button></div><main class="page">
    <header><div><p style="margin:0;color:var(--teal);font-size:12px;font-weight:700">SEGURIDAD DE PRESAS · DHCMA</p><h1>Informe de evaluación sísmica</h1></div><div class="meta">Generado el ${escapeHtml(generated)}<br>Aplicación Alerta sísmica por embalse</div></header>
    <h2>Evento seleccionado</h2><div class="grid">
      <div class="metric"><span>Evento</span><strong>${escapeHtml(data.event || "Evento manual")}</strong></div>
      <div class="metric"><span>Fecha y hora UTC</span><strong>${escapeHtml([data.date, data.utc].filter(Boolean).join(" ") || "−")}</strong></div>
      <div class="metric"><span>Magnitud</span><strong>${data.magnitude == null ? "−" : `${Core.formatThreshold(data.magnitude)} ${escapeHtml(data.magnitudeType || "")}`}</strong></div>
      <div class="metric"><span>Intensidad máxima observada</span><strong>${escapeHtml(data.maxIntensityText || Core.formatThreshold(data.maxIntensity))}</strong></div>
      <div class="metric"><span>Intensidad Io</span><strong>${Core.formatThreshold(data.intensity)}</strong></div>
      <div class="metric"><span>Latitud</span><strong>${Core.formatThreshold(data.lat)}</strong></div>
      <div class="metric"><span>Longitud</span><strong>${Core.formatThreshold(data.lon)}</strong></div>
      <div class="metric"><span>Profundidad</span><strong>${depthKm == null ? "−" : `${Core.formatThreshold(depthKm)} km`}</strong></div>
      <div class="metric"><span>Zona epicentral</span><strong>${escapeHtml(data.zone || "−")}</strong></div>
    </div>
    <h2>Mapas del evento</h2><div class="report-maps">${reportMaps}</div>
    <h2>Cálculo de Io</h2><div class="calculation">${reportCalculationHtml(data)}</div>
    <h2>Cálculo de la distancia epicentral</h2><div class="calculation"><p>Se aplica la fórmula de Haversine sobre una esfera de radio medio <strong>R = ${Core.formatNumber(Core.EARTH_RADIUS_KM)} km</strong>.</p><p class="formula">Δφ = φ₂ − φ₁; Δλ = λ₂ − λ₁<br>a = sen²(Δφ/2) + cos(φ₁) · cos(φ₂) · sen²(Δλ/2)<br>d = 2R · atan2(√a, √(1−a))</p><p>Epicentro: φ₁ = ${Core.formatThreshold(data.lat)}°, λ₁ = ${Core.formatThreshold(data.lon)}°.</p><ul>${distanceDetails}</ul><p class="source">Coordenadas de presa: Inventario de Presas y Embalses de MITECO (códigos indicados en la tabla).</p></div>
    <h2>Estado, distancia y comprobación por embalse</h2><div class="distance-table"><table><thead><tr><th>Embalse</th><th>Distancia epicentral</th><th>Cumple el radio de acción ICOLD</th><th>Estado por capas</th><th>Comparación de intensidad</th></tr></thead><tbody>${assetRows}</tbody></table></div>
    <h2>Radios de acción ICOLD (2016)</h2><div class="icold-layout"><div class="calculation"><p>La tabla relaciona la magnitud del terremoto con el radio epicentral que justificaría considerar una situación extraordinaria en una gran presa.</p><p>Se utiliza <strong>${icoldMagnitudeLabel}</strong>${data.mw != null && data.magnitudeType && !/^mw$/i.test(data.magnitudeType) ? ", obtenido mediante la conversión a Mw detallada anteriormente" : ""}. El radio aplicable es <strong>${formatDistance(actionRadiusKm)}</strong> y cada distancia presa–epicentro se compara directamente con él.</p><p>Si <code>d ≤ radio ICOLD</code>, la presa cumple el criterio de distancia de la tabla; si <code>d &gt; radio ICOLD</code>, no lo cumple. Esta es la única comprobación de distancia aplicada.</p><p>Esta comprobación se presenta junto al estado obtenido mediante las capas de intensidad y no altera por sí sola ese cálculo.</p></div><table><thead><tr><th>Magnitud</th><th>Radio de acción</th></tr></thead><tbody>${icoldRows}</tbody></table></div>
    <h2>Detalle de los escenarios de intensidad</h2><div class="layers">${layers}</div>
    <div class="notice"><strong>Nota:</strong> resultado orientativo. La regla ICOLD se presenta como comprobación complementaria. El informe no sustituye el Plan de Emergencia de Presa ni la valoración técnica de los organismos competentes.</div>
  </main></body></html>`;
}

function reportCalculationHtml(data) {
  if (data.intensitySource === "reported") return `<p>La intensidad <strong>Io = ${Core.formatThreshold(data.intensity)}</strong> se tomó directamente del boletín. No se aplicó conversión de magnitud.</p>`;
  if (data.intensitySource === "estimated") return `<p>Magnitud de entrada: <strong>${Core.formatThreshold(data.magnitude)} ${escapeHtml(data.magnitudeType || "")}</strong>.</p><ol><li>Tramo aplicado: <strong>${escapeHtml(data.magnitudeRange || "tipo comunicado")}</strong>.</li><li>Método: ${escapeHtml(data.magnitudeConversion || "magnitud ya expresada como Mw")}.</li><li>Fórmula: <code>${escapeHtml(data.magnitudeFormula || "Mw = M")}</code>.</li><li>Sustitución: <code>${escapeHtml(data.magnitudeSubstitution || `Mw = ${Core.formatThreshold(data.mw)}`)}</code>.</li><li>Intensidad: <code>Io = (Mw − 1,656) / 0,545</code>.</li><li>Sustitución: <code>Io = (${Core.formatThreshold(data.mw)} − 1,656) / 0,545</code> → <strong>Io = ${Core.formatThreshold(data.intensity)}</strong>.</li></ol>${data.maxIntensity != null ? `<p>El IGN comunica por separado <strong>Imax = ${escapeHtml(data.maxIntensityText || Core.formatThreshold(data.maxIntensity))}</strong>. Es la intensidad máxima observada y no se ha usado como si fuera Io.</p>` : ""}${magnitudeRulesHtml()}`;
  if (data.intensitySource === "reported-max") return `<p>No hay magnitud suficiente para aplicar la relación de Io. Se usa <strong>Imax = ${escapeHtml(data.maxIntensityText || Core.formatThreshold(data.maxIntensity))}</strong> como aproximación conservadora, dejando constancia de que no es una Io calculada.</p>`;
  if (data.intensitySource === "pga") return `<p>No se obtuvo Io. La evaluación se realizó con la PGA comunicada: <strong>${Core.formatThreshold(data.pga)} cm/s²</strong>.</p>`;
  return "<p>No hay datos suficientes para calcular Io; se requiere revisión manual.</p>";
}

function magnitudeRulesHtml() {
  return `<div class="magnitude-rules"><p><strong>Relaciones por tramos utilizadas</strong></p><p><strong>mbLg(L):</strong> <code>Mw = mbLg + 0,184</code> si <code>mbLg &lt; 3</code>; <code>Mw = 0,836·mbLg + 0,676</code> si <code>3 ≤ mbLg ≤ 6,8</code>; <code>Mw = 0,17·mbLg² − 0,87·mbLg + 4,416</code> si <code>mbLg &gt; 6,8</code>.</p><p><strong>mb:</strong> <code>Mw = mb − 0,7399</code> si <code>mb &lt; 3,7</code>; <code>Mw = 1,213·mb − 1,528</code> si <code>3,7 ≤ mb ≤ 6,7</code>; <code>Mw = 0,17·mb² − 0,87·mb + 4,7968</code> si <code>mb &gt; 6,7</code>.</p><p class="rueda-note">Para valores superiores, cuando no esté disponible el Mw oficial, se utiliza el tramo cuadrático basado en la relación de Rueda (2009). El IGN recoge la forma cuadrática como aplicable a mbLg(L), que aumenta más rápidamente para magnitudes grandes. Las constantes finales de estas expresiones están ajustadas para que no exista salto entre los tramos.</p><p class="source"><a href="https://www.ign.es/resources/acercaDe/libDigPub/ActualizacionMapasPeligrosidadSismica2012.pdf" target="_blank" rel="noreferrer">Referencia IGN: Actualización de mapas de peligrosidad sísmica en España (2012)</a>.</p></div>`;
}

function reportLayerHtml(decision) {
  const thresholds = decision.thresholds || {};
  const label = layerLabel(decision.layerKey);
  const extraCell = thresholds.samples?.extra;
  const zeroCell = thresholds.samples?.zero;
  const cellText = (sample) => sample?.row == null || sample?.column == null ? "fuera de cobertura" : `columna ${sample.column}, fila ${sample.row}`;
  return `<article class="card"><h3>${label}</h3><p>Consulta directa de la Banda 1 en las coordenadas del epicentro, transformadas a ETRS89 / UTM 30N.</p><p>Celda extraordinaria: <strong>${cellText(extraCell)}</strong>.<br>Celda de Escenario 0: <strong>${cellText(zeroCell)}</strong>.</p><div class="thresholds"><div><span>Extraordinaria · Banda 1</span><strong>${Core.formatThreshold(thresholds.extra)}</strong></div><div><span>Escenario 0 · Banda 1</span><strong>${Core.formatThreshold(thresholds.zero)}</strong></div></div><p class="formula">${escapeHtml(decisionEquation(decision))}</p><ul>${decision.reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join("")}</ul></article>`;
}

function reportMapHtml(layerKey, data) {
  const collection = ISOLINES[layerKey];
  const label = layerLabel(layerKey);
  const stroke = layerColor(layerKey);
  const raster = DATASETS?.[layerKey]?.extra;
  const rasterDataUrl = raster?.reportImageDataUrl || reportExtraRasterDataUrl(layerKey);
  const rasterOverlay = rasterDataUrl
    ? `<image href="${escapeHtml(rasterDataUrl)}" x="0" y="0" width="${MAP.width}" height="${MAP.height}" preserveAspectRatio="none"/>`
    : "";
  const paths = (collection?.features || []).map((feature) => {
    const pathData = geometryToPath(feature.geometry);
    if (!pathData) return "";
    const intensity = feature.properties?.Intensidad;
    return `<path d="${escapeHtml(pathData)}" fill="none" stroke="${stroke}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><title>Isolínea ${escapeHtml(intensity)}</title></path>`;
  }).join("");
  const point = data.lat == null || data.lon == null ? null : latLonToPixel(data.lat, data.lon);
  const marker = point && point.x >= 0 && point.x <= MAP.width && point.y >= 0 && point.y <= MAP.height
    ? `<g><circle cx="${point.x}" cy="${point.y}" r="25" fill="#fff" stroke="#152c32" stroke-width="8"/><circle cx="${point.x}" cy="${point.y}" r="8" fill="#b42318"/><title>${escapeHtml(data.event || "Evento")} · Io ${Core.formatThreshold(data.intensity)}</title></g>`
    : "";
  const mapBaseUrl = new URL("assets/map-base.jpg", location.href).href;
  const orthophotoUrl = pnoaReportUrl();
  const legend = raster
    ? `<div class="raster-legend"><span>I extraordinaria alta · ${Core.formatThreshold(raster.maximum)}</span><i></i><span>${Core.formatThreshold(raster.minimum)} · I extraordinaria baja</span></div><small class="raster-note">Rojo más oscuro: menor intensidad epicentral necesaria para alcanzar la situación extraordinaria.</small>`
    : "";
  return `<figure class="report-map"><svg viewBox="0 0 ${MAP.width} ${MAP.height}" role="img" aria-label="Ortofoto PNOA, intensidad extraordinaria, isolíneas de ${escapeHtml(label)} y epicentro"><image href="${escapeHtml(mapBaseUrl)}" x="0" y="0" width="${MAP.width}" height="${MAP.height}" preserveAspectRatio="none"/><image href="${escapeHtml(orthophotoUrl)}" x="0" y="0" width="${MAP.width}" height="${MAP.height}" preserveAspectRatio="none" opacity="0.9"/>${rasterOverlay}${paths}${marker}</svg>${legend}<figcaption><strong>${escapeHtml(label)}</strong> · ${escapeHtml(data.event || "Evento")} · Io ${Core.formatThreshold(data.intensity)}. <strong>TIF extraordinario:</strong> ${escapeHtml(raster?.sourceFile || "no disponible")}. El sombreado rojo representa su Banda 1; las isolíneas y el epicentro son información visual. Los cálculos siguen usando exclusivamente el valor de la celda del GeoTIFF. Base: <a href="https://pnoa.ign.es/pnoa-imagen/ortofotos-pnoa-maxima-actualidad" target="_blank" rel="noreferrer">Ortofoto PNOA máxima actualidad, IGN-CNIG</a>.</figcaption></figure>`;
}

function reportExtraRasterDataUrl(layerKey) {
  if (REPORT_RASTER_CACHE.has(layerKey)) return REPORT_RASTER_CACHE.get(layerKey);
  const raster = DATASETS?.[layerKey]?.extra;
  if (!raster?.values) return "";
  const canvas = document.createElement("canvas");
  canvas.width = REPORT_RASTER_WIDTH;
  canvas.height = REPORT_RASTER_HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) return "";
  const image = context.createImageData(canvas.width, canvas.height);
  const longitudeSpan = MAP.east - MAP.west;
  const latitudeSpan = MAP.north - MAP.south;
  for (let y = 0; y < canvas.height; y += 1) {
    const lat = MAP.north - ((y + 0.5) / canvas.height) * latitudeSpan;
    for (let x = 0; x < canvas.width; x += 1) {
      const lon = MAP.west + ((x + 0.5) / canvas.width) * longitudeSpan;
      const value = rasterValueAtCoordinates(raster, lat, lon);
      if (value == null) continue;
      const color = extraordinaryRasterColor(value, raster.minimum, raster.maximum);
      const offset = (y * canvas.width + x) * 4;
      image.data[offset] = color[0];
      image.data[offset + 1] = color[1];
      image.data[offset + 2] = color[2];
      image.data[offset + 3] = color[3];
    }
  }
  context.putImageData(image, 0, 0);
  const dataUrl = canvas.toDataURL("image/png");
  REPORT_RASTER_CACHE.set(layerKey, dataUrl);
  return dataUrl;
}

function rasterValueAtCoordinates(raster, lat, lon) {
  const projected = Core.wgs84ToUtm30(lat, lon);
  const transform = raster?.geoTransform;
  if (!projected || !raster?.values || !Array.isArray(transform) || transform.length !== 6) return null;
  const determinant = transform[1] * transform[5] - transform[2] * transform[4];
  if (!Number.isFinite(determinant) || determinant === 0) return null;
  const deltaX = projected.x - transform[0];
  const deltaY = projected.y - transform[3];
  const column = Math.floor((transform[5] * deltaX - transform[2] * deltaY) / determinant);
  const row = Math.floor((-transform[4] * deltaX + transform[1] * deltaY) / determinant);
  if (column < 0 || column >= raster.width || row < 0 || row >= raster.height) return null;
  const value = raster.values[row * raster.width + column];
  if (!Number.isFinite(value) || Math.abs(value) >= 3.4e38 || value === Math.fround(raster.noData)) return null;
  return value;
}

function extraordinaryRasterColor(value, minimum, maximum) {
  const span = Math.max(0.000001, maximum - minimum);
  const conditioning = Math.max(0, Math.min(1, (maximum - value) / span));
  const strength = Math.sqrt(conditioning);
  const light = [254, 230, 210];
  const dark = [153, 0, 45];
  return [
    Math.round(light[0] + (dark[0] - light[0]) * strength),
    Math.round(light[1] + (dark[1] - light[1]) * strength),
    Math.round(light[2] + (dark[2] - light[2]) * strength),
    Math.round(38 + 158 * strength),
  ];
}

function layerColor(layerKey) {
  return { casasola: "#db5d3f", guadalhorce: "#177e89", limonero: "#7656a8" }[layerKey] || "#177e89";
}

function pnoaReportUrl() {
  const url = new URL("https://www.ign.es/wms-inspire/pnoa-ma");
  url.search = new URLSearchParams({
    SERVICE: "WMS",
    VERSION: "1.3.0",
    REQUEST: "GetMap",
    LAYERS: "OI.OrthoimageCoverage",
    STYLES: "",
    FORMAT: "image/png",
    TRANSPARENT: "TRUE",
    CRS: "EPSG:4326",
    BBOX: `${MAP.south},${MAP.west},${MAP.north},${MAP.east}`,
    WIDTH: "1600",
    HEIGHT: "1027",
  }).toString();
  return url.href;
}

function reservoirDistances(data) {
  return ASSETS.map((asset) => ({
    asset,
    distanceKm: Core.haversineDistanceKm(data.lat, data.lon, asset.lat, asset.lon),
  }));
}

function formatDistance(value) {
  return value == null ? "−" : `${Number(value).toLocaleString("es-ES", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`;
}

function safeFilePart(value) {
  return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "evento";
}

function conditioningResult(results) {
  let best = null;
  let bestRank = -Infinity;
  for (const result of results) {
    const rank = Math.max(...Object.values(result.layers).map((decision) => SEVERITY[decision.level]));
    if (rank > bestRank) {
      best = result;
      bestRank = rank;
    }
  }
  return best;
}

function renderVectorOverlay() {
  const svg = $("vectorOverlay");
  svg.setAttribute("viewBox", `0 0 ${MAP.width} ${MAP.height}`);
  svg.replaceChildren();
  const collection = ISOLINES[state.activeLayer];
  for (const feature of collection?.features || []) {
    const pathData = geometryToPath(feature.geometry);
    if (!pathData) continue;
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", pathData);
    path.setAttribute("class", `vector-zone ${state.activeLayer}`);
    const label = `Isolínea de intensidad ${feature.properties.Intensidad}`;
    path.setAttribute("aria-label", label);
    svg.appendChild(path);
  }
}

function geometryToPath(geometry) {
  const lines = geometry?.type === "LineString"
    ? [geometry.coordinates]
    : geometry?.type === "MultiLineString"
      ? geometry.coordinates
      : geometry?.type === "Polygon"
        ? geometry.coordinates
        : geometry?.type === "MultiPolygon"
          ? geometry.coordinates.flat()
          : [];
  const parts = [];
  for (const line of lines) {
    const commands = line.map(([lon, lat], index) => {
      const point = latLonToPixel(lat, lon);
      return `${index ? "L" : "M"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`;
    });
    if (commands.length) parts.push(commands.join(""));
  }
  return parts.join("");
}

function renderMapMarkers() {
  const container = $("eventMarkers");
  container.replaceChildren();
  for (const [index, result] of state.results.entries()) {
    if (result.data.lat == null || result.data.lon == null) continue;
    const point = latLonToPixel(result.data.lat, result.data.lon);
    if (!isPixelInMap(point)) continue;
    const marker = document.createElement("button");
    const worst = Core.worstDecision(Object.values(result.layers));
    marker.type = "button";
    const isSelected = result === state.selected;
    marker.className = `quake-marker ${statusClass(worst.level)}${isSelected ? " selected" : ""}`;
    marker.style.left = `${(point.x / MAP.width) * 100}%`;
    marker.style.top = `${(point.y / MAP.height) * 100}%`;
    const tooltipText = eventMarkerTooltip(result);
    marker.title = tooltipText.replace(/\n/g, " | ");
    marker.setAttribute("aria-label", marker.title);
    marker.setAttribute("aria-pressed", String(isSelected));
    const showEventTip = (event) => {
      event.stopPropagation();
      const tip = $("coordTip");
      tip.textContent = tooltipText;
      tip.classList.add("visible", "event-tip");
      positionMapTip(event, tip, 350, 150);
    };
    marker.addEventListener("pointerenter", showEventTip);
    marker.addEventListener("pointermove", showEventTip);
    marker.addEventListener("pointerleave", () => $("coordTip").classList.remove("visible", "event-tip"));
    marker.addEventListener("pointerdown", (event) => event.stopPropagation());
    marker.addEventListener("click", (event) => {
      event.stopPropagation();
      selectResult(state.results[index]);
    });
    container.appendChild(marker);
  }
  const selectedMarker = $("selectedMarker");
  if (!state.selected || state.selected.data.lat == null || state.selected.data.lon == null) {
    selectedMarker.style.display = "none";
    return;
  }
  const point = latLonToPixel(state.selected.data.lat, state.selected.data.lon);
  if (!isPixelInMap(point)) {
    selectedMarker.style.display = "none";
    return;
  }
  selectedMarker.style.display = "block";
  selectedMarker.style.left = `${(point.x / MAP.width) * 100}%`;
  selectedMarker.style.top = `${(point.y / MAP.height) * 100}%`;
  $("selectedMarkerLabel").textContent = `${state.selected.data.event || "Evento"} · Io ${Core.formatThreshold(state.selected.data.intensity)}`;
}

function eventMarkerTooltip(result) {
  const casasola = result.layers?.casasola?.thresholds || {};
  const guadalhorce = result.layers?.guadalhorce?.thresholds || {};
  const limonero = result.layers?.limonero?.thresholds || {};
  return `${result.data.event || "Evento"} · Io calculada ${Core.formatThreshold(result.data.intensity)}\nCasasola: I extraordinaria ${Core.formatThreshold(casasola.extra)} · I Escenario 0 ${Core.formatThreshold(casasola.zero)}\nSistema Guadalhorce: I extraordinaria ${Core.formatThreshold(guadalhorce.extra)} · I Escenario 0 ${Core.formatThreshold(guadalhorce.zero)}\nLimonero: I extraordinaria ${Core.formatThreshold(limonero.extra)} · I Escenario 0 ${Core.formatThreshold(limonero.zero)}`;
}

function initLayerSwitch() {
  for (const button of document.querySelectorAll("[data-layer]")) {
    button.addEventListener("click", () => {
      state.activeLayer = button.dataset.layer;
      document.querySelectorAll("[data-layer]").forEach((item) => item.classList.toggle("active", item === button));
      renderVectorOverlay();
      const label = `Isolíneas ${layerLabel(state.activeLayer)}`;
      $("layerLegend").innerHTML = `<i class="legend-line ${state.activeLayer}"></i> ${label}`;
    });
  }
}

function initMapInteractions() {
  const frame = $("mapFrame");
  let dragging = false;
  let start = null;
  for (const button of document.querySelectorAll("[data-map-action]")) {
    button.addEventListener("click", () => {
      const action = button.dataset.mapAction;
      if (action === "reset") state.mapView = { scale: 1, x: 0, y: 0 };
      else zoomMap(action === "in" ? 1.25 : 0.8, frame.clientWidth / 2, frame.clientHeight / 2);
      applyMapTransform();
    });
  }
  frame.addEventListener("wheel", (event) => {
    event.preventDefault();
    const rect = frame.getBoundingClientRect();
    zoomMap(event.deltaY < 0 ? 1.15 : 0.87, event.clientX - rect.left, event.clientY - rect.top);
    applyMapTransform();
  }, { passive: false });
  frame.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    dragging = true;
    start = { x: event.clientX, y: event.clientY, view: { ...state.mapView } };
    frame.setPointerCapture(event.pointerId);
    frame.classList.add("dragging");
  });
  frame.addEventListener("pointermove", (event) => {
    updateCoordinateTip(event);
    if (!dragging) return;
    state.mapView.x = start.view.x + event.clientX - start.x;
    state.mapView.y = start.view.y + event.clientY - start.y;
    applyMapTransform();
  });
  const stopDrag = () => { dragging = false; frame.classList.remove("dragging"); };
  frame.addEventListener("pointerup", stopDrag);
  frame.addEventListener("pointercancel", stopDrag);
  frame.addEventListener("pointerleave", () => $("coordTip").classList.remove("visible"));
  window.addEventListener("resize", applyMapTransform);
}

function zoomMap(factor, originX, originY) {
  const view = state.mapView;
  const next = Math.max(1, Math.min(10, view.scale * factor));
  const actual = next / view.scale;
  view.x = originX - (originX - view.x) * actual;
  view.y = originY - (originY - view.y) * actual;
  view.scale = next;
}

function applyMapTransform() {
  const frame = $("mapFrame");
  const view = state.mapView;
  view.x = Math.min(0, Math.max(frame.clientWidth * (1 - view.scale), view.x));
  view.y = Math.min(0, Math.max(frame.clientHeight * (1 - view.scale), view.y));
  const layer = $("mapLayer");
  layer.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
  layer.style.setProperty("--marker-inverse-scale", String(1 / view.scale));
  layer.style.setProperty("--line-inverse-scale", String(1 / view.scale));
  renderSatelliteTiles();
}

function updateCoordinateTip(event) {
  const frame = $("mapFrame");
  const rect = frame.getBoundingClientRect();
  const view = state.mapView;
  const px = ((event.clientX - rect.left - view.x) / view.scale) * (MAP.width / frame.clientWidth);
  const py = ((event.clientY - rect.top - view.y) / view.scale) * (MAP.height / frame.clientHeight);
  const tip = $("coordTip");
  tip.classList.remove("event-tip");
  if (!isPixelInMap({ x: px, y: py })) {
    tip.classList.remove("visible");
    return;
  }
  const geo = pixelToLatLon(px, py);
  const thresholds = Core.readThresholds(state.activeLayer, geo.lat, geo.lon, DATASETS);
  tip.textContent = `Lat ${geo.lat.toFixed(4)} · Lon ${geo.lon.toFixed(4)} · Banda 1 Extra ${Core.formatThreshold(thresholds.extra)} · Banda 1 E0 ${Core.formatThreshold(thresholds.zero)}`;
  positionMapTip(event, tip, 280, 58);
  tip.classList.add("visible");
}

function positionMapTip(event, tip, width, height) {
  const frame = $("mapFrame");
  const rect = frame.getBoundingClientRect();
  tip.style.left = `${Math.min(frame.clientWidth - width, Math.max(8, event.clientX - rect.left + 18))}px`;
  tip.style.top = `${Math.min(frame.clientHeight - height, Math.max(8, event.clientY - rect.top + 18))}px`;
}

function renderSatelliteTiles() {
  const container = $("satelliteTiles");
  const zoom = Math.min(10, 6 + Math.ceil(Math.log2(Math.max(1, state.mapView.scale))));
  const nwTile = lonLatToTile(MAP.west, MAP.north, zoom);
  const seTile = lonLatToTile(MAP.east, MAP.south, zoom);
  const startX = Math.floor(nwTile.x);
  const endX = Math.floor(seTile.x);
  const startY = Math.floor(nwTile.y);
  const endY = Math.floor(seTile.y);
  const key = `${zoom}:${startX}:${endX}:${startY}:${endY}`;
  if (key === state.tileKey) return;
  state.tileKey = key;
  const fragment = document.createDocumentFragment();
  const worldTiles = 2 ** zoom;
  for (let y = startY; y <= endY; y += 1) {
    for (let x = startX; x <= endX; x += 1) {
      const img = document.createElement("img");
      const wrapped = ((x % worldTiles) + worldTiles) % worldTiles;
      img.src = `https://mt${Math.abs(x + y) % 4}.google.com/vt/lyrs=s&x=${wrapped}&y=${y}&z=${zoom}`;
      img.alt = "";
      img.loading = "lazy";
      const box = tileBox(x, y, zoom);
      img.style.left = `${box.left}%`;
      img.style.top = `${box.top}%`;
      img.style.width = `${box.width}%`;
      img.style.height = `${box.height}%`;
      fragment.appendChild(img);
    }
  }
  container.replaceChildren(fragment);
}

function lonLatToTile(lon, lat, zoom) {
  const scale = 2 ** zoom;
  const sin = Math.sin(Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI / 180);
  return { x: ((lon + 180) / 360) * scale, y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale };
}

function tileToLonLat(x, y, zoom) {
  const scale = 2 ** zoom;
  const lon = (x / scale) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / scale;
  const lat = 180 / Math.PI * Math.atan(Math.sinh(n));
  return { lat, lon };
}

function tileBox(x, y, zoom) {
  const a = latLonToPixel(tileToLonLat(x, y, zoom).lat, tileToLonLat(x, y, zoom).lon);
  const b = latLonToPixel(tileToLonLat(x + 1, y + 1, zoom).lat, tileToLonLat(x + 1, y + 1, zoom).lon);
  return { left: a.x / MAP.width * 100, top: a.y / MAP.height * 100, width: (b.x - a.x) / MAP.width * 100, height: (b.y - a.y) / MAP.height * 100 };
}

function latLonToPixel(lat, lon) {
  return { x: (lon - MAP.west) * MAP.pxDegX, y: (MAP.north - lat) * MAP.pxDegY };
}

function pixelToLatLon(x, y) {
  return { lon: MAP.west + x / MAP.pxDegX, lat: MAP.north - y / MAP.pxDegY };
}

function isPixelInMap(point) {
  return point.x >= 0 && point.x <= MAP.width && point.y >= 0 && point.y <= MAP.height;
}

function initFileInput() {
  const input = $("fileInput");
  const dropzone = $("dropzone");
  input.addEventListener("change", async () => {
    if (input.files[0]) $("textInput").value = await readFileText(input.files[0]);
  });
  for (const name of ["dragenter", "dragover"]) dropzone.addEventListener(name, (event) => { event.preventDefault(); dropzone.classList.add("drag"); });
  for (const name of ["dragleave", "drop"]) dropzone.addEventListener(name, (event) => { event.preventDefault(); dropzone.classList.remove("drag"); });
  dropzone.addEventListener("drop", async (event) => {
    const file = event.dataTransfer.files[0];
    if (file) $("textInput").value = await readFileText(file);
  });
}

async function readFileText(file) {
  const buffer = await file.arrayBuffer();
  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) return extractPdfText(buffer);
  return new TextDecoder("utf-8").decode(buffer);
}

async function extractPdfText(buffer) {
  const bytes = new Uint8Array(buffer);
  const latin = new TextDecoder("latin1").decode(bytes);
  const chunks = [];
  let index = 0;
  while (true) {
    const streamPos = latin.indexOf("stream", index);
    if (streamPos < 0) break;
    let start = streamPos + 6;
    if (latin[start] === "\r" && latin[start + 1] === "\n") start += 2;
    else if (latin[start] === "\n") start += 1;
    const end = latin.indexOf("endstream", start);
    if (end < 0) break;
    const dictStart = latin.lastIndexOf("<<", streamPos);
    const dict = dictStart >= 0 ? latin.slice(dictStart, streamPos) : "";
    let streamText = "";
    const streamBytes = bytes.slice(start, end - (latin[end - 1] === "\n" ? 1 : 0));
    if (dict.includes("/FlateDecode") && "DecompressionStream" in window) {
      try {
        const stream = new Blob([streamBytes]).stream().pipeThrough(new DecompressionStream("deflate"));
        streamText = new TextDecoder("latin1").decode(await new Response(stream).arrayBuffer());
      } catch { streamText = ""; }
    } else streamText = new TextDecoder("latin1").decode(streamBytes);
    for (const match of streamText.matchAll(/\((?:\\.|[^\\)])*\)/g)) chunks.push(unescapePdf(match[0].slice(1, -1)));
    index = end + 9;
  }
  if (!chunks.length) throw new Error("El PDF no contiene texto extraíble; copia y pega el boletín.");
  return chunks.join(" ");
}

function unescapePdf(value) {
  return value.replace(/\\([nrtbf()\\])/g, (_, code) => ({ n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", "(": "(", ")": ")", "\\": "\\" }[code]));
}

function statusPill(level) {
  return `<td>${statusPillInline(level)}</td>`;
}

function statusPillInline(level) {
  return `<span class="status-pill ${statusClass(level)}">${escapeHtml(Core.statusLabel(level))}</span>`;
}

function statusClass(level) {
  return ({ [LEVELS.ZERO]: "zero", [LEVELS.EXTRA]: "extra", [LEVELS.ORDINARY]: "ordinary" })[level] || "unknown";
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

function setButtonBusy(button, busy, label) {
  button.disabled = busy;
  button.textContent = label;
}

function setNotice(message, error = false) {
  $("analysisSummary").textContent = message;
  $("analysisSummary").style.color = error ? "var(--zero)" : "";
}
