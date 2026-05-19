import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Menu, MapPin, Navigation, ArrowDownUp, X, Clock, ChevronLeft, Home, Briefcase } from 'lucide-react';
import { motion, AnimatePresence, useDragControls, useMotionValue } from 'motion/react';
import maplibregl from 'maplibre-gl';
import type { GeoJSONSource, Marker, StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { requestRoute, parseRoutePath } from './routeApi';

const OPENFREEMAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
const OSRM_ROUTE_BASE_URL = 'https://router.project-osrm.org/route/v1/driving';
const NOMINATIM_SEARCH_URL = 'https://nominatim.openstreetmap.org/search';
const ROUTE_SOURCE_ID = 'route-line-source';
const ROUTE_LAYER_ID = 'route-line-layer';
const DEFAULT_CENTER = { lat: 22.3193, lng: 114.1694 };

type RouteStatus = 'idle' | 'submitting' | 'polling' | 'success' | 'error';
type FocusedInput = 'pickup' | 'dropoff';
type LatLngPoint = { lat: number; lng: number };
type PlaceSuggestion = {
  id: string;
  address: string;
  label: string;
  secondary: string;
};

type NominatimPlace = {
  osm_id: number;
  osm_type: string;
  display_name: string;
  name?: string;
  lat: string;
  lon: string;
};

type OsrmRouteResponse = {
  code: string;
  message?: string;
  routes?: Array<{
    geometry?: {
      coordinates?: [number, number][];
    };
  }>;
};

async function loadOpenFreeMapStyle() {
  const response = await fetch(OPENFREEMAP_STYLE_URL);

  if (!response.ok) {
    throw new Error(`OpenFreeMap style failed to load with HTTP ${response.status}.`);
  }

  const style = (await response.json()) as StyleSpecification;
  const building3dLayer = style.layers?.find((layer) => layer.id === 'building-3d');

  if (building3dLayer?.type === 'fill-extrusion') {
    building3dLayer.paint = {
      ...building3dLayer.paint,
      'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
      'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 0],
    };
  }

  return style;
}

function addTransparentMissingStyleImage(map: maplibregl.Map, id: string) {
  if (map.hasImage(id)) {
    return;
  }

  map.addImage(id, {
    width: 1,
    height: 1,
    data: new Uint8Array([0, 0, 0, 0]),
  });
}

function formatRouteMetric(value: number) {
  return new Intl.NumberFormat('en-US').format(value);
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Something went wrong. Please try again.';
}

function markerLabel(index: number) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  return alphabet[index] || `${index + 1}`;
}

function emptyRouteFeature() {
  return {
    type: 'Feature' as const,
    properties: {},
    geometry: {
      type: 'LineString' as const,
      coordinates: [] as [number, number][],
    },
  };
}

function createWaypointMarker(index: number) {
  const element = document.createElement('div');
  element.textContent = markerLabel(index);
  element.style.width = '30px';
  element.style.height = '30px';
  element.style.borderRadius = '9999px';
  element.style.background = '#111827';
  element.style.border = '2px solid #ffffff';
  element.style.boxShadow = '0 8px 18px rgba(0, 0, 0, 0.25)';
  element.style.color = '#ffffff';
  element.style.fontSize = '13px';
  element.style.fontWeight = '700';
  element.style.display = 'flex';
  element.style.alignItems = 'center';
  element.style.justifyContent = 'center';
  return element;
}

function formatSuggestion(place: NominatimPlace): PlaceSuggestion {
  const parts = place.display_name.split(',').map((part) => part.trim()).filter(Boolean);
  return {
    id: `${place.osm_type}-${place.osm_id}`,
    address: place.display_name,
    label: place.name || parts[0] || place.display_name,
    secondary: parts.slice(1, 4).join(', '),
  };
}

async function fetchPlaceSuggestions(query: string, signal: AbortSignal) {
  const searchParams = new URLSearchParams({
    format: 'jsonv2',
    addressdetails: '1',
    limit: '5',
    countrycodes: 'hk',
    'accept-language': 'en',
    q: query,
  });
  const response = await fetch(`${NOMINATIM_SEARCH_URL}?${searchParams.toString()}`, { signal });

  if (!response.ok) {
    throw new Error(`Address autocomplete failed with HTTP ${response.status}.`);
  }

  const places = (await response.json()) as NominatimPlace[];
  return places.map(formatSuggestion);
}

async function fetchDrivingRouteGeometry(points: LatLngPoint[], signal: AbortSignal) {
  const coordinates = points.map((point) => `${point.lng},${point.lat}`).join(';');
  const response = await fetch(`${OSRM_ROUTE_BASE_URL}/${coordinates}?overview=full&geometries=geojson&steps=false`, { signal });

  if (!response.ok) {
    throw new Error(`Driving route lookup failed with HTTP ${response.status}.`);
  }

  const route = (await response.json()) as OsrmRouteResponse;
  const routeCoordinates = route.routes?.[0]?.geometry?.coordinates;

  if (route.code !== 'Ok' || !routeCoordinates?.length) {
    throw new Error(route.message || 'No driving route was found for the returned waypoints.');
  }

  return routeCoordinates;
}

export default function App() {
  const constraintsRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const pickupInputRef = useRef<HTMLInputElement>(null);
  const dropoffInputRef = useRef<HTMLInputElement>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const routeAbortControllerRef = useRef<AbortController | null>(null);
  const autocompleteAbortControllerRef = useRef<AbortController | null>(null);
  const drivingRouteAbortControllerRef = useRef<AbortController | null>(null);
  const dragControls = useDragControls();

  const x = useMotionValue(0);
  const y = useMotionValue(0);

  const userTargetPos = useRef({ x: 0, y: 0 });
  const isDragging = useRef(false);

  const [focusedInput, setFocusedInput] = useState<FocusedInput | null>(null);
  const [pickup, setPickup] = useState('');
  const [dropoff, setDropoff] = useState('');
  const [routeStatus, setRouteStatus] = useState<RouteStatus>('idle');
  const [routeMessage, setRouteMessage] = useState('');
  const [routePoints, setRoutePoints] = useState<LatLngPoint[]>([]);
  const [routeSummary, setRouteSummary] = useState<{ totalDistance: number; totalTime: number } | null>(null);
  const [placeSuggestions, setPlaceSuggestions] = useState<Record<FocusedInput, PlaceSuggestion[]>>({
    pickup: [],
    dropoff: [],
  });
  const [isMapReady, setIsMapReady] = useState(false);

  // New State for Home/Work feature
  const [savedLocations, setSavedLocations] = useState({ home: '', work: '' });
  const [setupModal, setSetupModal] = useState<'home' | 'work' | null>(null);
  const [setupAddress, setSetupAddress] = useState('');
  const [targetInput, setTargetInput] = useState<FocusedInput | 'menu'>('dropoff');
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const isRouteLoading = routeStatus === 'submitting' || routeStatus === 'polling';

  // Handle mobile full-screen mode when focused
  const isMobileFocused = focusedInput !== null;

  const clearRouteOverlays = useCallback(() => {
    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = [];
    const map = mapRef.current;
    const source = map?.getSource(ROUTE_SOURCE_ID) as GeoJSONSource | undefined;
    source?.setData(emptyRouteFeature());
  }, []);

  const resetRouteState = useCallback(() => {
    routeAbortControllerRef.current?.abort();
    drivingRouteAbortControllerRef.current?.abort();
    setRouteStatus('idle');
    setRouteMessage('');
    setRouteSummary(null);
    setRoutePoints([]);
    clearRouteOverlays();
  }, [clearRouteOverlays]);

  const setInputValue = useCallback((target: FocusedInput, value: string) => {
    if (target === 'pickup') {
      setPickup(value);
    } else {
      setDropoff(value);
    }
  }, []);

  const applySelectedAddress = useCallback((target: FocusedInput, value: string) => {
    setInputValue(target, value);
    setPlaceSuggestions((prev) => ({ ...prev, [target]: [] }));
    setFocusedInput(null);
    resetRouteState();
  }, [resetRouteState, setInputValue]);

  const handleLocationSelect = (type: 'home' | 'work') => {
    const currentTarget = focusedInput || 'dropoff';
    if (savedLocations[type]) {
      applySelectedAddress(currentTarget, savedLocations[type]);
    } else {
      setTargetInput(currentTarget);
      setSetupAddress('');
      setSetupModal(type);
    }
  };

  const handleSuggestionSelect = (target: FocusedInput, address: string) => {
    applySelectedAddress(target, address);
  };

  const currentPlaceSuggestions = focusedInput ? placeSuggestions[focusedInput] : [];

  const handleSearchRides = async () => {
    const origin = pickup.trim();
    const destination = dropoff.trim();

    if (!origin || !destination) {
      setRouteStatus('error');
      setRouteMessage('Enter both pickup and drop-off addresses.');
      return;
    }

    routeAbortControllerRef.current?.abort();
    const abortController = new AbortController();
    routeAbortControllerRef.current = abortController;

    try {
      setFocusedInput(null);
      setRouteStatus('submitting');
      setRouteMessage('Submitting route request...');
      setRouteSummary(null);
      setRoutePoints([]);
      clearRouteOverlays();

      const route = await requestRoute(
        origin,
        destination,
        {
          signal: abortController.signal,
        },
        () => {
          setRouteStatus('polling');
          setRouteMessage('Calculating route...');
        },
      );
      const points = parseRoutePath(route.path);

      setRoutePoints(points);
      setRouteSummary({
        totalDistance: route.total_distance,
        totalTime: route.total_time,
      });
      setRouteStatus('success');
      setRouteMessage('Route ready.');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return;
      }

      setRouteStatus('error');
      setRouteMessage(getErrorMessage(error));
      setRouteSummary(null);
      setRoutePoints([]);
      clearRouteOverlays();
    }
  };

  // Automatically keep box within bounds on layout changes
  useEffect(() => {
    let isRunning = true;
    let frameId: number;

    const loop = () => {
      if (!isRunning) return;

      if (boxRef.current && constraintsRef.current && !isDragging.current) {
        const box = boxRef.current.getBoundingClientRect();
        const bounds = constraintsRef.current.getBoundingClientRect();

        const currentY = y.get();
        const currentX = x.get();

        // Calculate the "native" position without the current transform
        const nativeTop = box.top - currentY;
        const nativeBottom = box.bottom - currentY;
        const nativeLeft = box.left - currentX;
        const nativeRight = box.right - currentX;

        let desiredY = userTargetPos.current.y;
        let desiredX = userTargetPos.current.x;

        // Keep within vertical bounds
        if (nativeBottom - nativeTop <= bounds.height + 1) {
          if (nativeBottom + desiredY > bounds.bottom) {
            desiredY = bounds.bottom - nativeBottom;
          }
          if (nativeTop + desiredY < bounds.top) {
            desiredY = bounds.top - nativeTop;
          }
        } else {
          desiredY = bounds.top - nativeTop; // Pin to top if taller than screen
        }

        // Keep within horizontal bounds
        if (nativeRight - nativeLeft <= bounds.width + 1) {
          if (nativeRight + desiredX > bounds.right) {
            desiredX = bounds.right - nativeRight;
          }
          if (nativeLeft + desiredX < bounds.left) {
            desiredX = bounds.left - nativeLeft;
          }
        } else {
          desiredX = bounds.left - nativeLeft;
        }

        // Use set() for immediate, un-animated updates since this runs every frame during the layout transition
        if (currentY !== desiredY) y.set(desiredY);
        if (currentX !== desiredX) x.set(desiredX);
      }

      frameId = requestAnimationFrame(loop);
    };

    loop();

    // Give the layout transition 0.5s to fully finish expanding/shrinking
    const timer = setTimeout(() => {
      isRunning = false;
      cancelAnimationFrame(frameId);
    }, 500);

    return () => {
      isRunning = false;
      cancelAnimationFrame(frameId);
      clearTimeout(timer);
    };
  }, [focusedInput, isMenuOpen, setupModal, pickup, dropoff, routeMessage, y, x]);

  useEffect(() => {
    let cancelled = false;
    let resizeObserver: ResizeObserver | null = null;
    let resizeFrameId: number | null = null;

    if (!mapContainerRef.current || mapRef.current) {
      return;
    }

    loadOpenFreeMapStyle()
      .then((style) => {
        if (cancelled || !mapContainerRef.current) {
          return;
        }

        const map = new maplibregl.Map({
          container: mapContainerRef.current,
          style,
          center: [DEFAULT_CENTER.lng, DEFAULT_CENTER.lat],
          zoom: 11,
          attributionControl: false,
        });

        map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
        map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');
        map.on('styleimagemissing', (event) => addTransparentMissingStyleImage(map, event.id));
        map.on('error', (event) => {
          console.warn('MapLibre error:', event.error);
        });

        const resizeMap = () => map.resize();
        resizeFrameId = window.requestAnimationFrame(resizeMap);
        resizeObserver = new ResizeObserver(resizeMap);
        resizeObserver.observe(mapContainerRef.current);

        map.on('load', () => {
          map.addSource(ROUTE_SOURCE_ID, {
            type: 'geojson',
            data: emptyRouteFeature(),
          });
          map.addLayer({
            id: ROUTE_LAYER_ID,
            type: 'line',
            source: ROUTE_SOURCE_ID,
            layout: {
              'line-cap': 'round',
              'line-join': 'round',
            },
            paint: {
              'line-color': '#111827',
              'line-opacity': 0.92,
              'line-width': 6,
            },
          });
          map.resize();
          setIsMapReady(true);
        });

        map.on('idle', () => {
          map.resize();
        });

        mapRef.current = map;
      })
      .catch((error) => {
        if (!cancelled) {
          setRouteStatus('error');
          setRouteMessage(getErrorMessage(error));
        }
      });

    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      if (resizeFrameId !== null) {
        window.cancelAnimationFrame(resizeFrameId);
      }
      setIsMapReady(false);
      routeAbortControllerRef.current?.abort();
      autocompleteAbortControllerRef.current?.abort();
      drivingRouteAbortControllerRef.current?.abort();
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const query = focusedInput === 'pickup' ? pickup.trim() : focusedInput === 'dropoff' ? dropoff.trim() : '';

    autocompleteAbortControllerRef.current?.abort();

    if (!focusedInput || query.length < 3) {
      if (focusedInput) {
        setPlaceSuggestions((prev) => ({ ...prev, [focusedInput]: [] }));
      }
      return;
    }

    const abortController = new AbortController();
    autocompleteAbortControllerRef.current = abortController;
    const timer = window.setTimeout(() => {
      fetchPlaceSuggestions(query, abortController.signal)
        .then((suggestions) => {
          setPlaceSuggestions((prev) => ({ ...prev, [focusedInput]: suggestions }));
        })
        .catch((error) => {
          if (!(error instanceof DOMException && error.name === 'AbortError')) {
            setPlaceSuggestions((prev) => ({ ...prev, [focusedInput]: [] }));
          }
        });
    }, 300);

    return () => {
      window.clearTimeout(timer);
      abortController.abort();
    };
  }, [dropoff, focusedInput, pickup]);

  useEffect(() => {
    let cancelled = false;
    const map = mapRef.current;

    if (!map || !isMapReady) {
      return;
    }

    clearRouteOverlays();

    if (routePoints.length === 0) {
      map.setCenter([DEFAULT_CENTER.lng, DEFAULT_CENTER.lat]);
      map.setZoom(11);
      return;
    }

    const bounds = new maplibregl.LngLatBounds();
    routePoints.forEach((point, index) => {
      bounds.extend([point.lng, point.lat]);
      const marker = new maplibregl.Marker({
        element: createWaypointMarker(index),
        anchor: 'center',
      })
        .setLngLat([point.lng, point.lat])
        .addTo(map);
      markersRef.current.push(marker);
    });

    map.fitBounds(bounds, { padding: 72, maxZoom: 14 });

    if (routePoints.length < 2) {
      return;
    }

    drivingRouteAbortControllerRef.current?.abort();
    const abortController = new AbortController();
    drivingRouteAbortControllerRef.current = abortController;

    fetchDrivingRouteGeometry(routePoints, abortController.signal)
      .then((coordinates) => {
        if (cancelled) {
          return;
        }

        const source = map.getSource(ROUTE_SOURCE_ID) as GeoJSONSource | undefined;
        source?.setData({
          ...emptyRouteFeature(),
          geometry: {
            type: 'LineString',
            coordinates,
          },
        });
      })
      .catch((error) => {
        if (cancelled || (error instanceof DOMException && error.name === 'AbortError')) {
          return;
        }

        setRouteStatus('error');
        setRouteMessage(getErrorMessage(error));
      });

    return () => {
      cancelled = true;
      abortController.abort();
    };
  }, [clearRouteOverlays, isMapReady, routePoints]);

  return (
    <div ref={constraintsRef} className="relative w-full h-screen overflow-hidden bg-[#e5e3df]">
      <div className="absolute inset-0 z-0">
        <div ref={mapContainerRef} className="h-full w-full" />
      </div>

      {/* Floating UI Container */}
      <div className="absolute inset-0 z-10 pointer-events-none">
        <motion.div
          layout
          ref={boxRef}
          style={{ x, y }}
          drag
          dragConstraints={constraintsRef}
          dragControls={dragControls}
          dragListener={false}
          dragMomentum={false}
          dragElastic={0.2}
          dragTransition={{ bounceStiffness: 400, bounceDamping: 25 }}
          onDragStart={() => { isDragging.current = true; }}
          onDragEnd={() => {
            isDragging.current = false;
            userTargetPos.current = { x: x.get(), y: y.get() };
          }}
          transition={{ type: "spring", bounce: 0, duration: 0.3 }}
          className={`bg-white pointer-events-auto shadow-2xl flex flex-col overflow-hidden absolute
            ${isMobileFocused
              ? 'inset-0 md:inset-auto md:top-8 md:left-8 md:w-[400px] h-full md:h-auto md:max-h-[85vh] md:rounded-3xl'
              : 'bottom-0 md:bottom-auto md:top-8 left-0 md:left-8 w-full md:w-[400px] h-auto mt-auto md:mt-0 rounded-t-3xl md:rounded-3xl max-h-[85vh]'
            }
          `}
        >
          {/* Header */}
          <motion.div layout transition={{ type: "spring", bounce: 0, duration: 0.3 }} className={`flex items-center justify-between px-4 py-3 md:pt-5 border-b border-gray-100 relative ${isMobileFocused ? 'bg-white' : ''}`}>
            {isMobileFocused ? (
              <button
                onClick={() => { setFocusedInput(null); setIsMenuOpen(false); }}
                className="p-2 hover:bg-gray-100 rounded-full transition-colors z-10"
              >
                <ChevronLeft size={24} />
              </button>
            ) : isMenuOpen ? (
              <button
                onClick={() => setIsMenuOpen(false)}
                className="p-2 hover:bg-gray-100 rounded-full transition-colors z-10"
              >
                <ChevronLeft size={24} />
              </button>
            ) : (
              <button onClick={() => setIsMenuOpen(true)} className="p-2 hover:bg-gray-100 rounded-full transition-colors z-10">
                <Menu size={24} />
              </button>
            )}

            {/* Universal Drag Indicator */}
            <div
              className="absolute left-1/2 -translate-x-1/2 top-0 pt-3 pb-3 px-8 cursor-grab active:cursor-grabbing touch-none z-10"
              onPointerDown={(e) => dragControls.start(e)}
            >
              <div className="w-12 h-1.5 bg-gray-300 rounded-full hover:bg-gray-400 transition-colors" />
            </div>
          </motion.div>

          {/* Main Content */}
          <motion.div layout transition={{ type: "spring", bounce: 0, duration: 0.3 }} className="flex-1 overflow-y-auto bg-white flex flex-col relative overflow-hidden">
            <AnimatePresence mode="popLayout" initial={false}>
            {isMenuOpen ? (
              <motion.div
                layout
                key="settings"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ layout: { type: "spring", bounce: 0, duration: 0.3 }, duration: 0.2 }}
                className="flex flex-col h-full w-full"
              >
                <div className="p-5 flex-shrink-0">
                  <h1 className="text-2xl font-bold mb-6 hidden md:block">Settings</h1>

                  {/* Settings / Saved Places */}
                  <div className="space-y-6">
                    <div>
                      <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4">Saved Places</h3>
                      <div className="space-y-4">
                        <div className="flex items-center justify-between group">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center text-gray-600">
                              <Home size={18} />
                            </div>
                            <div>
                              <div className="font-semibold text-gray-900">Home</div>
                              <div className="text-xs text-gray-500 truncate max-w-[120px]">{savedLocations.home || 'Not set'}</div>
                            </div>
                          </div>
                          <button
                            onClick={() => {
                              setTargetInput('menu');
                              setSetupAddress(savedLocations.home || '');
                              setSetupModal('home');
                            }}
                            className="text-sm text-blue-600 font-semibold px-3 py-1.5 hover:bg-blue-50 rounded-lg transition-colors"
                          >
                            {savedLocations.home ? 'Edit' : 'Add'}
                          </button>
                        </div>

                        <div className="flex items-center justify-between group">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center text-gray-600">
                              <Briefcase size={18} />
                            </div>
                            <div>
                              <div className="font-semibold text-gray-900">Work</div>
                              <div className="text-xs text-gray-500 truncate max-w-[120px]">{savedLocations.work || 'Not set'}</div>
                            </div>
                          </div>
                          <button
                            onClick={() => {
                              setTargetInput('menu');
                              setSetupAddress(savedLocations.work || '');
                              setSetupModal('work');
                            }}
                            className="text-sm text-blue-600 font-semibold px-3 py-1.5 hover:bg-blue-50 rounded-lg transition-colors"
                          >
                            {savedLocations.work ? 'Edit' : 'Add'}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            ) : (
              <motion.div
                layout
                key="request"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                transition={{ layout: { type: "spring", bounce: 0, duration: 0.3 }, duration: 0.2 }}
                className="flex flex-col h-full w-full"
              >
                {/* Ride Request Form */}
                <div className="p-5 flex-shrink-0">
                  {!isMobileFocused && <h1 className="text-2xl font-bold mb-6 hidden md:block">Request a ride</h1>}

              <div className="relative">
                {/* Connecting Line */}
                <div className="absolute left-[23px] top-[26px] bottom-[26px] w-[2px] bg-gray-300 z-0"></div>

                <div className="space-y-3 relative z-10">
                  {/* Pickup Input */}
                  <div className="flex items-center gap-4">
                    <div className="flex items-center justify-center w-5">
                      <div className="w-2 h-2 rounded-full bg-black"></div>
                    </div>
                    <div className={`flex-1 bg-gray-100 rounded-xl flex items-center px-4 transition-all duration-200 ${focusedInput === 'pickup' ? 'bg-white ring-2 ring-black shadow-sm' : 'hover:bg-gray-200'}`}>
                      <input
                        ref={pickupInputRef}
                        type="text"
                        placeholder="Pickup location"
                        value={pickup}
                        onChange={(e) => {
                          setPickup(e.target.value);
                          resetRouteState();
                        }}
                        className="w-full bg-transparent py-3.5 text-base font-medium focus:outline-none placeholder:text-gray-500 text-black"
                        onFocus={() => setFocusedInput('pickup')}
                      />
                      {pickup && (
                        <button
                          onClick={() => {
                            setPickup('');
                            resetRouteState();
                          }}
                          className="p-1 text-gray-400 hover:text-black rounded-full"
                        >
                          <X size={18} />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Dropoff Input */}
                  <div className="flex items-center gap-4">
                    <div className="flex items-center justify-center w-5">
                      <div className="w-2 h-2 bg-black"></div>
                    </div>
                    <div className={`flex-1 bg-gray-100 rounded-xl flex items-center px-4 transition-all duration-200 ${focusedInput === 'dropoff' ? 'bg-white ring-2 ring-black shadow-sm' : 'hover:bg-gray-200'}`}>
                      <input
                        ref={dropoffInputRef}
                        type="text"
                        placeholder="Where to?"
                        value={dropoff}
                        onChange={(e) => {
                          setDropoff(e.target.value);
                          resetRouteState();
                        }}
                        className="w-full bg-transparent py-3.5 text-base font-medium focus:outline-none placeholder:text-gray-500 text-black"
                        onFocus={() => setFocusedInput('dropoff')}
                      />
                      {dropoff && (
                        <button
                          onClick={() => {
                            setDropoff('');
                            resetRouteState();
                          }}
                          className="p-1 text-gray-400 hover:text-black rounded-full"
                        >
                          <X size={18} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Swap Button */}
                <button
                  onClick={() => {
                    const temp = pickup;
                    setPickup(dropoff);
                    setDropoff(temp);
                    resetRouteState();
                  }}
                  className="absolute right-4 top-1/2 -translate-y-1/2 bg-gray-100 p-2 rounded-full hover:bg-gray-200 shadow-sm border border-gray-200 z-20 transition-transform active:scale-95"
                  aria-label="Swap locations"
                >
                  <ArrowDownUp size={16} className="text-gray-600" />
                </button>
              </div>

              {/* Autocomplete / Suggestions */}
              <div className="mt-6">
                {focusedInput ? (
                  <div className="space-y-1 animate-in fade-in slide-in-from-bottom-2 duration-200">
                    {/* Current Location Option */}
                    {focusedInput === 'pickup' && (
                      <button
                        type="button"
                        onClick={() => handleSuggestionSelect('pickup', 'Current Location, Hong Kong')}
                        className="w-full text-left flex items-center gap-4 cursor-pointer hover:bg-gray-50 p-3 -mx-3 rounded-xl transition-colors"
                      >
                        <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 shrink-0">
                          <Navigation size={20} className="fill-current" />
                        </div>
                        <div className="flex-1 border-b border-gray-100 pb-4 mt-4">
                          <div className="font-semibold text-gray-900 text-base">Current Location</div>
                        </div>
                      </button>
                    )}

                    {/* Home Option */}
                    <button type="button" className="w-full text-left flex items-center gap-4 cursor-pointer hover:bg-gray-50 p-3 -mx-3 rounded-xl transition-colors" onClick={() => handleLocationSelect('home')}>
                      <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center text-gray-600 shrink-0">
                        <Home size={20} />
                      </div>
                      <div className="flex-1 border-b border-gray-100 pb-4 mt-4">
                        <div className="font-semibold text-gray-900 text-base">Home</div>
                        <div className="text-sm text-gray-500 mt-0.5">{savedLocations.home || 'Set location'}</div>
                      </div>
                    </button>

                    {/* Work Option */}
                    <button type="button" className="w-full text-left flex items-center gap-4 cursor-pointer hover:bg-gray-50 p-3 -mx-3 rounded-xl transition-colors" onClick={() => handleLocationSelect('work')}>
                      <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center text-gray-600 shrink-0">
                        <Briefcase size={20} />
                      </div>
                      <div className="flex-1 border-b border-gray-100 pb-4 mt-4">
                        <div className="font-semibold text-gray-900 text-base">Work</div>
                        <div className="text-sm text-gray-500 mt-0.5">{savedLocations.work || 'Set location'}</div>
                      </div>
                    </button>

                    {/* Recent & Suggested Places */}
                    <button type="button" onClick={() => handleSuggestionSelect(focusedInput, 'Hong Kong International Airport Terminal 1')} className="w-full text-left flex items-center gap-4 cursor-pointer hover:bg-gray-50 p-3 -mx-3 rounded-xl transition-colors">
                      <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center text-gray-600 shrink-0">
                        <Clock size={20} />
                      </div>
                      <div className="flex-1 border-b border-gray-100 pb-4 mt-4">
                        <div className="font-semibold text-gray-900 text-base">Hong Kong International Airport Terminal 1</div>
                        <div className="text-sm text-gray-500 mt-0.5">Chek Lap Kok, Hong Kong</div>
                      </div>
                    </button>

                    <button type="button" onClick={() => handleSuggestionSelect(focusedInput, 'Innocentre, Hong Kong')} className="w-full text-left flex items-center gap-4 cursor-pointer hover:bg-gray-50 p-3 -mx-3 rounded-xl transition-colors">
                      <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center text-gray-600 shrink-0">
                        <MapPin size={20} />
                      </div>
                      <div className="flex-1 border-b border-gray-100 pb-4 mt-4">
                        <div className="font-semibold text-gray-900 text-base">Innocentre</div>
                        <div className="text-sm text-gray-500 mt-0.5">Kowloon Tong, Hong Kong</div>
                      </div>
                    </button>

                    <button type="button" onClick={() => handleSuggestionSelect(focusedInput, 'Central, Hong Kong')} className="w-full text-left flex items-center gap-4 cursor-pointer hover:bg-gray-50 p-3 -mx-3 rounded-xl transition-colors">
                      <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center text-gray-600 shrink-0">
                        <MapPin size={20} />
                      </div>
                      <div className="flex-1 border-b border-gray-100 pb-4 mt-4">
                        <div className="font-semibold text-gray-900 text-base">Central</div>
                        <div className="text-sm text-gray-500 mt-0.5">Central, Hong Kong</div>
                      </div>
                    </button>

                    {currentPlaceSuggestions.map((suggestion) => (
                      <button
                        key={suggestion.id}
                        type="button"
                        onClick={() => handleSuggestionSelect(focusedInput, suggestion.address)}
                        className="w-full text-left flex items-center gap-4 cursor-pointer hover:bg-gray-50 p-3 -mx-3 rounded-xl transition-colors"
                      >
                        <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center text-gray-600 shrink-0">
                          <MapPin size={20} />
                        </div>
                        <div className="flex-1 border-b border-gray-100 pb-4 mt-4 min-w-0">
                          <div className="font-semibold text-gray-900 text-base truncate">{suggestion.label}</div>
                          <div className="text-sm text-gray-500 mt-0.5 truncate">{suggestion.secondary || suggestion.address}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="space-y-4 animate-in fade-in duration-300">
                    <div className="flex gap-4">
                      <button onClick={() => handleLocationSelect('home')} className="flex-1 bg-gray-100 hover:bg-gray-200 py-3.5 rounded-xl flex items-center justify-center gap-2.5 font-semibold text-sm transition-colors text-gray-800">
                        <div className="w-7 h-7 bg-white rounded-full flex items-center justify-center shadow-sm">
                          <Home size={14} className="text-black" />
                        </div>
                        Home
                      </button>
                      <button onClick={() => handleLocationSelect('work')} className="flex-1 bg-gray-100 hover:bg-gray-200 py-3.5 rounded-xl flex items-center justify-center gap-2.5 font-semibold text-sm transition-colors text-gray-800">
                        <div className="w-7 h-7 bg-white rounded-full flex items-center justify-center shadow-sm">
                          <Briefcase size={14} className="text-black" />
                        </div>
                        Work
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Fill space in mobile if not enough content */}
            {isMobileFocused && <div className="flex-1 bg-gray-50/50"></div>}
            </motion.div>
            )}
            </AnimatePresence>
          </motion.div>

          {/* Footer Actions */}
          <AnimatePresence mode="popLayout">
          {!focusedInput && !isMenuOpen && (
            <motion.div
              layout
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              transition={{ layout: { type: "spring", bounce: 0, duration: 0.3 }, duration: 0.2 }}
              className="p-5 bg-white border-t border-gray-100 rounded-b-3xl w-full"
            >
              {routeMessage && (
                <div className={`mb-3 rounded-xl px-4 py-3 text-sm font-semibold ${
                  routeStatus === 'error'
                    ? 'bg-red-50 text-red-700'
                    : routeStatus === 'success'
                      ? 'bg-green-50 text-green-700'
                      : 'bg-gray-100 text-gray-700'
                }`}>
                  {routeMessage}
                  {routeSummary && (
                    <div className="mt-1 text-xs font-medium opacity-80">
                      Distance {formatRouteMetric(routeSummary.totalDistance)} | Time {formatRouteMetric(routeSummary.totalTime)}
                    </div>
                  )}
                </div>
              )}
              <button
                onClick={handleSearchRides}
                disabled={isRouteLoading}
                className="w-full bg-black text-white py-4 rounded-xl font-bold text-lg hover:bg-gray-800 transition-colors shadow-lg active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-gray-500 disabled:active:scale-100"
              >
                {isRouteLoading ? 'Searching...' : 'Search rides'}
              </button>
            </motion.div>
          )}
          </AnimatePresence>
        </motion.div>
      </div>

      {/* Location Setup Modal */}
      {setupModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm transition-opacity">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl animate-in fade-in zoom-in-95 duration-200">
            <h2 className="text-xl font-bold mb-2">Set {setupModal === 'home' ? 'Home' : 'Work'} address</h2>
            <p className="text-gray-500 text-sm mb-6">Enter a valid address to save it for future rides.</p>

            <input
              type="text"
              autoFocus
              placeholder={`Enter ${setupModal} address`}
              value={setupAddress}
              onChange={(e) => setSetupAddress(e.target.value)}
              className="w-full bg-gray-100 rounded-xl px-4 py-3.5 text-base font-medium focus:outline-none focus:ring-2 focus:ring-black mb-6 text-black placeholder:text-gray-500"
            />

            <div className="flex gap-3">
              <button
                onClick={() => setSetupModal(null)}
                className="flex-1 py-3 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-xl font-semibold transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (setupAddress.trim()) {
                    setSavedLocations(prev => ({ ...prev, [setupModal]: setupAddress }));
                    if (targetInput === 'pickup') {
                      setPickup(setupAddress);
                    } else if (targetInput === 'dropoff') {
                      setDropoff(setupAddress);
                    }
                    setSetupModal(null);
                    resetRouteState();
                    if (targetInput !== 'menu') {
                      setFocusedInput(null);
                    }
                  }
                }}
                className="flex-1 py-3 bg-black hover:bg-gray-800 text-white rounded-xl font-semibold transition-colors"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
