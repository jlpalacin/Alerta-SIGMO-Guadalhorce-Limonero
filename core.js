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

  const EARTH_RADIUS_KM = 6371.0088;
  const ICOLD_ACTION_RADII = Object.freeze([
    Object.freeze({ magnitudeAbove: 8, distanceKm: 200 }),
    Object.freeze({ magnitudeAbove: 7, distanceKm: 125 }),
    Object.freeze({ magnitudeAbove: 6, distanceKm: 80 }),
    Object.freeze({ magnitudeAbove: 5, distanceKm: 50 }),
    Object.freeze({ magnitudeAbove: 4, distanceKm: 25 }),
  ]);

  const LAYERS = Object.freeze({
    casasola: {
      key: "casasola",
      label: "Casasola",
    },
    guadalhorce: {
      key: "guadalhorce",
      label: "Sistema Guadalhorce",
    },
    limonero: {
      key: "limonero",
      label: "Limonero",
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

  function haversineDistanceKm(lat1, lon1, lat2, lon2) {
    const values = [lat1, lon1, lat2, lon2].map(toNumber);
    if (values.some((value) => value == null)) return null;
    const [startLat, startLon, endLat, endLon] = values.map((value) => value * Math.PI / 180);
    const deltaLat = endLat - startLat;
    const deltaLon = endLon - startLon;
    const a = Math.sin(deltaLat / 2) ** 2
      + Math.cos(startLat) * Math.cos(endLat) * Math.sin(deltaLon / 2) ** 2;
    return 2 * EARTH_RADIUS_KM * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
  }

  function icoldActionRadiusKm(magnitude) {
    const numericMagnitude = toNumber(magnitude);
    if (numericMagnitude == null) return null;
    return ICOLD_ACTION_RADII.find((row) => numericMagnitude > row.magnitudeAbove)?.distanceKm ?? null;
  }

  function normalizeMagnitudeType(type = "") {
    return String(type).trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  function toMomentMagnitude(magnitude, type = "") {
    if (!Number.isFinite(magnitude)) return null;
    const key = normalizeMagnitudeType(type);
    const direct = {
      mw: magnitude,
      method: "magnitud oficial ya expresada como Mw; no se aplica conversión",
      formula: "Mw = M",
      substitution: `Mw = ${formatNumber(magnitude)}`,
      range: "Tipo de magnitud Mw",
      usesRuedaQuadratic: false,
    };
    const mbLg = magnitude < 3 ? {
      mw: magnitude + 0.184,
      method: "conversión mbLg(L) → Mw, tramo inferior",
      formula: "Mw = mbLg + 0,184",
      substitution: `Mw = ${formatNumber(magnitude)} + 0,184 = ${formatNumber(magnitude + 0.184)}`,
      range: "mbLg < 3",
      usesRuedaQuadratic: false,
    } : magnitude <= 6.8 ? {
      mw: 0.836 * magnitude + 0.676,
      method: "conversión mbLg(L) → Mw, tramo lineal",
      formula: "Mw = 0,836·mbLg + 0,676",
      substitution: `Mw = 0,836·${formatNumber(magnitude)} + 0,676 = ${formatNumber(0.836 * magnitude + 0.676)}`,
      range: "3 ≤ mbLg ≤ 6,8",
      usesRuedaQuadratic: false,
    } : {
      mw: 0.17 * magnitude ** 2 - 0.87 * magnitude + 4.416,
      method: "conversión mbLg(L) → Mw, tramo cuadrático superior basado en Rueda (2009) y ajustado por continuidad",
      formula: "Mw = 0,17·mbLg² − 0,87·mbLg + 4,416",
      substitution: `Mw = 0,17·${formatNumber(magnitude)}² − 0,87·${formatNumber(magnitude)} + 4,416 = ${formatNumber(0.17 * magnitude ** 2 - 0.87 * magnitude + 4.416)}`,
      range: "mbLg > 6,8",
      usesRuedaQuadratic: true,
    };
    const mb = magnitude < 3.7 ? {
      mw: magnitude - 0.7399,
      method: "conversión mb → Mw, tramo inferior",
      formula: "Mw = mb − 0,7399",
      substitution: `Mw = ${formatNumber(magnitude)} − 0,7399 = ${formatNumber(magnitude - 0.7399)}`,
      range: "mb < 3,7",
      usesRuedaQuadratic: false,
    } : magnitude <= 6.7 ? {
      mw: 1.213 * magnitude - 1.528,
      method: "conversión mb → Mw, tramo lineal",
      formula: "Mw = 1,213·mb − 1,528",
      substitution: `Mw = 1,213·${formatNumber(magnitude)} − 1,528 = ${formatNumber(1.213 * magnitude - 1.528)}`,
      range: "3,7 ≤ mb ≤ 6,7",
      usesRuedaQuadratic: false,
    } : {
      mw: 0.17 * magnitude ** 2 - 0.87 * magnitude + 4.7968,
      method: "conversión mb → Mw, tramo cuadrático superior basado en Rueda (2009) y ajustado por continuidad",
      formula: "Mw = 0,17·mb² − 0,87·mb + 4,7968",
      substitution: `Mw = 0,17·${formatNumber(magnitude)}² − 0,87·${formatNumber(magnitude)} + 4,7968 = ${formatNumber(0.17 * magnitude ** 2 - 0.87 * magnitude + 4.7968)}`,
      range: "mb > 6,7",
      usesRuedaQuadratic: true,
    };
    if (["mw", "mww", "mwc", "mwr", "mwp", "m"].includes(key)) {
      return direct;
    }
    if (key.includes("mblg") || key === "mlg") {
      return mbLg;
    }
    if (key === "mb" || key.includes("mb")) {
      return mb;
    }
    const chosen = [direct, mbLg, mb].reduce((highest, candidate) => candidate.mw > highest.mw ? candidate : highest, direct);
    return { ...chosen, method: `tipo ${type || "desconocido"}; se adopta conservadoramente la mayor estimación: ${chosen.method}` };
  }

  function enrichEvent(event) {
    const data = { ...event };
    data.lat = toNumber(data.lat);
    data.lon = toNumber(data.lon);
    data.depthKm = toNumber(data.depthKm);
    data.magnitude = toNumber(data.magnitude);
    data.intensity = toNumber(data.intensity);
    data.maxIntensity = toNumber(data.maxIntensity);
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
      data.magnitudeFormula = conversion?.formula ?? "";
      data.magnitudeSubstitution = conversion?.substitution ?? "";
      data.magnitudeRange = conversion?.range ?? "";
      data.usesRuedaQuadratic = Boolean(conversion?.usesRuedaQuadratic);
      if (data.mw != null) {
        data.intensity = (data.mw - 1.656) / 0.545;
        data.intensitySource = "estimated";
        data.intensityFormula = "Io = (Mw - 1,656) / 0,545";
        data.intensityCalculation = `Io = (${formatNumber(data.mw)} - 1,656) / 0,545 = ${formatNumber(data.intensity)}.`;
        reasons.push(`Mw ${formatNumber(data.mw)} e Io ${formatNumber(data.intensity)} calculadas desde ${data.magnitudeType || "magnitud"} ${formatNumber(data.magnitude)}.`);
      }
    }
    if (data.intensity == null && data.maxIntensity != null) {
      data.intensity = data.maxIntensity;
      data.intensitySource = "reported-max";
      data.intensityCalculation = `Sin magnitud disponible: Imax ${formatNumber(data.maxIntensity)} se usa como aproximacion conservadora de Io.`;
      reasons.push(`No hay magnitud para calcular Io; se usa Imax ${formatNumber(data.maxIntensity)} como aproximacion conservadora.`);
    }
    if (data.maxIntensity != null && data.intensitySource === "estimated") {
      reasons.push(`Imax ${formatNumber(data.maxIntensity)} se conserva como observacion separada y no se confunde con Io.`);
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
    const explicitIntensityText = pick(/(?:Intensidad\s+(?:epicentral(?:\s*(?:Io|I0))?|Io|I0)|\b(?:Io|I0)\b)[^0-9IVX]*([0-9]+(?:[,.][0-9]+)?|XII|XI|IX|VIII|VII|VI|IV|X|V)/i);
    const genericIntensityText = pick(/(?:Intensidad|Int\.)\s*(?:m[aá]x(?:ima)?\.?|max(?:ima)?\.?|EMS)?[^0-9IVX]*([0-9]+(?:[,.][0-9]+)?|XII|XI|IX|VIII|VII|VI|IV|X|V)/i);
    const maxIntensityText = explicitIntensityText ? pick(/(?:Intensidad|Int\.)\s*(?:m[aá]x(?:ima)?\.?|max(?:ima)?\.?)[^0-9IVX]*([0-9]+(?:[,.][0-9]+)?|XII|XI|IX|VIII|VII|VI|IV|X|V)/i) : genericIntensityText;
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
      intensity: explicitIntensityText ? parseIntensity(explicitIntensityText) : null,
      maxIntensity: maxIntensityText ? parseIntensity(maxIntensityText) : null,
      maxIntensityText,
      pga: toNumber(pick(/\bPGA\b[^0-9]*([0-9]+(?:[,.][0-9]+)?)/i)),
    };
  }

  function wgs84ToUtm30(lat, lon) {
    const numericLat = toNumber(lat);
    const numericLon = toNumber(lon);
    if (numericLat == null || numericLon == null) return null;
    const semiMajor = 6378137;
    const flattening = 1 / 298.257222101;
    const scale = 0.9996;
    const eccentricitySquared = flattening * (2 - flattening);
    const secondEccentricitySquared = eccentricitySquared / (1 - eccentricitySquared);
    const latitude = numericLat * Math.PI / 180;
    const longitude = numericLon * Math.PI / 180;
    const centralMeridian = -3 * Math.PI / 180;
    const sinLatitude = Math.sin(latitude);
    const cosLatitude = Math.cos(latitude);
    const tanLatitude = Math.tan(latitude);
    const radius = semiMajor / Math.sqrt(1 - eccentricitySquared * sinLatitude ** 2);
    const tangent = tanLatitude ** 2;
    const curvature = secondEccentricitySquared * cosLatitude ** 2;
    const longitudeArc = cosLatitude * (longitude - centralMeridian);
    const meridian = semiMajor * (
      (1 - eccentricitySquared / 4 - 3 * eccentricitySquared ** 2 / 64 - 5 * eccentricitySquared ** 3 / 256) * latitude
      - (3 * eccentricitySquared / 8 + 3 * eccentricitySquared ** 2 / 32 + 45 * eccentricitySquared ** 3 / 1024) * Math.sin(2 * latitude)
      + (15 * eccentricitySquared ** 2 / 256 + 45 * eccentricitySquared ** 3 / 1024) * Math.sin(4 * latitude)
      - (35 * eccentricitySquared ** 3 / 3072) * Math.sin(6 * latitude)
    );
    const easting = 500000 + scale * radius * (
      longitudeArc
      + (1 - tangent + curvature) * longitudeArc ** 3 / 6
      + (5 - 18 * tangent + tangent ** 2 + 72 * curvature - 58 * secondEccentricitySquared) * longitudeArc ** 5 / 120
    );
    const northing = scale * (
      meridian
      + radius * tanLatitude * (
        longitudeArc ** 2 / 2
        + (5 - tangent + 9 * curvature + 4 * curvature ** 2) * longitudeArc ** 4 / 24
        + (61 - 58 * tangent + tangent ** 2 + 600 * curvature - 330 * secondEccentricitySquared) * longitudeArc ** 6 / 720
      )
    );
    return { x: easting, y: northing };
  }

  function readRasterBandValue(raster, lat, lon) {
    const projected = wgs84ToUtm30(lat, lon);
    const transform = raster?.geoTransform;
    if (!projected || !raster?.values || !Array.isArray(transform) || transform.length !== 6) {
      return { value: null, row: null, column: null, inBounds: false, loaded: Boolean(raster?.values) };
    }
    const determinant = transform[1] * transform[5] - transform[2] * transform[4];
    if (!Number.isFinite(determinant) || determinant === 0) {
      return { value: null, row: null, column: null, inBounds: false, loaded: true };
    }
    const deltaX = projected.x - transform[0];
    const deltaY = projected.y - transform[3];
    const column = Math.floor((transform[5] * deltaX - transform[2] * deltaY) / determinant);
    const row = Math.floor((-transform[4] * deltaX + transform[1] * deltaY) / determinant);
    const inBounds = column >= 0 && column < raster.width && row >= 0 && row < raster.height;
    if (!inBounds) return { value: null, row, column, inBounds: false, loaded: true, ...projected };
    const value = raster.values[row * raster.width + column];
    const noData = raster.noData;
    const isNoData = !Number.isFinite(value)
      || Math.abs(value) >= 3.4e38
      || (noData != null && value === Math.fround(noData));
    return { value: isNoData ? null : value, row, column, inBounds: true, loaded: true, ...projected };
  }

  function readThresholds(layerKey, lat, lon, datasets) {
    const layer = datasets?.[layerKey];
    if (!LAYERS[layerKey] || !layer) return { extra: null, zero: null, matches: 0, inCoverage: false, samples: null };
    const extraSample = readRasterBandValue(layer.extra, lat, lon);
    const zeroSample = readRasterBandValue(layer.zero, lat, lon);
    const matches = Number(extraSample.value != null) + Number(zeroSample.value != null);
    return {
      extra: extraSample.value,
      zero: zeroSample.value,
      matches,
      inCoverage: matches === 2,
      samples: { extra: extraSample, zero: zeroSample },
      source: "band-1",
    };
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
    if (thresholds.inCoverage) {
      reasons.push(`Banda 1 consultada en la celda del epicentro: umbral extraordinario ${formatThreshold(thresholds.extra)} y Escenario 0 ${formatThreshold(thresholds.zero)}.`);
    } else if (thresholds.matches) {
      reasons.push("Una de las dos Bandas 1 no contiene un valor valido en el epicentro; se requiere revision manual.");
    } else {
      reasons.push("Epicentro fuera del ambito raster o sobre una celda NoData; se requiere revision manual.");
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
        limonero: evaluateLayer("limonero", data, datasets, reasons),
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

  function highestIntensityResult(results) {
    let best = null;
    let highest = -Infinity;
    for (const result of results || []) {
      const rawIntensity = result?.data?.intensity;
      if (rawIntensity == null || rawIntensity === "") continue;
      const intensity = Number(rawIntensity);
      if (Number.isFinite(intensity) && intensity > highest) {
        best = result;
        highest = intensity;
      }
    }
    return best;
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
    EARTH_RADIUS_KM,
    ICOLD_ACTION_RADII,
    LAYERS,
    toNumber,
    parseIntensity,
    haversineDistanceKm,
    icoldActionRadiusKm,
    toMomentMagnitude,
    enrichEvent,
    parseBulletin,
    wgs84ToUtm30,
    readRasterBandValue,
    readThresholds,
    evaluateLayer,
    evaluateEvent,
    worstDecision,
    highestIntensityResult,
    statusLabel,
    formatThreshold,
    formatNumber,
  };
});
