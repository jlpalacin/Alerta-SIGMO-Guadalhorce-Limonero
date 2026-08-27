const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const zlib = require("node:zlib");
const Core = require("../core.js");

const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(require.resolve("../raster-intensity-data.js"), "utf8"), sandbox);
const datasets = sandbox.window.RESERVOIR_RASTER_DATA;
for (const layer of Object.values(datasets)) {
  for (const scenario of ["extra", "zero"]) {
    const raster = layer[scenario];
    const compressed = fs.readFileSync(path.resolve(__dirname, "..", raster.dataUrl));
    assert.equal(crypto.createHash("sha256").update(compressed).digest("hex"), raster.sha256);
    const raw = zlib.gunzipSync(compressed);
    const bytes = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
    raster.values = new Float32Array(bytes);
    if (scenario === "extra") {
      const reportImage = fs.readFileSync(path.resolve(__dirname, "..", raster.reportImageUrl));
      assert.equal(crypto.createHash("sha256").update(reportImage).digest("hex"), raster.reportImageSha256);
    }
  }
}

assert.equal(new Set(Object.values(datasets).map((layer) => layer.extra.reportImageUrl)).size, 3);

assert.equal(datasets.casasola.zero.width, 890);
assert.equal(datasets.guadalhorce.extra.height, 1242);
assert.equal(datasets.limonero.zero.width, 864);

const casasolaUtm = Core.wgs84ToUtm30(36.8016, -4.4945);
assert.ok(Math.abs(casasolaUtm.x - 366676.266237426) < 0.02);
assert.ok(Math.abs(casasolaUtm.y - 4073905.34154538) < 0.02);

const casasola = Core.readThresholds("casasola", 36.8068, -4.4922056, datasets);
assert.ok(Math.abs(casasola.extra - 3.70673441886902) < 1e-6);
assert.ok(Math.abs(casasola.zero - 5.25486755371094) < 1e-6);
assert.equal(casasola.matches, 2);
assert.equal(casasola.inCoverage, true);

const casasolaDam = Core.readThresholds("casasola", 36.8016, -4.4945, datasets);
assert.ok(Math.abs(casasolaDam.extra - 3.73248791694641) < 1e-6);
assert.ok(Math.abs(casasolaDam.zero - 5.15604543685913) < 1e-6);
assert.equal(casasolaDam.samples.zero.column, 584);
assert.equal(casasolaDam.samples.zero.row, 377);

const guadalhorce = Core.readThresholds("guadalhorce", 36.9735, -4.7953, datasets);
assert.ok(Math.abs(guadalhorce.extra - 3.69797801971436) < 1e-6);
assert.ok(Math.abs(guadalhorce.zero - 5.17303514480591) < 1e-6);

const limonero = Core.readThresholds("limonero", 36.765, -4.438, datasets);
assert.ok(Math.abs(limonero.extra - 3.70267152786255) < 1e-6);
assert.equal(limonero.zero, 5.5);

const ordinary = Core.evaluateEvent({ lat: 36.8068, lon: -4.4922056, intensity: 3.5 }, datasets);
assert.equal(ordinary.layers.casasola.level, Core.LEVELS.ORDINARY);

const extra = Core.evaluateEvent({ lat: 36.8068, lon: -4.4922056, intensity: 4 }, datasets);
assert.equal(extra.layers.casasola.level, Core.LEVELS.EXTRA);

const zero = Core.evaluateEvent({ lat: 36.8068, lon: -4.4922056, intensity: 5.3 }, datasets);
assert.equal(zero.layers.casasola.level, Core.LEVELS.ZERO);

const independent = Core.evaluateEvent({ lat: 36.8016, lon: -4.4945, intensity: 5 }, datasets);
assert.equal(independent.layers.casasola.level, Core.LEVELS.EXTRA);
assert.equal(independent.layers.guadalhorce.level, Core.LEVELS.ORDINARY);
assert.equal(independent.layers.limonero.level, Core.LEVELS.EXTRA);

const pga = Core.evaluateEvent({ lat: 36.8068, lon: -4.4922056, pga: 27 }, datasets);
assert.equal(pga.layers.casasola.level, Core.LEVELS.ZERO);
assert.equal(pga.layers.guadalhorce.level, Core.LEVELS.ZERO);
assert.equal(pga.layers.limonero.level, Core.LEVELS.ZERO);

const conversion = Core.toMomentMagnitude(4.3, "mbLg");
assert.ok(Math.abs(conversion.mw - 4.2708) < 1e-9);
assert.equal(conversion.formula, "Mw = 0,836·mbLg + 0,676");
assert.ok(Math.abs(Core.toMomentMagnitude(2.5, "mbLg(L)").mw - 2.684) < 1e-9);
const highMbLg = Core.toMomentMagnitude(6.9, "mbLg");
assert.ok(Math.abs(highMbLg.mw - (0.17 * 6.9 ** 2 - 0.87 * 6.9 + 4.416)) < 1e-9);
assert.equal(highMbLg.usesRuedaQuadratic, true);
assert.ok(Math.abs(Core.toMomentMagnitude(3, "mb").mw - 2.2601) < 1e-9);
assert.ok(Math.abs(Core.toMomentMagnitude(5, "mb").mw - 4.537) < 1e-9);
const highMb = Core.toMomentMagnitude(7, "M(mb)");
assert.ok(Math.abs(highMb.mw - (0.17 * 7 ** 2 - 0.87 * 7 + 4.7968)) < 1e-9);
assert.equal(highMb.usesRuedaQuadratic, true);
assert.ok(Math.abs(Core.toMomentMagnitude(3, "mbLg").mw - Core.toMomentMagnitude(2.999999999, "mbLg").mw) < 1e-6);
assert.ok(Math.abs(Core.toMomentMagnitude(3.7, "mb").mw - Core.toMomentMagnitude(3.699999999, "mb").mw) < 1e-6);

const calculatedIntensity = Core.evaluateEvent({ lat: 36.8068, lon: -4.4922056, magnitude: 4.3, magnitudeType: "mbLg" }, datasets);
assert.equal(calculatedIntensity.data.intensitySource, "estimated");
assert.equal(calculatedIntensity.data.intensityFormula, "Io = (Mw - 1,656) / 0,545");
assert.match(calculatedIntensity.data.intensityCalculation, /Io =/);

const reportedIntensity = Core.evaluateEvent({ lat: 36.8068, lon: -4.4922056, intensity: 5.7 }, datasets);
assert.equal(reportedIntensity.data.intensitySource, "reported");

const mwWithMaximumIntensity = Core.evaluateEvent({ lat: 36.8068, lon: -4.4922056, magnitude: 5, magnitudeType: "Mw", maxIntensity: 5, maxIntensityText: "V" }, datasets);
assert.equal(mwWithMaximumIntensity.data.intensitySource, "estimated");
assert.equal(mwWithMaximumIntensity.data.mw, 5);
assert.ok(Math.abs(mwWithMaximumIntensity.data.intensity - ((5 - 1.656) / 0.545)) < 1e-9);
assert.equal(mwWithMaximumIntensity.data.maxIntensity, 5);

const parsedMwBulletin = Core.parseBulletin("Magnitud Mw: 5\nIntensidad máxima: V");
assert.equal(parsedMwBulletin.magnitudeType, "Mw");
assert.equal(parsedMwBulletin.magnitude, 5);
assert.equal(parsedMwBulletin.intensity, null);
assert.equal(parsedMwBulletin.maxIntensity, 5);

const highestIntensity = Core.highestIntensityResult([
  { data: { event: "reciente", intensity: 3.11 } },
  { data: { event: "maximo", intensity: 5.87 } },
  { data: { event: "intermedio", intensity: 4.49 } },
]);
assert.equal(highestIntensity.data.event, "maximo");
assert.equal(Core.highestIntensityResult([{ data: { intensity: null } }]), null);

const bulletin = Core.parseBulletin("Latitud: 36.8 grados norte\nLongitud: 4.5 grados oeste\nMagnitud mbLg: 4.3");
assert.equal(bulletin.lat, 36.8);
assert.equal(bulletin.lon, -4.5);
assert.equal(bulletin.magnitudeType, "mbLg");
assert.equal(Core.parseIntensity("VI"), 6);

assert.ok(Math.abs(Core.haversineDistanceKm(36.8016, -4.4945, 36.8016, -4.4945)) < 1e-9);
assert.ok(Math.abs(Core.haversineDistanceKm(36, -4, 37, -4) - 111.195) < 0.01);
assert.equal(Core.icoldActionRadiusKm(4), null);
assert.equal(Core.icoldActionRadiusKm(4.1), 25);
assert.equal(Core.icoldActionRadiusKm(5), 25);
assert.equal(Core.icoldActionRadiusKm(5.1), 50);
assert.equal(Core.icoldActionRadiusKm(8.1), 200);

console.log("OK: Bandas 1 raster, proyección UTM, umbrales, Limonero, jerarquía, PGA, conversión, distancia ICOLD, selección por Io y parser verificados.");
