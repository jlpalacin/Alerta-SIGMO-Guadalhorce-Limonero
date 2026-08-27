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
assert.match(app, /function initHelpDialog\(\)/);
assert.match(app, /dialog\.showModal\(\)/);
assert.match(app, /data-help-target/);
assert.match(styles, /\.help-dialog::backdrop/);
assert.match(styles, /@media \(max-width: 640px\)[\s\S]+\.help-dialog/);
assert.match(serviceWorker, /alerta-embalses-v12/);
assert.match(serviceWorker, /app\.js\?v=12/);

console.log("OK: acceso, contenido, interacción, adaptación móvil y caché del manual verificados.");
