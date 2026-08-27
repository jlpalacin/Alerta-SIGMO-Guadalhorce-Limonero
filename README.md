# Alerta sísmica de embalses

Aplicación móvil/PWA basada en **Crear app móvil de alerta**, ampliada para calcular por separado el estado de:

- Casasola.
- El Conde de Guadalhorce.
- Guadalhorce.
- Guadalteba.
- Limonero.

Los tres embalses del sistema Guadalhorce comparten los mismos mapas raster, por lo que obtienen el mismo estado. Casasola y Limonero se calculan con sus respectivos mapas. La interfaz presenta los cinco embalses individualmente para facilitar la lectura operativa.

La versión 4.2 añade al detalle del evento la trazabilidad completa de la conversión de magnitud, el cálculo de Io y la lectura de los umbrales de ambas capas. Los marcadores sísmicos son más pequeños y conservan su tamaño visual durante el zoom.

## Criterio de cálculo

Para cada sismo:

1. Convierte la magnitud del IGN a `Mw` cuando es necesario.
2. Estima la intensidad epicentral `Io` con la relación de la aplicación original.
3. Transforma las coordenadas WGS84 del epicentro a ETRS89 / UTM zona 30N (`EPSG:25830`).
4. Localiza la celda correspondiente en los GeoTIFF extraordinario y de Escenario 0 de cada embalse.
5. Lee directamente el valor `Float32` de la Banda 1 de cada celda, sin interpolación ni redondeo previo.
6. Calcula, por embalse, `Situación ordinaria`, `Situación extraordinaria`, `Escenario 0` o `Revisión manual`.
7. Si hay varios sismos, adopta para cada embalse el resultado más grave.

También conserva los umbrales directos de PGA de la aplicación original:

- PGA mayor o igual a 9,4 cm/s²: situación extraordinaria.
- PGA mayor o igual a 26,5 cm/s²: Escenario 0.

## Correspondencia de mapas raster

Cada resultado usa dos GeoTIFF independientes:

| Embalse o sistema | Situación extraordinaria | Escenario 0 |
|---|---|---|
| Casasola | `HY8235-CASA-MapaDiscreto(tratado)-Extraord-I0.tif` | `HY8235-CASA-MapaI0Discreto(tratado)-E0-I0.tif` |
| Sistema Guadalhorce | `HY8235-GGHOR-MapaI0Discreto(tratado)-Ex-I0.tif` | `HY8235-GGHOR-MapaI0Discreto(tratado)-E0-I0.tif` |
| Limonero | `HY8235-LMON-MapaDiscreto(tratado)-Extraord-I0.tif` | `HY8235-LMON-MapaDiscreto(tratado)-E0-I0.tif` |

El valor de Banda 1 del primer mapa es el umbral extraordinario y el del segundo es el umbral de Escenario 0. Si alguna celda está fuera del raster o contiene `NoData`, la aplicación solicita revisión manual.

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

Si el móvil tenía instalada una versión anterior, abre una vez la dirección de GitHub Pages añadiendo `?v=17`. La versión actual mostrará `Motor raster v5.3` y, desde entonces, las navegaciones usarán red primero para comprobar actualizaciones.

La versión 4.3 selecciona inicialmente el evento con la mayor intensidad Io disponible. Desde el detalle puede generarse un informe completo del evento seleccionado y abrirse para imprimirlo o guardarlo como PDF.

La versión 4.4 mantiene constante en pantalla el grosor de las isoyetas al ampliar el mapa. El informe desarrolla los cálculos de Io, los umbrales de los escenarios y la distancia epicentral Haversine a cada presa. También incorpora como comprobación complementaria la tabla ICOLD (2016): magnitud >4, >5, >6, >7 y >8 con radios de 25, 50, 80, 125 y 200 km, respectivamente.

La versión 4.5 separa correctamente la intensidad máxima observada (`Imax`) de la intensidad epicentral calculada (`Io`). Cuando el IGN informa una magnitud `Mw`, se usa directamente como Mw y se aplica `Io = (Mw − 1,656) / 0,545`; `Imax` queda como dato independiente. El informe incorpora además los mapas de Casasola y del Sistema Guadalhorce con el epicentro señalado.

La versión 4.6 aplica las relaciones por tramos facilitadas para convertir `mbLg(L)` y `mb` a `Mw`, mostrando en la web y en el informe el tramo, la fórmula y la sustitución numérica. Para magnitudes altas sin `Mw` oficial se emplea el tramo cuadrático basado en Rueda (2009), con las constantes ajustadas por continuidad indicadas en dichas relaciones. Al situar el ratón sobre un evento del mapa se muestran su `Io` calculada y las intensidades extraordinaria y de Escenario 0 de ambas capas.

La versión 4.7 elimina la consideración fija de 50 km y utiliza exclusivamente los radios de acción ICOLD dependientes de la magnitud. Los epicentros del mapa son botones seleccionables; al pulsarlos se actualizan el evento activo, su detalle y el informe que se genere.

La versión 4.8 incorpora en los dos mapas del informe la ortofoto oficial PNOA de máxima actualidad suministrada mediante el servicio WMS del IGN-CNIG. Las isoyetas y el epicentro se dibujan sobre la ortofoto y se mantiene el mapa anterior como respaldo si el servicio externo no estuviera disponible.

La versión 4.9 incorpora un manual de usuario dentro de la aplicación. El botón `Ayuda` de la navegación abre una guía adaptada a móvil con el flujo de trabajo, la interpretación de los cuatro estados, el uso del mapa y del informe, y las comprobaciones recomendadas cuando se solicita una revisión manual.

La versión 5.0 sustituye las capas poligonales anteriores por seis mapas GeoTIFF. Los umbrales se obtienen leyendo la Banda 1 de la celda correspondiente a las coordenadas del sismo. También incorpora Limonero al resumen, la tabla, el mapa, el detalle y el informe.

La versión 5.0.1 admite tanto la estructura recomendada `assets/rasters/` como los archivos raster e isolíneas colocados en la raíz por el cargador web de GitHub. Los datos descargados durante el primer uso quedan disponibles en la caché de la PWA.

La versión 5.1 añade a los tres mapas del informe el sombreado de la Banda 1 del escenario extraordinario sobre la ortofoto. El rojo cambia de claro a oscuro según el condicionamiento del mapa; las isolíneas y el epicentro permanecen visibles por encima. Esta representación es únicamente informativa y no modifica los cálculos.

La versión 5.2 genera por separado, mediante GDAL, una imagen georreferenciada para cada TIF extraordinario: Casasola, Sistema Guadalhorce y Limonero. El informe carga la imagen correspondiente a cada embalse y conserva la reconstrucción en el navegador únicamente como respaldo.

La versión 5.3 elimina del informe el antiguo fondo `map-base.jpg` y el intento de cargar PNOA. Los tres mapas del informe utilizan las mismas teselas de imagen satélite de Google que el mapa interactivo, manteniendo por encima el sombreado extraordinario, las isolíneas y el epicentro.

## Archivos de datos

`raster-intensity-data.js` contiene los metadatos de los seis GeoTIFF y `assets/rasters/` contiene sus Bandas 1 comprimidas sin pérdida como matrices `Float32`, además de las isolíneas transformadas a WGS84 para visualización.

Los datos se regeneran desde los GeoTIFF e isolíneas originales mediante:

```powershell
& 'C:\Program Files\QGIS 3.38.2\bin\python-qgis.bat' .\tools\build-raster-data.py
```

Las isolíneas solo se emplean para dibujar el mapa. Las decisiones se calculan exclusivamente con la Banda 1 de los GeoTIFF.

La aplicación es una ayuda a la decisión. No sustituye el Plan de Emergencia, las comunicaciones oficiales ni la evaluación de personal técnico competente.
