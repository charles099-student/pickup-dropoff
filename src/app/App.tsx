import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { Menu, MapPin, Navigation, ArrowDownUp, X, Clock, ChevronLeft, Home, Briefcase } from 'lucide-react';
import { motion, AnimatePresence, useDragControls, useMotionValue } from 'motion/react';
import maplibregl from 'maplibre-gl';
import type { GeoJSONSource, Marker, StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { requestRoute, parseRoutePath } from './routeApi';
import { useIsMobile } from './components/ui/use-mobile';

const OPENFREEMAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
const OSRM_ROUTE_BASE_URL = 'https://router.project-osrm.org/route/v1/driving';
const NOMINATIM_SEARCH_URL = 'https://nominatim.openstreetmap.org/search';
const ROUTE_SOURCE_ID = 'route-line-source';
const ROUTE_LAYER_ID = 'route-line-layer';
const DEFAULT_CENTER = { lat: 22.3193, lng: 114.1694 };
const THEME_HEAT = '#F26722';
const THEME_ORANGE_PEEL = '#FEA000';

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
  element.style.background = THEME_HEAT;
  element.style.border = '2px solid #ffffff';
  element.style.boxShadow = '0 8px 18px rgba(242, 103, 34, 0.35)';
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
  const boxContentRef = useRef<HTMLDivElement>(null);
  const boxHeaderRef = useRef<HTMLDivElement>(null);
  const boxMainContentRef = useRef<HTMLDivElement>(null);
  const boxFooterRef = useRef<HTMLDivElement>(null);
  const requestContentRef = useRef<HTMLDivElement>(null);
  const settingsContentRef = useRef<HTMLDivElement>(null);
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
  const previousIsMenuOpen = useRef(false);
  const isDragging = useRef(false);
  const isMobile = useIsMobile();

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
  const [floatingBoxHeight, setFloatingBoxHeight] = useState<number | null>(null);

  // New State for Home/Work feature
  const [savedLocations, setSavedLocations] = useState({ home: '', work: '' });
  const [setupModal, setSetupModal] = useState<'home' | 'work' | null>(null);
  const [setupAddress, setSetupAddress] = useState('');
  const [targetInput, setTargetInput] = useState<FocusedInput | 'menu'>('dropoff');
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const isRouteLoading = routeStatus === 'submitting' || routeStatus === 'polling';
  const isFloatingBoxDraggable = !isMobile;
  const shouldAnimateFloatingBoxHeight = !isMobile && floatingBoxHeight !== null;

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

  const clearAddressInput = useCallback((target: FocusedInput) => {
    setInputValue(target, '');
    setPlaceSuggestions((prev) => ({ ...prev, [target]: [] }));
    resetRouteState();
  }, [resetRouteState, setInputValue]);

  const clearAllInputs = useCallback(() => {
    setPickup('');
    setDropoff('');
    setFocusedInput(null);
    setPlaceSuggestions({ pickup: [], dropoff: [] });
    resetRouteState();
  }, [resetRouteState]);

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

  const measureFloatingBoxHeight = useCallback(() => {
    if (isMobile || !boxHeaderRef.current || !boxMainContentRef.current) {
      setFloatingBoxHeight(null);
      return;
    }

    const viewportHeight = constraintsRef.current?.getBoundingClientRect().height || window.innerHeight;
    const maxHeight = Math.floor(viewportHeight * 0.85);
    const footerHeight = !focusedInput && !isMenuOpen ? boxFooterRef.current?.offsetHeight ?? 0 : 0;
    const activeContent = isMenuOpen ? settingsContentRef.current : requestContentRef.current;
    const pageHeight = activeContent?.scrollHeight || boxMainContentRef.current.scrollHeight;
    const naturalHeight = boxHeaderRef.current.offsetHeight + pageHeight + footerHeight;

    setFloatingBoxHeight(Math.min(Math.ceil(naturalHeight), maxHeight));
  }, [focusedInput, isMenuOpen, isMobile]);

  useLayoutEffect(() => {
    measureFloatingBoxHeight();
  }, [
    focusedInput,
    isMenuOpen,
    isRouteLoading,
    pickup,
    dropoff,
    routeMessage,
    routeSummary,
    currentPlaceSuggestions.length,
    savedLocations.home,
    savedLocations.work,
    measureFloatingBoxHeight,
  ]);

  useEffect(() => {
    if (isMobile) {
      return;
    }

    const frameId = window.requestAnimationFrame(measureFloatingBoxHeight);
    const timerId = window.setTimeout(measureFloatingBoxHeight, 180);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.clearTimeout(timerId);
    };
  }, [focusedInput, isMenuOpen, isMobile, measureFloatingBoxHeight]);

  useEffect(() => {
    if (isMobile) {
      setFloatingBoxHeight(null);
      return;
    }

    const resizeObserver = new ResizeObserver(() => {
      measureFloatingBoxHeight();
    });

    [
      boxHeaderRef.current,
      boxMainContentRef.current,
      boxFooterRef.current,
      requestContentRef.current,
      settingsContentRef.current,
    ].forEach((element) => {
      if (element) {
        resizeObserver.observe(element);
      }
    });

    const frameId = window.requestAnimationFrame(measureFloatingBoxHeight);
    const timerId = window.setTimeout(measureFloatingBoxHeight, 260);

    return () => {
      resizeObserver.disconnect();
      window.cancelAnimationFrame(frameId);
      window.clearTimeout(timerId);
    };
  }, [isMobile, measureFloatingBoxHeight, focusedInput, isMenuOpen]);

  const clampFloatingBoxToBounds = useCallback(() => {
    if (!boxRef.current || !constraintsRef.current || isDragging.current) {
      return;
    }

    const box = boxRef.current.getBoundingClientRect();
    const bounds = constraintsRef.current.getBoundingClientRect();
    const currentY = y.get();
    const currentX = x.get();

    const nativeTop = box.top - currentY;
    const nativeBottom = box.bottom - currentY;
    const nativeLeft = box.left - currentX;
    const nativeRight = box.right - currentX;

    let desiredY = userTargetPos.current.y;
    let desiredX = userTargetPos.current.x;

    if (nativeBottom - nativeTop <= bounds.height + 1) {
      if (nativeBottom + desiredY > bounds.bottom) {
        desiredY = bounds.bottom - nativeBottom;
      }
      if (nativeTop + desiredY < bounds.top) {
        desiredY = bounds.top - nativeTop;
      }
    } else {
      desiredY = bounds.top - nativeTop;
    }

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

    if (currentY !== desiredY) {
      y.set(desiredY);
    }
    if (currentX !== desiredX) {
      x.set(desiredX);
    }
    userTargetPos.current = { x: desiredX, y: desiredY };
  }, [x, y]);

  // Keep a dragged panel in bounds without forcing layout reads during every animation frame.
  useEffect(() => {
    const frameId = window.requestAnimationFrame(clampFloatingBoxToBounds);
    const timerId = window.setTimeout(clampFloatingBoxToBounds, 220);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.clearTimeout(timerId);
    };
  }, [clampFloatingBoxToBounds, setupModal, routeMessage]);

  useEffect(() => {
    if (isMobile) {
      isDragging.current = false;
      x.set(0);
      y.set(0);
      userTargetPos.current = { x: 0, y: 0 };
      previousIsMenuOpen.current = isMenuOpen;
      return;
    }

    if (!isMenuOpen && previousIsMenuOpen.current) {
      userTargetPos.current = { x: x.get(), y: y.get() };
      window.requestAnimationFrame(clampFloatingBoxToBounds);
    }

    previousIsMenuOpen.current = isMenuOpen;
  }, [clampFloatingBoxToBounds, isMenuOpen, isMobile, x, y]);

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
          ref={boxRef}
          style={{ x, y }}
          animate={shouldAnimateFloatingBoxHeight ? { height: floatingBoxHeight } : undefined}
          drag={isFloatingBoxDraggable}
          dragConstraints={constraintsRef}
          dragControls={dragControls}
          dragListener={false}
          dragMomentum={false}
          dragElastic={0.2}
          dragTransition={{ bounceStiffness: 400, bounceDamping: 25 }}
          onDragStart={() => { if (isFloatingBoxDraggable) isDragging.current = true; }}
          onDragEnd={() => {
            isDragging.current = false;
            userTargetPos.current = { x: x.get(), y: y.get() };
          }}
          transition={{ height: { duration: 0.22, ease: [0.22, 1, 0.36, 1] } }}
          className={`bg-white/80 backdrop-blur-xl pointer-events-auto shadow-2xl flex flex-col overflow-hidden absolute border border-white/40 md:top-8 md:right-auto md:bottom-auto md:left-8 md:w-[400px] md:h-auto md:max-h-[85vh] md:rounded-3xl
            ${isMobileFocused
              ? 'inset-0 h-full rounded-none'
              : 'bottom-0 left-0 w-full h-auto mt-auto rounded-t-3xl max-h-[85vh]'
            }
          `}
        >
          <div ref={boxContentRef} className="flex h-full min-h-0 flex-col">
            {/* Header */}
            <div ref={boxHeaderRef} className={`flex shrink-0 items-center justify-between px-4 py-3 md:pt-5 relative ${isMobileFocused ? 'bg-white/60 backdrop-blur-xl' : ''}`}>
            {isMobileFocused ? (
              <button
                onClick={() => { setFocusedInput(null); setIsMenuOpen(false); }}
                aria-label="Back"
                className="p-2 hover:bg-[#FEA000]/15 hover:text-[#F26722] rounded-full transition-colors z-10"
              >
                <ChevronLeft size={24} />
              </button>
            ) : isMenuOpen ? (
              <button
                onClick={() => setIsMenuOpen(false)}
                aria-label="Back"
                className="p-2 hover:bg-[#FEA000]/15 hover:text-[#F26722] rounded-full transition-colors z-10"
              >
                <ChevronLeft size={24} />
              </button>
            ) : (
              <button onClick={() => setIsMenuOpen(true)} aria-label="Open Settings" className="p-2 hover:bg-[#FEA000]/15 hover:text-[#F26722] rounded-full transition-colors z-10">
                <Menu size={24} />
              </button>
            )}

            {/* Universal Drag Indicator */}
            <div
              className={`absolute left-1/2 -translate-x-1/2 top-0 pt-3 pb-3 px-8 touch-none z-10 ${
                isFloatingBoxDraggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'
              }`}
              onPointerDown={(event) => {
                if (isFloatingBoxDraggable) {
                  dragControls.start(event);
                }
              }}
            >
              <div className="w-12 h-1.5 bg-gray-300 rounded-full hover:bg-gray-400 transition-colors" />
            </div>
            </div>

            {/* Main Content */}
            <div ref={boxMainContentRef} className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-transparent relative">
            <AnimatePresence mode="wait" initial={false}>
            {isMenuOpen ? (
              <motion.div
                ref={settingsContentRef}
                key="settings"
                initial={{ opacity: 0, x: -26, scale: 0.98 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: -18, scale: 0.99 }}
                transition={{
                  opacity: { duration: 0.12, ease: "easeOut" },
                  x: { type: "spring", stiffness: 520, damping: 24, mass: 0.65 },
                  scale: { type: "spring", stiffness: 520, damping: 24, mass: 0.65 },
                }}
                className="flex w-full flex-col will-change-transform"
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
                            <div className="w-10 h-10 bg-[#FEA000]/15 rounded-full flex items-center justify-center text-[#F26722]">
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
                            className="text-sm text-[#F26722] font-semibold px-3 py-1.5 hover:bg-[#FEA000]/15 hover:text-[#d95716] rounded-lg transition-colors"
                          >
                            {savedLocations.home ? 'Edit' : 'Add'}
                          </button>
                        </div>

                        <div className="flex items-center justify-between group">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-[#FEA000]/15 rounded-full flex items-center justify-center text-[#F26722]">
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
                            className="text-sm text-[#F26722] font-semibold px-3 py-1.5 hover:bg-[#FEA000]/15 hover:text-[#d95716] rounded-lg transition-colors"
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
                ref={requestContentRef}
                key="request"
                initial={{ opacity: 0, x: 26, scale: 0.98 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: 18, scale: 0.99 }}
                transition={{
                  opacity: { duration: 0.12, ease: "easeOut" },
                  x: { type: "spring", stiffness: 520, damping: 24, mass: 0.65 },
                  scale: { type: "spring", stiffness: 520, damping: 24, mass: 0.65 },
                }}
                className="flex w-full flex-col will-change-transform"
              >
                {/* Ride Request Form */}
                <div className="p-5 flex-shrink-0">
                  {!isMobileFocused && <h1 className="text-2xl font-bold mb-6 hidden md:block">Request a ride</h1>}

              <div className="relative">
                {/* Connecting Line */}
                <div className="absolute left-[23px] top-[26px] bottom-[26px] w-[2px] bg-[#FEA000]/45 z-0"></div>

                <div className="space-y-3 relative z-10">
                  {/* Pickup Input */}
                  <div className="flex items-center gap-4">
                    <div className="flex items-center justify-center w-5">
                      <div className="w-2 h-2 rounded-full bg-[#F26722]"></div>
                    </div>
                    <div className={`flex-1 rounded-xl flex items-center px-4 border transition-all duration-200 ${focusedInput === 'pickup' ? 'bg-white border-transparent ring-2 ring-[#F26722] shadow-sm' : 'bg-white/90 border-gray-200 hover:bg-white hover:border-[#FEA000]/40'}`}>
                      <input
                        ref={pickupInputRef}
                        type="text"
                        placeholder="Starting Location"
                        value={pickup}
                        onChange={(e) => {
                          setPickup(e.target.value);
                          resetRouteState();
                        }}
                        className="min-w-0 flex-1 bg-transparent py-3.5 text-base font-medium focus:outline-none placeholder:text-gray-500 text-black"
                        onFocus={() => setFocusedInput('pickup')}
                      />
                      <button
                        type="button"
                        aria-label="Clear Pickup Location"
                        aria-hidden={!pickup}
                        tabIndex={pickup ? 0 : -1}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => clearAddressInput('pickup')}
                        className={`ml-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-gray-400 transition-all hover:bg-[#FEA000]/20 hover:text-[#F26722] ${
                          pickup ? 'opacity-100 scale-100' : 'pointer-events-none opacity-0 scale-90'
                        }`}
                      >
                        <X size={18} />
                      </button>
                    </div>
                  </div>

                  {/* Dropoff Input */}
                  <div className="flex items-center gap-4">
                    <div className="flex items-center justify-center w-5">
                      <div className="w-2 h-2 bg-[#F26722]"></div>
                    </div>
                    <div className={`flex-1 rounded-xl flex items-center px-4 border transition-all duration-200 ${focusedInput === 'dropoff' ? 'bg-white border-transparent ring-2 ring-[#F26722] shadow-sm' : 'bg-white/90 border-gray-200 hover:bg-white hover:border-[#FEA000]/40'}`}>
                      <input
                        ref={dropoffInputRef}
                        type="text"
                        placeholder="Drop-off Point"
                        value={dropoff}
                        onChange={(e) => {
                          setDropoff(e.target.value);
                          resetRouteState();
                        }}
                        className="min-w-0 flex-1 bg-transparent py-3.5 text-base font-medium focus:outline-none placeholder:text-gray-500 text-black"
                        onFocus={() => setFocusedInput('dropoff')}
                      />
                      <button
                        type="button"
                        aria-label="Clear Drop-Off Location"
                        aria-hidden={!dropoff}
                        tabIndex={dropoff ? 0 : -1}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => clearAddressInput('dropoff')}
                        className={`ml-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-gray-400 transition-all hover:bg-[#FEA000]/20 hover:text-[#F26722] ${
                          dropoff ? 'opacity-100 scale-100' : 'pointer-events-none opacity-0 scale-90'
                        }`}
                      >
                        <X size={18} />
                      </button>
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
                  className="absolute right-4 top-1/2 -translate-y-1/2 bg-white p-2 rounded-full hover:bg-[#fff7ed] shadow-sm border border-[#FEA000]/30 z-20 transition-transform active:scale-95"
                  aria-label="Swap Locations"
                >
                  <ArrowDownUp size={16} className="text-[#F26722]" />
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
                        className="w-full text-left flex items-center gap-4 cursor-pointer hover:bg-[#FEA000]/10 p-3 -mx-3 rounded-xl transition-colors"
                      >
                        <div className="w-10 h-10 bg-[#FEA000]/20 rounded-full flex items-center justify-center text-[#F26722] shrink-0">
                          <Navigation size={20} className="fill-current" />
                        </div>
                        <div className="flex-1 border-b border-gray-100 pb-4 mt-4">
                          <div className="font-semibold text-gray-900 text-base">Current Location</div>
                        </div>
                      </button>
                    )}

                    {/* Home Option */}
                    <button type="button" className="w-full text-left flex items-center gap-4 cursor-pointer hover:bg-[#FEA000]/10 p-3 -mx-3 rounded-xl transition-colors" onClick={() => handleLocationSelect('home')}>
                      <div className="w-10 h-10 bg-[#FEA000]/15 rounded-full flex items-center justify-center text-[#F26722] shrink-0">
                        <Home size={20} />
                      </div>
                      <div className="flex-1 border-b border-gray-100 pb-4 mt-4">
                        <div className="font-semibold text-gray-900 text-base">Home</div>
                        <div className="text-sm text-gray-500 mt-0.5">{savedLocations.home || 'Set Location'}</div>
                      </div>
                    </button>

                    {/* Work Option */}
                    <button type="button" className="w-full text-left flex items-center gap-4 cursor-pointer hover:bg-[#FEA000]/10 p-3 -mx-3 rounded-xl transition-colors" onClick={() => handleLocationSelect('work')}>
                      <div className="w-10 h-10 bg-[#FEA000]/15 rounded-full flex items-center justify-center text-[#F26722] shrink-0">
                        <Briefcase size={20} />
                      </div>
                      <div className="flex-1 border-b border-gray-100 pb-4 mt-4">
                        <div className="font-semibold text-gray-900 text-base">Work</div>
                        <div className="text-sm text-gray-500 mt-0.5">{savedLocations.work || 'Set Location'}</div>
                      </div>
                    </button>

                    {/* Recent & Suggested Places */}
                    <button type="button" onClick={() => handleSuggestionSelect(focusedInput, 'Hong Kong International Airport Terminal 1')} className="w-full text-left flex items-center gap-4 cursor-pointer hover:bg-[#FEA000]/10 p-3 -mx-3 rounded-xl transition-colors">
                      <div className="w-10 h-10 bg-[#FEA000]/15 rounded-full flex items-center justify-center text-[#F26722] shrink-0">
                        <Clock size={20} />
                      </div>
                      <div className="flex-1 border-b border-gray-100 pb-4 mt-4">
                        <div className="font-semibold text-gray-900 text-base">Hong Kong International Airport Terminal 1</div>
                        <div className="text-sm text-gray-500 mt-0.5">Chek Lap Kok, Hong Kong</div>
                      </div>
                    </button>

                    <button type="button" onClick={() => handleSuggestionSelect(focusedInput, 'Innocentre, Hong Kong')} className="w-full text-left flex items-center gap-4 cursor-pointer hover:bg-[#FEA000]/10 p-3 -mx-3 rounded-xl transition-colors">
                      <div className="w-10 h-10 bg-[#FEA000]/15 rounded-full flex items-center justify-center text-[#F26722] shrink-0">
                        <MapPin size={20} />
                      </div>
                      <div className="flex-1 border-b border-gray-100 pb-4 mt-4">
                        <div className="font-semibold text-gray-900 text-base">Innocentre</div>
                        <div className="text-sm text-gray-500 mt-0.5">Kowloon Tong, Hong Kong</div>
                      </div>
                    </button>

                    <button type="button" onClick={() => handleSuggestionSelect(focusedInput, 'Central, Hong Kong')} className="w-full text-left flex items-center gap-4 cursor-pointer hover:bg-[#FEA000]/10 p-3 -mx-3 rounded-xl transition-colors">
                      <div className="w-10 h-10 bg-[#FEA000]/15 rounded-full flex items-center justify-center text-[#F26722] shrink-0">
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
                        className="w-full text-left flex items-center gap-4 cursor-pointer hover:bg-[#FEA000]/10 p-3 -mx-3 rounded-xl transition-colors"
                      >
                        <div className="w-10 h-10 bg-[#FEA000]/15 rounded-full flex items-center justify-center text-[#F26722] shrink-0">
                          <MapPin size={20} />
                        </div>
                        <div className="flex-1 border-b border-gray-100 pb-4 mt-4 min-w-0">
                          <div className="font-semibold text-gray-900 text-base truncate">{suggestion.label}</div>
                          <div className="text-sm text-gray-500 mt-0.5 truncate">{suggestion.secondary || suggestion.address}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>

            {/* Fill space in mobile if not enough content */}
            {isMobileFocused && <div className="flex-1 bg-gray-50/50"></div>}
            </motion.div>
            )}
            </AnimatePresence>
            </div>

            {/* Footer Actions */}
            <AnimatePresence mode="popLayout" initial={false}>
          {!focusedInput && !isMenuOpen && (
            <motion.div
              ref={boxFooterRef}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.08, ease: "easeOut" }}
              className="p-5 bg-white/55 backdrop-blur-xl border-t border-white/50 rounded-b-3xl w-full"
            >
              {routeMessage && (
                <div className={`mb-3 rounded-xl px-4 py-3 text-sm font-semibold ${
                  routeStatus === 'error'
                    ? 'bg-red-50 text-red-700'
                    : routeStatus === 'success'
                      ? 'bg-green-50 text-green-700'
                      : 'bg-gray-100 text-gray-700'
                }`}>
                  {routeStatus === 'error' && <span aria-hidden="true">⚠︎ </span>}
                  {routeMessage}
                  {routeSummary && (
                    <div className="mt-1 text-xs font-medium opacity-80">
                      Distance {formatRouteMetric(routeSummary.totalDistance)} | Time {formatRouteMetric(routeSummary.totalTime)}
                    </div>
                  )}
                </div>
              )}
              <div className="flex gap-3">
                <button
                  onClick={clearAllInputs}
                  disabled={isRouteLoading || (!pickup && !dropoff && !routeMessage)}
                  className="shrink-0 bg-red-50 text-red-700 px-4 py-4 rounded-xl font-bold text-base shadow-sm transition-all hover:bg-red-100 hover:text-red-800 hover:shadow-md active:scale-[0.98] active:bg-red-200 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400 disabled:shadow-none disabled:hover:bg-gray-100 disabled:hover:text-gray-400 disabled:hover:shadow-none disabled:active:scale-100"
                >
                  Clear All
                </button>
                <button
                  onClick={handleSearchRides}
                  disabled={isRouteLoading}
                  className="flex-1 min-w-0 bg-[#F26722] text-white py-4 rounded-xl font-bold text-lg shadow-lg shadow-[#F26722]/25 transition-all hover:bg-[#d95716] hover:shadow-[#F26722]/35 active:scale-[0.98] active:bg-[#c94c10] disabled:cursor-not-allowed disabled:bg-gray-500 disabled:shadow-none disabled:active:scale-100"
                >
                  {isRouteLoading ? 'Searching...' : 'Search Routes'}
                </button>
              </div>
            </motion.div>
          )}
            </AnimatePresence>
          </div>
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
              className="w-full bg-gray-100 rounded-xl px-4 py-3.5 text-base font-medium focus:outline-none focus:ring-2 focus:ring-[#F26722] mb-6 text-black placeholder:text-gray-500"
            />

            <div className="flex gap-3">
              <button
                onClick={() => setSetupModal(null)}
                className="flex-1 py-3 bg-gray-100 hover:bg-[#FEA000]/15 hover:text-[#F26722] text-gray-800 rounded-xl font-semibold transition-colors"
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
                className="flex-1 py-3 bg-[#F26722] hover:bg-[#d95716] active:bg-[#c94c10] text-white rounded-xl font-semibold transition-colors"
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
