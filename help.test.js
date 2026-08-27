const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync("index.html", "utf8");
const app = fs.readFileSync("app.js", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");
const serviceWorker = fs.readFileSync("sw.js", "utf8");

assert.match(html, /id="helpBtn"[^>]+aria-haspopup="dialog"/);
assert.match(html, /<dialog[^>]+id="helpDialog"[^>]+aria-labelledby="helpTitle"/);
assert.match(html, /Inicio rápido/);
assert.match(html, /Qué significa cada estado/);
assert.match(html, /Si aparece «Revisión manual»/);
assert.match(html, /data-asset="limonero"/);
assert.match(html, /Motor raster v5\.1/);
assert.match(app, /function initHelpDialog\(\)/);
assert.match(app, /dialog\.showModal\(\)/);
assert.match(app, /data-help-target/);
assert.match(app, /DecompressionStream\("gzip"\)/);
assert.match(app, /RESERVOIR_RASTER_DATA/);
assert.match(styles, /\.help-dialog::backdrop/);
assert.match(styles, /@media \(max-width: 640px\)[\s\S]+\.help-dialog/);
assert.match(serviceWorker, /alerta-embalses-v15/);
assert.match(serviceWorker, /app\.js\?v=15/);
assert.match(app, /response\.status === 404/);
assert.match(app, /dataUrl\.split\("\/"\)\.pop\(\)/);
assert.match(app, /function reportExtraRasterDataUrl\(layerKey\)/);
assert.match(app, /function extraordinaryRasterColor\(value, minimum, maximum\)/);
assert.match(app, /El sombreado rojo representa la Banda 1 del escenario extraordinario/);

console.log("OK: acceso, contenido, interacción, adaptación móvil y caché del manual verificados.");
