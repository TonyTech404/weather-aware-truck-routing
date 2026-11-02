import { useEffect, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import type { GeoJSONSource, Map as MapLibreMap, MapMouseEvent } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { Coord } from '@/lib/geo'
import { boundsOf } from '@/lib/geo'
import type { FeatureCollection } from '@/lib/derive'
import type { PlaceRef } from '@/types/api'
import { BASEMAP_STYLE_URL, FALLBACK_STYLE, HEAT_COLOR, heatRadius } from './mapStyle'

type AnyCollection = FeatureCollection<{ type: string; coordinates: unknown }>

export interface MapData {
  routes: AnyCollection
  risk: AnyCollection
  checkpoints: AnyCollection
  heat: AnyCollection
  truck: Coord | null
}

interface Props {
  data: MapData
  /** Bounds are refit whenever this changes (a new analysis). */
  fitKey: unknown
  fitCoords: Coord[]
  intervalMi: number
  layers: { heatmap: boolean; checkpoints: boolean; alternatives: boolean }
  endpoints: { origin: PlaceRef | null; destination: PlaceRef | null }
  focus: Coord | null
  onSelectRoute: (routeId: string) => void
  onSelectCheckpoint: (routeId: string, index: number) => void
  compact: boolean
}

// Vite bundles the worker with its imports; the default URL lookup breaks under pre-bundling.
maplibregl.setWorkerUrl(workerUrl)

const EMPTY: AnyCollection = { type: 'FeatureCollection', features: [] }
const SOURCES = ['routes', 'risk', 'checkpoints', 'heat', 'truck'] as const

function installLayers(map: MapLibreMap, intervalMi: number) {
  if (map.getSource('routes')) return
  for (const id of SOURCES) map.addSource(id, { type: 'geojson', data: EMPTY as never })

  map.addLayer({
    id: 'heat',
    type: 'heatmap',
    source: 'heat',
    paint: {
      'heatmap-weight': ['get', 'w'],
      // MapLibre's kernel peaks at ~0.4 per unit weight, so intensity restores the ramp's range.
      'heatmap-intensity': 1.9,
      'heatmap-radius': heatRadius(intervalMi),
      'heatmap-color': HEAT_COLOR,
      'heatmap-opacity': 0.85,
    },
  })
  // Alternatives: neutral lines with a wide invisible stroke for easier clicking.
  map.addLayer({
    id: 'routes-hit',
    type: 'line',
    source: 'routes',
    paint: { 'line-width': 16, 'line-opacity': 0 },
  })
  map.addLayer({
    id: 'routes-casing',
    type: 'line',
    source: 'routes',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#ffffff', 'line-width': 7, 'line-opacity': 0.9 },
  })
  map.addLayer({
    id: 'routes-line',
    type: 'line',
    source: 'routes',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#7d8b98', 'line-width': 4 },
  })
  map.addLayer({
    id: 'risk-casing',
    type: 'line',
    source: 'risk',
    layout: { 'line-cap': 'butt', 'line-join': 'round' },
    paint: { 'line-color': '#ffffff', 'line-width': 11 },
  })
  map.addLayer({
    id: 'risk-line',
    type: 'line',
    source: 'risk',
    layout: { 'line-cap': 'butt', 'line-join': 'round' },
    paint: { 'line-color': ['get', 'color'], 'line-width': 7 },
  })
  // No Travel stretches get a white dash so they read as "closed" without relying on colour.
  map.addLayer({
    id: 'risk-closed',
    type: 'line',
    source: 'risk',
    filter: ['==', ['get', 'level'], 'no_travel'],
    paint: { 'line-color': '#ffffff', 'line-width': 2, 'line-dasharray': [1, 1.5] },
  })
  map.addLayer({
    id: 'checkpoints',
    type: 'circle',
    source: 'checkpoints',
    paint: {
      'circle-color': ['get', 'color'],
      // Dots grow with zoom so a long route is not a chain of overlapping circles.
      'circle-radius': [
        'interpolate',
        ['linear'],
        ['zoom'],
        3,
        ['case', ['get', 'active'], 6, ['get', 'onSelectedRoute'], 1.5, 1],
        6,
        ['case', ['get', 'active'], 8, ['get', 'onSelectedRoute'], 3, 2],
        9,
        ['case', ['get', 'active'], 9, ['get', 'onSelectedRoute'], 5, 3],
      ],
      'circle-stroke-color': ['case', ['get', 'active'], '#0b4f5c', '#ffffff'],
      'circle-stroke-width': ['case', ['get', 'active'], 3, 1.5],
      'circle-opacity': ['case', ['get', 'onSelectedRoute'], 1, 0.7],
    },
  })
  map.addLayer({
    id: 'truck',
    type: 'circle',
    source: 'truck',
    paint: {
      'circle-radius': 8,
      'circle-color': '#0b4f5c',
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 3,
    },
  })
}

function endpointElement(letter: string): HTMLElement {
  const el = document.createElement('div')
  el.textContent = letter
  el.setAttribute('aria-label', letter === 'A' ? 'Origin' : 'Destination')
  el.style.cssText =
    'width:26px;height:26px;border-radius:50%;background:#0b4f5c;color:#fff;border:2.5px solid #fff;' +
    'box-shadow:0 1px 4px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;' +
    'font:600 12px Inter Variable,system-ui,sans-serif;'
  return el
}

export default function MapView({
  data,
  fitKey,
  fitCoords,
  intervalMi,
  layers,
  endpoints,
  focus,
  onSelectRoute,
  onSelectCheckpoint,
  compact,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const markersRef = useRef<maplibregl.Marker[]>([])
  const [ready, setReady] = useState(false)
  // Latest callbacks and settings, read from long-lived map event handlers.
  const handlers = useRef({ onSelectRoute, onSelectCheckpoint })
  const intervalRef = useRef(intervalMi)
  useEffect(() => {
    handlers.current = { onSelectRoute, onSelectCheckpoint }
    intervalRef.current = intervalMi
  })

  // Create the map once.
  useEffect(() => {
    if (!containerRef.current) return
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: BASEMAP_STYLE_URL,
      center: [-96, 38.5],
      zoom: 3.6,
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
    })
    mapRef.current = map
    map.touchZoomRotate.disableRotation()
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right')

    let fellBack = false
    // style.load fires for the first style and for the fallback, so layers install in both cases.
    map.on('style.load', () => {
      installLayers(map, intervalRef.current)
      setReady(true)
    })
    map.on('error', (event) => {
      if (!fellBack && !map.isStyleLoaded() && /style|fetch|Failed|network/i.test(String(event.error?.message))) {
        fellBack = true
        map.setStyle(FALLBACK_STYLE)
      }
    })

    map.on('click', 'checkpoints', (e: MapMouseEvent) => {
      const props = map.queryRenderedFeatures(e.point, { layers: ['checkpoints'] })[0]?.properties
      if (props) handlers.current.onSelectCheckpoint(String(props.routeId), Number(props.index))
    })
    map.on('click', 'routes-hit', (e: MapMouseEvent) => {
      if (map.queryRenderedFeatures(e.point, { layers: ['checkpoints'] }).length) return
      const id = map.queryRenderedFeatures(e.point, { layers: ['routes-hit'] })[0]?.properties?.id
      if (id) handlers.current.onSelectRoute(String(id))
    })
    for (const layer of ['checkpoints', 'routes-hit']) {
      map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'))
      map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = ''))
    }

    // Lets the Playwright suite (e2e build) and developers inspect what is drawn; absent from production builds.
    if (import.meta.env.MODE !== 'production') {
      ;(window as unknown as Record<string, unknown>).__routeguard = {
        map,
        sourceFeatures: (id: string) => {
          const source = map.getSource(id) as GeoJSONSource | undefined
          const data = source?.serialize().data as AnyCollection | undefined
          return data?.features ?? []
        },
      }
    }

    return () => {
      markersRef.current.forEach((m) => m.remove())
      map.remove()
      mapRef.current = null
      setReady(false)
    }
  }, [])

  function setData(id: (typeof SOURCES)[number], value: AnyCollection) {
    ;(mapRef.current?.getSource(id) as GeoJSONSource | undefined)?.setData(value as never)
  }

  useEffect(() => { if (ready) setData('routes', data.routes) }, [ready, data.routes])
  useEffect(() => { if (ready) setData('risk', data.risk) }, [ready, data.risk])
  useEffect(() => { if (ready) setData('checkpoints', data.checkpoints) }, [ready, data.checkpoints])
  useEffect(() => { if (ready) setData('heat', data.heat) }, [ready, data.heat])
  useEffect(() => {
    if (!ready) return
    setData('truck', {
      type: 'FeatureCollection',
      features: data.truck ? [{ type: 'Feature', geometry: { type: 'Point', coordinates: data.truck }, properties: {} }] : [],
    })
  }, [ready, data.truck])

  useEffect(() => {
    if (ready) mapRef.current?.setPaintProperty('heat', 'heatmap-radius', heatRadius(intervalMi))
  }, [ready, intervalMi])

  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    const show = (id: string, on: boolean) => map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none')
    show('heat', layers.heatmap)
    show('checkpoints', layers.checkpoints)
    for (const id of ['routes-line', 'routes-casing']) show(id, layers.alternatives)
  }, [ready, layers])

  // Pins for the chosen origin and destination, shown before any analysis.
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    markersRef.current.forEach((m) => m.remove())
    markersRef.current = [
      [endpoints.origin, 'A'] as const,
      [endpoints.destination, 'B'] as const,
    ]
      .filter(([place]) => place)
      .map(([place, letter]) =>
        new maplibregl.Marker({ element: endpointElement(letter) }).setLngLat([place!.lon, place!.lat]).addTo(map),
      )
  }, [ready, endpoints])

  useEffect(() => {
    const map = mapRef.current
    const bounds = boundsOf(fitCoords)
    if (!ready || !map || !bounds) return
    map.fitBounds(bounds, {
      padding: compact ? { top: 36, bottom: 96, left: 24, right: 24 } : { top: 70, bottom: 170, left: 60, right: 60 },
      maxZoom: 9,
      duration: 700,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refit only for a new analysis
  }, [ready, fitKey])

  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map || !focus) return
    map.easeTo({ center: focus, zoom: Math.max(map.getZoom(), 7), duration: 500 })
  }, [ready, focus])

  // MapLibre sets position:relative on its container, so sizing lives on this wrapper.
  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="h-full w-full" data-testid="map" />
    </div>
  )
}
