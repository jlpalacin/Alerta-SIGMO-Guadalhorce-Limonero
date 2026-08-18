# Alerta sísmica de embalses

Aplicación móvil/PWA basada en **Crear app móvil de alerta**, ampliada para calcular por separado el estado de:

- Casasola.
- El Conde de Guadalhorce.
- Guadalhorce.
- Guadalteba.

Los tres embalses del sistema Guadalhorce comparten la misma capa técnica, por lo que obtienen el mismo estado. La interfaz los presenta individualmente para facilitar la lectura operativa.

La versión 4.2 añade al detalle del evento la trazabilidad completa de la conversión de magnitud, el cálculo de Io y la lectura de los umbrales de ambas capas. Los marcadores sísmicos son más pequeños y conservan su tamaño visual durante el zoom.

## Criterio de cálculo

Para cada sismo:

1. Convierte la magnitud del IGN a `Mw` cuando es necesario.
2. Estima la intensidad epicentral `Io` con la relación de la aplicación original.
3. Localiza el epicentro dentro de cada GeoPackage convertido a GeoJSON.
4. Lee el menor umbral de los polígonos que contienen el punto (criterio conservador).
5. Calcula, por capa, `Situación ordinaria`, `Situación extraordinaria`, `Escenario 0` o `Revisión manual`.
6. Si hay varios sismos, adopta para cada embalse el resultado más grave.

También conserva los umbrales directos de PGA de la aplicación original:

- PGA mayor o igual a 9,4 cm/s²: situación extraordinaria.
- PGA mayor o igual a 26,5 cm/s²: Escenario 0.

## Correspondencia de campos

Las dos capas corregidas emplean la misma correspondencia:

| Capa | Situación extraordinaria | Escenario 0 |
|---|---|---|
| Casasola | `IntensidadExtraordinaria` | `Intensidad` |
| Sistema Guadalhorce | `IntensidadExtraordinaria` | `Intensidad` |

La capa Guadalhorce incorporada es la versión corregida del 17/08/2026, con la jerarquía de intensidades ya normalizada.

## Abrir en Windows

Haz doble clic en `Abrir_Alerta_Embalses.bat`, o ejecuta:

```powershell
powershell -ExecutionPolicy Bypass -File .\serve.ps1
```

La consola mostrará la URL del ordenador y las URLs para un móvil conectado a la misma Wi-Fi.

## Publicar en GitHub Pages

1. Sube todo el contenido de esta carpeta, incluida `.github/workflows/update-ign.yml`.
2. En `Settings > Actions > General`, activa `Read and write permissions`.
3. En `Actions`, ejecuta una vez `Actualizar listado IGN`.
4. Activa GitHub Pages para la rama publicada.

El workflow actualiza `ign-terremotos.html` cada 15 minutos. El service worker no guarda ese fichero de forma persistente.

Si el móvil tenía instalada una versión anterior, abre una vez la dirección de GitHub Pages añadiendo `?v=8`. La versión actual mostrará `Motor conservador v4.5` y, desde entonces, las navegaciones usarán red primero para comprobar actualizaciones.

La versión 4.3 selecciona inicialmente el evento con la mayor intensidad Io disponible. Desde el detalle puede generarse un informe completo del evento seleccionado y abrirse para imprimirlo o guardarlo como PDF.

La versión 4.4 mantiene constante en pantalla el grosor de las isoyetas al ampliar el mapa. El informe desarrolla los cálculos de Io, los umbrales de los escenarios y la distancia epicentral Haversine a cada presa. También incorpora como comprobación complementaria la tabla ICOLD (2016): magnitud >4, >5, >6, >7 y >8 con radios de 25, 50, 80, 125 y 200 km, respectivamente, y la nota de exclusión de situación extraordinaria más allá de 50 km facilitada por el usuario.

La versión 4.5 separa correctamente la intensidad máxima observada (`Imax`) de la intensidad epicentral calculada (`Io`). Cuando el IGN informa una magnitud `Mw`, se usa directamente como Mw y se aplica `Io = (Mw − 1,656) / 0,545`; `Imax` queda como dato independiente. El informe incorpora además los mapas de Casasola y del Sistema Guadalhorce con el epicentro señalado.

## Archivos de datos

`reservoir-vector-data.js` se ha generado directamente a partir de:

- `CasasolaIntensidadGeoJson_modified.gpkg` (17 entidades).
- `GuadalhorceIntensidadGeoJson_modified.gpkg` (16 entidades).

La aplicación es una ayuda a la decisión. No sustituye el Plan de Emergencia, las comunicaciones oficiales ni la evaluación de personal técnico competente.
