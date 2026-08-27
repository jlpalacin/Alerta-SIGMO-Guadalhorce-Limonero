import argparse
import gzip
import hashlib
import json
from pathlib import Path

import numpy as np
from osgeo import gdal


RASTERS = {
    "casasola": {
        "label": "Casasola",
        "zero": "CASASOLA/ESCENARIO_0/HY8235-CASA-MapaI0Discreto(tratado)-E0-I0.tif",
        "extra": "CASASOLA/EXTRAORDINARIO/HY8235-CASA-MapaDiscreto(tratado)-Extraord-I0.tif",
    },
    "guadalhorce": {
        "label": "Sistema Guadalhorce",
        "zero": "GUADALHORCE-GUADALTEBA-CONDE/ESCENARIO_0/HY8235-GGHOR-MapaI0Discreto(tratado)-E0-I0.tif",
        "extra": "GUADALHORCE-GUADALTEBA-CONDE/EXTRAORDINARIO/HY8235-GGHOR-MapaI0Discreto(tratado)-Ex-I0.tif",
    },
    "limonero": {
        "label": "Limonero",
        "zero": "LIMONERO/ESCENARIO_0/HY8235-LMON-MapaDiscreto(tratado)-E0-I0.tif",
        "extra": "LIMONERO/EXTRAORDINARIO/HY8235-LMON-MapaDiscreto(tratado)-Extraord-I0.tif",
    },
}

ISOLINES = {
    "casasola": "CASASOLA/EXTRAORDINARIO/Isolineas Casasola.geojson",
    "guadalhorce": "GUADALHORCE-GUADALTEBA-CONDE/EXTRAORDINARIO/Isolineas Guadalhorce.geojson",
    "limonero": "LIMONERO/EXTRAORDINARIO/Isolineas Limonero.geojson",
}

REPORT_BOUNDS = (-15, 31, 1, 42)
REPORT_WIDTH = 1600
REPORT_HEIGHT = 1100


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def export_band(source_path, output_path):
    dataset = gdal.Open(str(source_path), gdal.GA_ReadOnly)
    if dataset is None:
        raise RuntimeError(f"No se pudo abrir {source_path}")
    band = dataset.GetRasterBand(1)
    values = band.ReadAsArray().astype("<f4", copy=False)
    nodata = band.GetNoDataValue()
    valid = np.isfinite(values)
    if nodata is not None:
        valid &= values != np.float32(nodata)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("wb") as raw_output:
        with gzip.GzipFile(filename="", mode="wb", fileobj=raw_output, compresslevel=9, mtime=0) as compressed:
            compressed.write(values.tobytes(order="C"))
    metadata = {
        "band": 1,
        "compression": "gzip",
        "crs": "EPSG:25830",
        "dataUrl": f"assets/rasters/{output_path.name}",
        "geoTransform": list(dataset.GetGeoTransform()),
        "height": dataset.RasterYSize,
        "maximum": float(values[valid].max()),
        "minimum": float(values[valid].min()),
        "noData": nodata,
        "sha256": sha256(output_path),
        "sourceFile": source_path.name,
        "width": dataset.RasterXSize,
    }
    dataset = None
    return metadata


def export_isolines(source_path, output_path):
    if output_path.exists():
        output_path.unlink()
    options = gdal.VectorTranslateOptions(
        format="GeoJSON",
        dstSRS="EPSG:4326",
        layerCreationOptions=["COORDINATE_PRECISION=6", "RFC7946=YES"],
    )
    result = gdal.VectorTranslate(str(output_path), str(source_path), options=options)
    if result is None:
        raise RuntimeError(f"No se pudieron convertir las isolíneas {source_path}")
    result = None
    return {
        "dataUrl": f"assets/rasters/{output_path.name}",
        "sha256": sha256(output_path),
        "sourceFile": source_path.name,
    }


def export_report_overlay(source_path, output_path, color_ramp_path):
    dataset = gdal.Open(str(source_path), gdal.GA_ReadOnly)
    if dataset is None:
        raise RuntimeError(f"No se pudo abrir {source_path}")
    nodata = dataset.GetRasterBand(1).GetNoDataValue()
    warped = gdal.Warp(
        "",
        dataset,
        format="MEM",
        dstSRS="EPSG:4326",
        outputBounds=REPORT_BOUNDS,
        width=REPORT_WIDTH,
        height=REPORT_HEIGHT,
        resampleAlg="bilinear",
        srcNodata=nodata,
        dstNodata=nodata,
    )
    if warped is None:
        raise RuntimeError(f"No se pudo reproyectar {source_path}")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    options = gdal.DEMProcessingOptions(
        colorFilename=str(color_ramp_path),
        format="PNG",
        addAlpha=True,
    )
    result = gdal.DEMProcessing(str(output_path), warped, "color-relief", options=options)
    if result is None:
        raise RuntimeError(f"No se pudo colorear {source_path}")
    result = None
    warped = None
    dataset = None
    auxiliary_path = Path(f"{output_path}.aux.xml")
    if auxiliary_path.exists():
        auxiliary_path.unlink()
    return {
        "reportImageUrl": f"assets/rasters/{output_path.name}",
        "reportImageSha256": sha256(output_path),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--source-root",
        type=Path,
        default=Path(r"C:\Users\josel.palacin\Documents\SIGMOS\Capas raster"),
    )
    parser.add_argument("--output-root", type=Path, default=Path("assets/rasters"))
    parser.add_argument("--metadata", type=Path, default=Path("raster-intensity-data.js"))
    parser.add_argument(
        "--color-ramp",
        type=Path,
        default=Path(__file__).with_name("extraordinary-red-ramp.txt"),
    )
    args = parser.parse_args()

    gdal.UseExceptions()
    payload = {}
    isolines = {}
    for layer_key, config in RASTERS.items():
        payload[layer_key] = {"label": config["label"]}
        for scenario in ("extra", "zero"):
            source_path = args.source_root / config[scenario]
            output_path = args.output_root / f"{layer_key}-{scenario}.f32.gz"
            payload[layer_key][scenario] = export_band(source_path, output_path)
            if scenario == "extra":
                overlay_path = args.output_root / f"{layer_key}-extra-red.png"
                payload[layer_key][scenario].update(
                    export_report_overlay(source_path, overlay_path, args.color_ramp)
                )
        isoline_output = args.output_root / f"{layer_key}-isolines.geojson"
        isolines[layer_key] = export_isolines(args.source_root / ISOLINES[layer_key], isoline_output)

    metadata_text = (
        "window.RESERVOIR_RASTER_DATA = "
        + json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        + ";\nwindow.RESERVOIR_ISOLINE_DATA = "
        + json.dumps(isolines, ensure_ascii=False, separators=(",", ":"))
        + ";\n"
    )
    args.metadata.write_text(metadata_text, encoding="utf-8")
    print(
        f"Generados {len(payload) * 2} rasters, {len(payload)} imágenes del informe "
        f"y {len(isolines)} capas de isolíneas."
    )


if __name__ == "__main__":
    main()
