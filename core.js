(function initAlertCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.AlertCore = api;
})(typeof window !== "undefined" ? window : globalThis, function createAlertCore() {
  "use strict";

  const LEVELS = Object.freeze({
    ORDINARY: "ORDINARY",
    EXTRA: "EXTRA",
    ZERO: "ZERO",
    UNKNOWN: "UNKNOWN",
  });

  const SEVERITY = Object.freeze({
    [LEVELS.UNKNOWN]: -1,
    [LEVELS.ORDINARY]: 0,
    [LEVELS.EXTRA]: 1,
    [LEVELS.ZERO]: 2,
  });

  // Las capas corregidas comparten la misma correspondencia de campos.
  const LAYERS = Object.freeze({
    casasola: {
      key: "casasola",
      label: "Casasola",
      extraField: "IntensidadExtraordinaria",
      zeroField: "Intensidad",
    },
    guadalhorce: {
      key: "guadalhorce",
      label: "Sistema Guadalhorce",
      extraField: "IntensidadExtraordinaria",
      zeroField: "Intensidad",
    },
  });

  function toNumber(value) {
    if (value == null || value === "") return null;
    const parsed = Number(String(value).replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
  }

  function parseIntensity(value) {
    const match = String(value || "").match(/(?:Intensidad\s*(?:EMS|epicentral|Io|I0)?[^0-9IVX]*)?([0-9]+(?:[,.][0-9]+)?|XII|XI|IX|VIII|VII|VI|IV|X|V)/i);
    if (!match) return null;
    const roman = { IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10, XI: 11, XII: 12 };
    return roman[match[1].toUpperCase()] ?? toNumber(match[1]);
  }

  function normalizeMagnitudeType(type = "") {
    return String(type).trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  function toMomentMagnitude(magnitude, type = "") {
    if (!Number.isFinite(magnitude)) return null;
    const key = normalizeMagnitudeType(type);
    const candidates = {
      direct: magnitude,
      mbLg: 0.836 * magnitude + 0.676,
      mb: 1.213 * magnitude - 1.528,
    };
    if (["mw", "mww", "mwc", "mwr", "mwp", "m"].includes(key)) {
      return { mw: candidates.direct, method: "magnitud ya expresada como Mw" };
    }
    if (key.includes("mblg") || key === "mlg") {
      return { mw: candidates.mbLg, method: "conversion mbLg -> Mw: Mw = 0,836 M + 0,676" };
    }
    if (key === "mb" || key.startsWith("mb")) {
      return { mw: candidates.mb, method: "conversion mb -> Mw: Mw = 1,213 M - 1,528" };
    }
    return {
      mw: Math.max(candidates.direct, candidates.mbLg, candidates.mb),
      method: `tipo ${type || "desconocido"}; se adopta la mayor estimacion disponible`,
    };
  }

  function enrichEvent(event) {
    const data = { ...event };
    data.lat = toNumber(data.lat);
    data.lon = toNumber(data.lon);
    data.depthKm = toNumber(data.depthKm);
    data.magnitude = toNumber(data.magnitude);
    data.intensity = toNumber(data.intensity);
    data.reportedIntensity = data.intensity;
    data.pga = toNumber(data.pga);
    const reasons = [];
    if (data.intensity != null) {
      data.intensitySource = "reported";
      data.intensityCalculation = `Io ${formatNumber(data.intensity)} tomada directamente del boletin analizado.`;
    }
    if (data.intensity == null && data.magnitude != null) {
      const conversion = toMomentMagnitude(data.magnitude, data.magnitudeType);
      data.mw = conversion?.mw ?? null;
      data.magnitudeConversion = conversion?.method ?? "";
      if (data.mw != null) {
        data.intensity = (data.mw - 1.656) / 0.545;
        data.intensitySource = "estimated";
        data.intensityFormula = "Io = (Mw - 1,656) / 0,545";
        data.intensityCalculation = `Io = (${formatNumber(data.mw)} - 1,656) / 0,545 = ${formatNumber(data.intensity)}.`;
        reasons.push(`Mw ${formatNumber(data.mw)} e Io ${formatNumber(data.intensity)} calculadas desde ${data.magnitudeType || "magnitud"} ${formatNumber(data.magnitude)}.`);
      }
    }
    if (data.intensity == null && data.pga != null) {
      data.intensitySource = "pga";
      data.intensityCalculation = "No se obtuvo Io; la decision se basa directamente en la PGA comunicada.";
    }
    return { data, reasons };
  }

  function parseBulletin(text) {
    const source = String(text || "").replace(/\u0000/g, " ").replace(/[ \t]+/g, " ").replace(/\r/g, "\n");
    const pick = (regex) => source.match(regex)?.[1]?.trim() ?? null;
    const coordinate = (regex) => {
      const match = source.match(regex);
      if (!match) return null;
      const value = toNumber(match[1]);
      const direction = (match[3] || "").toLowerCase();
      return ["sur", "s", "oeste", "w", "o"].includes(direction) ? -Math.abs(value) : value;
    };
    const intensityText = pick(/Intensidad\s*(?:EMS|epicentral|Io|I0)?[^0-9IVX]*([0-9]+(?:[,.][0-9]+)?|XII|XI|IX|VIII|VII|VI|IV|X|V)/i);
    return {
      event: pick(/EVENTO:\s*([A-Za-z0-9_-]+)/i),
      utc: pick(/HORA\s+UTC:\s*([^\n]+)/i),
      localTime: pick(/HORA\s+LOCAL\(?\*?\)?:\s*([^\n]+)/i),
      zone: pick(/Zona\s+epicentral:\s*([^\n]+)/i),
      depthKm: toNumber(pick(/Profundidad:\s*([0-9]+(?:[,.][0-9]+)?)/i)),
      lat: coordinate(/Latitud:\s*([0-9]+(?:[,.][0-9]+)?)\s*(grados)?\s*(norte|sur|N|S)?/i),
      lon: coordinate(/Longitud:\s*([0-9]+(?:[,.][0-9]+)?)\s*(grados)?\s*(este|oeste|E|W|O)?/i),
      magnitudeType: pick(/Magnitud\s*([A-Za-z0-9]+)?\s*:\s*[-+]?[0-9]+(?:[,.][0-9]+)?/i) || "Mw",
      magnitude: toNumber(pick(/Magnitud\s*[A-Za-z0-9]*\s*:\s*([-+]?[0-9]+(?:[,.][0-9]+)?)/i)),
      intensity: intensityText ? parseIntensity(intensityText) : null,
      pga: toNumber(pick(/\bPGA\b[^0-9]*([0-9]+(?:[,.][0-9]+)?)/i)),
    };
  }

  function geometryContainsLonLat(geometry, lon, lat) {
    if (!geometry) return false;
    if (geometry.type === "Polygon") return polygonContainsLonLat(geometry.coordinates, lon, lat);
    if (geometry.type === "MultiPolygon") return geometry.coordinates.some((polygon) => polygonContainsLonLat(polygon, lon, lat));
    return false;
  }

  function polygonContainsLonLat(polygon, lon, lat) {
    if (!polygon?.length || !pointInRing(polygon[0], lon, lat)) return false;
    for (let i = 1; i < polygon.length; i += 1) {
      if (pointInRing(polygon[i], lon, lat)) return false;
    }
    return true;
  }

  function pointInRing(ring, lon, lat) {
    if (!ring?.length) return false;
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      const crossing = ((yi > lat) !== (yj > lat)) && (lon < ((xj - xi) * (lat - yi)) / (yj - yi || Number.EPSILON) + xi);
      if (crossing) inside = !inside;
    }
    return inside;
  }

  function collectionBounds(collection) {
    let west = Infinity;
    let east = -Infinity;
    let south = Infinity;
    let north = -Infinity;
    const visit = (node) => {
      if (!Array.isArray(node)) return;
      if (node.length >= 2 && typeof node[0] === "number" && typeof node[1] === "number") {
        west = Math.min(west, node[0]);
        east = Math.max(east, node[0]);
        south = Math.min(south, node[1]);
        north = Math.max(north, node[1]);
        return;
      }
      node.forEach(visit);
    };
    for (const feature of collection?.features || []) visit(feature.geometry?.coordinates);
    return { west, east, south, north };
  }

  function readThresholds(layerKey, lat, lon, datasets) {
    const config = LAYERS[layerKey];
    const collection = datasets?.[layerKey];
    if (!config || !collection) return { extra: null, zero: null, matches: 0, inCoverage: false };
    const bounds = collection.__bounds || (collection.__bounds = collectionBounds(collection));
    const inCoverage = lon >= bounds.west && lon <= bounds.east && lat >= bounds.south && lat <= bounds.north;
    let extra = null;
    let zero = null;
    let matches = 0;
    for (const feature of collection.features || []) {
      if (!geometryContainsLonLat(feature.geometry, lon, lat)) continue;
      matches += 1;
      const extraValue = toNumber(feature.properties?.[config.extraField]);
      const zeroValue = toNumber(feature.properties?.[config.zeroField]);
      if (extraValue != null) extra = extra == null ? extraValue : Math.min(extra, extraValue);
      if (zeroValue != null) zero = zero == null ? zeroValue : Math.min(zero, zeroValue);
    }
    return { extra, zero, matches, inCoverage, bounds };
  }

  function evaluateLayer(layerKey, enrichedEvent, datasets, priorReasons = []) {
    const data = enrichedEvent;
    const reasons = [...priorReasons];
    if (data.lat == null || data.lon == null) {
      reasons.push("Faltan latitud o longitud; se requiere revision manual.");
      return decision(LEVELS.UNKNOWN, layerKey, data, null, reasons);
    }
    if (data.intensity == null && data.pga == null) {
      reasons.push("No hay intensidad, magnitud util ni PGA; se requiere revision manual.");
      return decision(LEVELS.UNKNOWN, layerKey, data, null, reasons);
    }
    const thresholds = readThresholds(layerKey, data.lat, data.lon, datasets);
    if (thresholds.matches) {
      reasons.push(`Epicentro contenido en ${thresholds.matches} poligono(s): umbral extraordinario ${formatThreshold(thresholds.extra)} y Escenario 0 ${formatThreshold(thresholds.zero)}.`);
    } else if (thresholds.inCoverage) {
      reasons.push("Epicentro dentro del ambito cartografico y fuera de las curvas de activacion.");
    } else {
      reasons.push("Epicentro fuera del ambito cubierto por la capa; se requiere revision manual.");
    }
    if (data.pga != null && data.pga >= 26.5) {
      reasons.push("PGA >= 26,5 cm/s2.");
      return decision(LEVELS.ZERO, layerKey, data, thresholds, reasons);
    }
    if (data.pga != null && data.pga >= 9.4) {
      reasons.push("PGA >= 9,4 cm/s2.");
      return decision(LEVELS.EXTRA, layerKey, data, thresholds, reasons);
    }
    if (thresholds.zero != null && data.intensity >= thresholds.zero) {
      reasons.push(`Io ${formatNumber(data.intensity)} >= umbral de Escenario 0 ${formatNumber(thresholds.zero)}.`);
      return decision(LEVELS.ZERO, layerKey, data, thresholds, reasons);
    }
    if (thresholds.extra != null && data.intensity >= thresholds.extra) {
      reasons.push(`Io ${formatNumber(data.intensity)} >= umbral extraordinario ${formatNumber(thresholds.extra)}.`);
      return decision(LEVELS.EXTRA, layerKey, data, thresholds, reasons);
    }
    if (!thresholds.inCoverage) return decision(LEVELS.UNKNOWN, layerKey, data, thresholds, reasons);
    reasons.push(`Io ${formatNumber(data.intensity)} queda por debajo de los umbrales de activacion.`);
    return decision(LEVELS.ORDINARY, layerKey, data, thresholds, reasons);
  }

  function evaluateEvent(event, datasets) {
    const { data, reasons } = enrichEvent(event);
    return {
      data,
      layers: {
        casasola: evaluateLayer("casasola", data, datasets, reasons),
        guadalhorce: evaluateLayer("guadalhorce", data, datasets, reasons),
      },
    };
  }

  function decision(level, layerKey, data, thresholds, reasons) {
    return { level, layerKey, data, thresholds, reasons };
  }

  function worstDecision(decisions) {
    if (!decisions?.length) return null;
    return decisions.reduce((worst, item) => SEVERITY[item.level] > SEVERITY[worst.level] ? item : worst, decisions[0]);
  }

  function statusLabel(level) {
    return {
      [LEVELS.ZERO]: "Escenario 0",
      [LEVELS.EXTRA]: "Situacion extraordinaria",
      [LEVELS.ORDINARY]: "Situacion ordinaria",
      [LEVELS.UNKNOWN]: "Revision manual",
    }[level] || "Revision manual";
  }

  function formatThreshold(value) {
    return value == null ? "-" : formatNumber(value);
  }

  function formatNumber(value) {
    return Number(value).toLocaleString("es-ES", { maximumFractionDigits: 2 });
  }

  return {
    LEVELS,
    SEVERITY,
    LAYERS,
    toNumber,
    parseIntensity,
    toMomentMagnitude,
    enrichEvent,
    parseBulletin,
    geometryContainsLonLat,
    readThresholds,
    evaluateLayer,
    evaluateEvent,
    worstDecision,
    statusLabel,
    formatThreshold,
    formatNumber,
  };
});
