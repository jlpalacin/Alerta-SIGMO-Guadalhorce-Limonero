"use strict";

const Core = window.AlertCore;
const DATASETS = window.RESERVOIR_VECTOR_DATA;
const { LEVELS, SEVERITY } = Core;

const ASSETS = [
  { key: "casasola", label: "Casasola", layer: "casasola" },
  { key: "conde", label: "El Conde de Guadalhorce", layer: "guadalhorce" },
  { key: "guadalhorce", label: "Guadalhorce", layer: "guadalhorce" },
  { key: "guadalteba", label: "Guadalteba", layer: "guadalhorce" },
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

function init() {
  $("readIgnBtn").addEventListener("click", runIgnRead);
  $("analyzeBtn").addEventListener("click", runBulletinAnalysis);
  $("reportBtn").addEventListener("click", generateSelectedReport);
  $("sampleBtn").addEventListener("click", async () => {
    $("textInput").value = SAMPLE_TEXT;
    await runBulletinAnalysis();
  });
  $("clearBtn").addEventListener("click", clearAnalysis);
  initFileInput();
  initLayerSwitch();
  initMapInteractions();
  renderVectorOverlay();
  applyMapTransform();
  renderAll();
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
    const intensity = Core.parseIntensity(cells[9]);
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
      intensity,
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
    eventText.textContent = asset.layer === "guadalhorce" ? "Capa común del sistema Guadalhorce" : "Esperando lectura del IGN";
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
      <td>${Core.formatThreshold(data.intensity)}</td>
      ${assetCells}
      <td>${escapeHtml(data.zone || "−")}</td>
    </tr>`;
  }).join("");
  list.innerHTML = `<table class="event-table">
    <thead><tr><th>Evento</th><th>UTC</th><th>Magnitud</th><th>Io</th><th>Casasola</th><th>Conde</th><th>Guadalhorce</th><th>Guadalteba</th><th>Zona</th></tr></thead>
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
  $("detailIntensity").textContent = Core.formatThreshold(data.intensity);
  $("detailCoords").textContent = data.lat == null || data.lon == null ? "−" : `${Core.formatNumber(data.lat)}, ${Core.formatNumber(data.lon)}`;
  $("detailZone").textContent = data.zone || "−";
  $("calculationTrace").innerHTML = calculationTraceHtml(result);
  $("layerResults").innerHTML = ["casasola", "guadalhorce"].map((layerKey) => layerResultHtml(result.layers[layerKey])).join("");
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
      <li>Conversión a Mw: ${escapeHtml(data.magnitudeConversion || "magnitud expresada en Mw")} → <strong>Mw = ${Core.formatThreshold(data.mw)}</strong>.</li>
      <li>Relación aplicada: <code>Io = (Mw − 1,656) / 0,545</code>.</li>
      <li>Sustitución: <code>Io = (${Core.formatThreshold(data.mw)} − 1,656) / 0,545</code> → <strong>Io = ${Core.formatThreshold(data.intensity)}</strong>.</li>
    </ol>`;
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
        <p>No se recalculan mediante otra fórmula. En las coordenadas del epicentro se consultan los polígonos de cada capa:</p>
        <ul>
          <li><code>IntensidadExtraordinaria</code>: umbral de situación extraordinaria.</li>
          <li><code>Intensidad</code>: umbral de Escenario 0.</li>
          <li>Si el punto pertenece a varios polígonos anidados, se adopta el <strong>menor umbral</strong> de cada campo.</li>
        </ul>
        <p>Finalmente se compara Io con ambos umbrales. El detalle de cada capa aparece debajo.</p>
      </div>
    </article>`;
}

function layerResultHtml(decision) {
  const thresholds = decision.thresholds || {};
  const label = decision.layerKey === "casasola" ? "Casasola" : "Sistema Guadalhorce";
  return `<article class="layer-result ${statusClass(decision.level)}">
    <div class="layer-result-head"><h3>${label}</h3>${statusPillInline(decision.level)}</div>
    <div class="threshold-pair">
      <div><span>Extra · IntensidadExtraordinaria</span><strong>${Core.formatThreshold(thresholds.extra)}</strong></div>
      <div><span>Escenario 0 · Intensidad</span><strong>${Core.formatThreshold(thresholds.zero)}</strong></div>
    </div>
    <p class="decision-equation">${decisionEquation(decision)}</p>
    <ul class="reason-list">${decision.reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join("")}</ul>
  </article>`;
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
  const html = buildReportHtml(state.selected);
  const reportWindow = window.open("", "_blank");
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
  const assetRows = ASSETS.map((asset) => {
    const decision = result.layers[asset.layer];
    return `<tr><td>${escapeHtml(asset.label)}</td><td><span class="pill ${statusClass(decision.level)}">${escapeHtml(Core.statusLabel(decision.level))}</span></td><td>${escapeHtml(decisionEquation(decision))}</td></tr>`;
  }).join("");
  const layers = ["casasola", "guadalhorce"].map((layerKey) => reportLayerHtml(result.layers[layerKey])).join("");
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Informe sísmico · ${escapeHtml(data.event || "Evento")}</title><style>
    :root{--ink:#153237;--muted:#61767a;--line:#d9e3e1;--teal:#0d736e;--ordinary:#247047;--extra:#9b5b00;--zero:#b42318;--unknown:#617079}*{box-sizing:border-box}body{margin:0;background:#eef3f2;color:var(--ink);font-family:Arial,sans-serif;line-height:1.45}.page{max-width:980px;margin:28px auto;padding:38px;background:#fff;box-shadow:0 8px 30px #1734381c}header{display:flex;justify-content:space-between;gap:24px;padding-bottom:22px;border-bottom:3px solid var(--teal)}h1{margin:0;font-size:27px}h2{margin:28px 0 12px;font-size:17px}h3{margin:0 0 10px;font-size:15px}.meta{color:var(--muted);font-size:12px;text-align:right}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.metric,.card{padding:14px;border:1px solid var(--line);border-radius:10px}.metric span{display:block;color:var(--muted);font-size:11px}.metric strong{display:block;margin-top:6px;font-size:14px}.calculation{padding:16px 18px;border-left:4px solid var(--teal);background:#f4f8f7}.calculation p{margin:6px 0;font-size:13px}code{background:#e4efed;padding:2px 4px;border-radius:4px}table{width:100%;border-collapse:collapse;font-size:12px}th,td{padding:10px;border:1px solid var(--line);text-align:left;vertical-align:top}th{background:#f3f7f6}.pill{display:inline-block;padding:4px 8px;border-radius:20px;font-weight:700;white-space:nowrap}.ordinary{color:var(--ordinary);background:#e8f4ec}.extra{color:var(--extra);background:#fff0c8}.zero{color:var(--zero);background:#fde9e7}.unknown{color:var(--unknown);background:#edf1f2}.layers{display:grid;grid-template-columns:1fr 1fr;gap:12px}.card p,.card li{font-size:12px}.thresholds{display:flex;gap:18px;margin:10px 0}.thresholds span{color:var(--muted);font-size:11px}.thresholds strong{display:block;color:var(--ink);font-size:15px}.notice{margin-top:28px;padding:14px;background:#fff8e7;color:#66542d;font-size:11px}.toolbar{max-width:980px;margin:20px auto 0;text-align:right}.toolbar button{padding:10px 16px;border:0;border-radius:8px;background:var(--teal);color:#fff;font-weight:700;cursor:pointer}@media(max-width:700px){.page{margin:0;padding:22px}.grid,.layers{grid-template-columns:1fr 1fr}header{display:block}.meta{text-align:left;margin-top:10px}}@media print{body{background:#fff}.toolbar{display:none}.page{max-width:none;margin:0;padding:0;box-shadow:none}thead{display:table-header-group}.card{break-inside:avoid}}
  </style></head><body><div class="toolbar"><button type="button" onclick="window.print()">Imprimir / Guardar como PDF</button></div><main class="page">
    <header><div><p style="margin:0;color:var(--teal);font-size:12px;font-weight:700">SEGURIDAD DE PRESAS · DHCMA</p><h1>Informe de evaluación sísmica</h1></div><div class="meta">Generado el ${escapeHtml(generated)}<br>Aplicación Alerta sísmica por embalse</div></header>
    <h2>Evento seleccionado</h2><div class="grid">
      <div class="metric"><span>Evento</span><strong>${escapeHtml(data.event || "Evento manual")}</strong></div>
      <div class="metric"><span>Fecha y hora UTC</span><strong>${escapeHtml([data.date, data.utc].filter(Boolean).join(" ") || "−")}</strong></div>
      <div class="metric"><span>Magnitud</span><strong>${data.magnitude == null ? "−" : `${Core.formatThreshold(data.magnitude)} ${escapeHtml(data.magnitudeType || "")}`}</strong></div>
      <div class="metric"><span>Intensidad Io</span><strong>${Core.formatThreshold(data.intensity)}</strong></div>
      <div class="metric"><span>Latitud</span><strong>${Core.formatThreshold(data.lat)}</strong></div>
      <div class="metric"><span>Longitud</span><strong>${Core.formatThreshold(data.lon)}</strong></div>
      <div class="metric"><span>Profundidad</span><strong>${depthKm == null ? "−" : `${Core.formatThreshold(depthKm)} km`}</strong></div>
      <div class="metric"><span>Zona epicentral</span><strong>${escapeHtml(data.zone || "−")}</strong></div>
    </div>
    <h2>Cálculo de Io</h2><div class="calculation">${reportCalculationHtml(data)}</div>
    <h2>Estado de alerta por embalse</h2><table><thead><tr><th>Embalse</th><th>Estado</th><th>Comparación aplicada</th></tr></thead><tbody>${assetRows}</tbody></table>
    <h2>Umbrales de las capas de intensidad</h2><div class="layers">${layers}</div>
    <div class="notice"><strong>Nota:</strong> resultado orientativo. No sustituye el Plan de Emergencia de Presa ni la valoración técnica de los organismos competentes.</div>
  </main></body></html>`;
}

function reportCalculationHtml(data) {
  if (data.intensitySource === "reported") return `<p>La intensidad <strong>Io = ${Core.formatThreshold(data.intensity)}</strong> se tomó directamente del boletín. No se aplicó conversión de magnitud.</p>`;
  if (data.intensitySource === "estimated") return `<p>Magnitud de entrada: <strong>${Core.formatThreshold(data.magnitude)} ${escapeHtml(data.magnitudeType || "")}</strong>.</p><p>${escapeHtml(data.magnitudeConversion || "Conversión a Mw")}.</p><p>Relación: <code>Io = (Mw − 1,656) / 0,545</code>.</p><p>Sustitución: <code>Io = (${Core.formatThreshold(data.mw)} − 1,656) / 0,545</code> → <strong>Io = ${Core.formatThreshold(data.intensity)}</strong>.</p>`;
  if (data.intensitySource === "pga") return `<p>No se obtuvo Io. La evaluación se realizó con la PGA comunicada: <strong>${Core.formatThreshold(data.pga)} cm/s²</strong>.</p>`;
  return "<p>No hay datos suficientes para calcular Io; se requiere revisión manual.</p>";
}

function reportLayerHtml(decision) {
  const thresholds = decision.thresholds || {};
  const label = decision.layerKey === "casasola" ? "Casasola" : "Sistema Guadalhorce";
  return `<article class="card"><h3>${label}</h3><div class="thresholds"><div><span>Extraordinaria</span><strong>${Core.formatThreshold(thresholds.extra)}</strong></div><div><span>Escenario 0</span><strong>${Core.formatThreshold(thresholds.zero)}</strong></div></div><p><strong>${escapeHtml(decisionEquation(decision))}</strong></p><ul>${decision.reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join("")}</ul></article>`;
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
  const collection = DATASETS[state.activeLayer];
  for (const feature of collection?.features || []) {
    const pathData = geometryToPath(feature.geometry);
    if (!pathData) continue;
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", pathData);
    path.setAttribute("class", `vector-zone ${state.activeLayer}`);
    const label = `Extra ${feature.properties.IntensidadExtraordinaria} / E0 ${feature.properties.Intensidad}`;
    path.setAttribute("aria-label", label);
    svg.appendChild(path);
  }
}

function geometryToPath(geometry) {
  const polygons = geometry?.type === "Polygon" ? [geometry.coordinates] : geometry?.type === "MultiPolygon" ? geometry.coordinates : [];
  const parts = [];
  for (const polygon of polygons) {
    for (const ring of polygon) {
      const commands = ring.map(([lon, lat], index) => {
        const point = latLonToPixel(lat, lon);
        return `${index ? "L" : "M"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`;
      });
      if (commands.length) parts.push(`${commands.join("")}Z`);
    }
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
    marker.className = `quake-marker ${statusClass(worst.level)}`;
    marker.style.left = `${(point.x / MAP.width) * 100}%`;
    marker.style.top = `${(point.y / MAP.height) * 100}%`;
    marker.title = `${result.data.event || "Evento"}: ${Core.statusLabel(worst.level)}`;
    marker.addEventListener("click", () => selectResult(state.results[index]));
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

function initLayerSwitch() {
  for (const button of document.querySelectorAll("[data-layer]")) {
    button.addEventListener("click", () => {
      state.activeLayer = button.dataset.layer;
      document.querySelectorAll("[data-layer]").forEach((item) => item.classList.toggle("active", item === button));
      renderVectorOverlay();
      const label = state.activeLayer === "casasola" ? "Curvas Casasola" : "Curvas Sistema Guadalhorce";
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
  renderSatelliteTiles();
}

function updateCoordinateTip(event) {
  const frame = $("mapFrame");
  const rect = frame.getBoundingClientRect();
  const view = state.mapView;
  const px = ((event.clientX - rect.left - view.x) / view.scale) * (MAP.width / frame.clientWidth);
  const py = ((event.clientY - rect.top - view.y) / view.scale) * (MAP.height / frame.clientHeight);
  const tip = $("coordTip");
  if (!isPixelInMap({ x: px, y: py })) {
    tip.classList.remove("visible");
    return;
  }
  const geo = pixelToLatLon(px, py);
  const thresholds = Core.readThresholds(state.activeLayer, geo.lat, geo.lon, DATASETS);
  tip.textContent = `Lat ${geo.lat.toFixed(4)} · Lon ${geo.lon.toFixed(4)} · Extra ${Core.formatThreshold(thresholds.extra)} · E0 ${Core.formatThreshold(thresholds.zero)}`;
  tip.style.left = `${Math.min(frame.clientWidth - 280, Math.max(8, event.clientX - rect.left + 18))}px`;
  tip.style.top = `${Math.min(frame.clientHeight - 58, Math.max(8, event.clientY - rect.top + 18))}px`;
  tip.classList.add("visible");
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
