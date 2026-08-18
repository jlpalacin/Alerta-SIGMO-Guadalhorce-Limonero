const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const Core = require("../core.js");

const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(require.resolve("../reservoir-vector-data.js"), "utf8"), sandbox);
const datasets = sandbox.window.RESERVOIR_VECTOR_DATA;

assert.equal(datasets.casasola.features.length, 17, "Casasola debe conservar 17 polígonos");
assert.equal(datasets.guadalhorce.features.length, 16, "Guadalhorce debe conservar 16 polígonos");

const casasola = Core.readThresholds("casasola", 36.8068, -4.4922056, datasets);
assert.equal(casasola.extra, 4);
assert.equal(casasola.zero, 5.5);
assert.ok(casasola.matches >= 1);

const guadalhorce = Core.readThresholds("guadalhorce", 36.9735, -4.7953, datasets);
assert.equal(guadalhorce.extra, 4);
assert.equal(guadalhorce.zero, 5.5);
assert.ok(guadalhorce.matches >= 1);

const ordinary = Core.evaluateEvent({ lat: 36.8068, lon: -4.4922056, intensity: 3.5 }, datasets);
assert.equal(ordinary.layers.casasola.level, Core.LEVELS.ORDINARY);

const extra = Core.evaluateEvent({ lat: 36.8068, lon: -4.4922056, intensity: 4.5 }, datasets);
assert.equal(extra.layers.casasola.level, Core.LEVELS.EXTRA);

const zero = Core.evaluateEvent({ lat: 36.8068, lon: -4.4922056, intensity: 6 }, datasets);
assert.equal(zero.layers.casasola.level, Core.LEVELS.ZERO);

const independent = Core.evaluateEvent({ lat: 36.8068, lon: -4.4922056, intensity: 5.7 }, datasets);
assert.equal(independent.layers.casasola.level, Core.LEVELS.ZERO);
assert.equal(independent.layers.guadalhorce.level, Core.LEVELS.EXTRA);

const pga = Core.evaluateEvent({ lat: 36.8068, lon: -4.4922056, pga: 27 }, datasets);
assert.equal(pga.layers.casasola.level, Core.LEVELS.ZERO);
assert.equal(pga.layers.guadalhorce.level, Core.LEVELS.ZERO);

const conversion = Core.toMomentMagnitude(4.3, "mbLg");
assert.ok(Math.abs(conversion.mw - 4.2708) < 1e-9);

const calculatedIntensity = Core.evaluateEvent({ lat: 36.8068, lon: -4.4922056, magnitude: 4.3, magnitudeType: "mbLg" }, datasets);
assert.equal(calculatedIntensity.data.intensitySource, "estimated");
assert.equal(calculatedIntensity.data.intensityFormula, "Io = (Mw - 1,656) / 0,545");
assert.match(calculatedIntensity.data.intensityCalculation, /Io =/);

const reportedIntensity = Core.evaluateEvent({ lat: 36.8068, lon: -4.4922056, intensity: 5.7 }, datasets);
assert.equal(reportedIntensity.data.intensitySource, "reported");

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

console.log("OK: capas, umbrales, jerarquía, PGA, conversión, selección por Io y parser verificados.");
