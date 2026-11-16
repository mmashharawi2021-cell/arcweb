# ArcWeb

ArcWeb is a browser-based Web GIS workspace for exploring local spatial data. Imported datasets are parsed in the browser and saved in IndexedDB so they remain available after refresh. No application backend is required; internet access is used for the basemap tiles.

## Run locally

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. To verify a production build, run `npm run build`.

## Capabilities

- The theme toggle switches between the original dark interface and a light cartographic palette with lavender-white panels, powder-blue active states, and peach status highlights.
- MapLibre GL canvas with OpenStreetMap, Esri World Imagery, Carto Dark Matter, and Carto Positron basemaps.
- Import GeoJSON/JSON, zipped Shapefiles, KML, CSV, or GeoTIFF (`.tif`/`.tiff`) files by using **Insert → Add data** or dropping them on the map.
- CSV files need recognizable latitude and longitude columns (for example `lat` and `lon`).
- GeoTIFF import reads band 1 and renders valid raster cells as a graduated polygon layer; files are capped at 250,000 cells.
- GeoJSON coordinates are validated as WGS84 or reprojected when a supported EPSG CRS is included. Shapefile ZIPs use their `.prj` definition; if it is missing, ArcWeb warns and assumes WGS84.
- Layer visibility, opacity, order, zoom-to-layer, and distance/area measurements. Symbology supports single symbols, categorized unique values, and graduated colors with equal-interval, quantile, or Jenks breaks; class labels, counts, palettes, line dashes, marker shapes, and label styling are synchronized with the map and print-layout legend.
- The Symbology pane includes label templates such as `{NAME} ({POP})`, text and halo styling, placement and offsets. MapLibre handles label shaping for Arabic scripts when the basemap glyph source provides the required glyphs.
- The **Attribute table** supports map/table feature selection, filtering, column sorting, custom fields, field aliases, safe arithmetic/string expressions, and feature deletion. Click a Contents table icon or use **Map → Table** to open it; drag its top edge to resize.
- **Analysis → Geoprocessing** includes the Analysis, Data Management, Conversion, Spatial Statistics, Spatial Analyst, Network Analyst, Cartography, Geocoding, 3D Analyst, and Image Analyst toolboxes. They cover vector overlays/statistics, raster surface and hydrology analysis, network routing/service areas, multispectral indices and classification, 3D surface/visibility analysis, local format conversion, and cartographic utilities.
- **3D Scene** is a pitched MapLibre view with right-drag rotation and height-based polygon extrusion. Terrain visibility analyses are available as geoprocessing tools; the scene does not currently render a DEM terrain surface.
- The modular `src/toolboxes/` registry generates forms from each tool's parameter schema. Results are added to Contents as layers or standalone tables; imports, analysis, and exports run in the browser.
- The Geoprocessing pane supports tool search and category tabs. Tool outputs and field/renderer updates flow through the shared Zustand state; exports and imports run in the browser.
- Workspace presets provide Standard, Analysis Focus, and Cartography Focus layouts. Contents, Geoprocessing, Symbology, and the Attribute Table can be floated, moved, and resized; panel geometry and the active preset persist in browser local storage and `.arcweb.json` projects. Full Canvas hides the application chrome and panels until restored.
- Symbol renderers, class break labels, line and marker styles, and label settings are saved with browser sessions and `.arcweb.json` project files; legacy projects receive compatible default styles.
- **Edit** creates Point, Line, or Polygon layers with custom fields. Select a target layer, choose a draw tool, and click the map to add features; double-click or use **Finish sketch** to complete lines and polygons. Vertices snap to nearby rendered features. To modify geometry, select a feature, choose **Move vertex**, click within 18 px of the vertex, then click its new location; selected features can also be deleted.
- **Share** exports layers as GeoJSON or CSV and captures the current map canvas as a 2× PNG.
- Layers and edits are stored locally in the browser. **Clear session** deletes the saved layers.

Basemap services are third-party tile providers and require internet connectivity. Geocoding sends the selected address text to the public Nominatim service only when the geocoding tool is run. Other imported data stays in the browser.
