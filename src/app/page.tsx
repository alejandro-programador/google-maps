"use client";

import {
  APIProvider,
  Map,
  Marker,
  useMapsLibrary,
  useMap,
} from "@vis.gl/react-google-maps";
import React, {
  useRef,
  useEffect,
  useState,
  useCallback,
  Suspense,
} from "react";
import { useRouter } from "next/navigation";
import { useQueryObject } from "@/hooks/useQueryObject";

// ─── Tipos ────────────────────────────────────────────────────────────────────

type Coord = { lat: number; lng: number };

type RateResponse =
  | {
      available: true;
      branch: string;
      distance_km: number;
      radius: string;
      base_rate: number;
      surcharge: number;
      total: number;
      restriction: string | null;
    }
  | {
      available: false;
      branch: string;
      reason: string;
    }
  | null;

// ─── Sedes (para encontrar la más cercana en el frontend) ─────────────────────

const BRANCHES: { name: string; center: Coord }[] = [
  { name: "Maracay", center: { lat: 10.262492, lng: -67.58838 } },
  { name: "Valencia", center: { lat: 10.258993, lng: -67.960158 } },
  { name: "Barquisimeto", center: { lat: 10.071671, lng: -69.293337 } },
  { name: "Caracas - La Florida", center: { lat: 10.500444, lng: -66.875794 } },
  { name: "Caracas - Catia", center: { lat: 10.511712, lng: -66.943495 } },
];

// Centro de Venezuela como fallback si no hay geolocalización
const CARACAS_CENTER: Coord = { lat: 10.500444, lng: -66.875794 };

function haversineKm(a: Coord, b: Coord): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(h));
}

function closestBranch(client: Coord) {
  return BRANCHES.reduce((prev, curr) =>
    haversineKm(client, curr.center) < haversineKm(client, prev.center)
      ? curr
      : prev,
  );
}

// ─── Componente de ruta ───────────────────────────────────────────────────────

const Directions: React.FC<{ origin: Coord; destination: Coord }> = ({
  origin,
  destination,
}) => {
  const map = useMap();
  const routesLibrary = useMapsLibrary("routes");
  const serviceRef = useRef<google.maps.DirectionsService | null>(null);
  const rendererRef = useRef<google.maps.DirectionsRenderer | null>(null);

  useEffect(() => {
    if (!routesLibrary || !map) return;
    if (!serviceRef.current) {
      serviceRef.current = new routesLibrary.DirectionsService();
    }
    if (!rendererRef.current) {
      rendererRef.current = new routesLibrary.DirectionsRenderer({
        map,
        suppressMarkers: true, // usamos nuestros propios markers
      });
    } else {
      rendererRef.current.setMap(map);
    }

    serviceRef.current.route(
      {
        origin,
        destination,
        travelMode: google.maps.TravelMode.DRIVING,
      },
      (result, status) => {
        if (status === "OK" && rendererRef.current) {
          rendererRef.current.setDirections(result);
        }
      },
    );

    return () => {
      rendererRef.current?.setMap(null);
    };
  }, [routesLibrary, map, origin, destination]);

  return null;
};

// ─── Mapa con pin arrastrable ─────────────────────────────────────────────────

const DraggableMap: React.FC<{
  clientCoord: Coord;
  branchCoord: Coord;
  onDragEnd: (coord: Coord) => void;
  initialZoom?: number;
}> = ({ clientCoord, branchCoord, onDragEnd, initialZoom = 13 }) => {
  return (
    <Map
      defaultCenter={clientCoord}
      defaultZoom={initialZoom}
      style={{ height: "100%", width: "100%" }}
    >
      {/* Pin sucursal — azul, fijo */}
      <Marker
        position={branchCoord}
        label={{ text: "S", color: "white", fontWeight: "bold" }}
        title="Sucursal"
      />

      {/* Pin cliente — rojo, arrastrable */}
      <Marker
        position={clientCoord}
        draggable
        title="Arrastra para cambiar ubicación"
        onDragEnd={(e) => {
          if (e.latLng) {
            onDragEnd({ lat: e.latLng.lat(), lng: e.latLng.lng() });
          }
        }}
      />

      <Directions origin={branchCoord} destination={clientCoord} />
    </Map>
  );
};

// ─── Page principal ───────────────────────────────────────────────────────────
export const dynamic = "force-dynamic";

export default function Home() {
  const params = useQueryObject({ email: "0" });

  const router = useRouter();
  const [clientCoord, setClientCoord] = useState<Coord | null>(null);
  const [geoPermission, setGeoPermission] = useState<
    "pending" | "granted" | "denied"
  >("pending");
  const [rate, setRate] = useState<RateResponse>(null);
  const [loadingRate, setLoadingRate] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Geolocalización al montar
  useEffect(() => {
    if (!navigator.geolocation) {
      setGeoPermission("denied");
      setClientCoord(CARACAS_CENTER);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeoPermission("granted");
        setClientCoord({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      () => {
        setGeoPermission("denied");
        setClientCoord(CARACAS_CENTER);
      },
    );
  }, []);

  // Calcular tarifa cuando cambia el pin (en segundo plano, sin UI)
  const calcularTarifa = useCallback(async (coord: Coord) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoadingRate(true);
      try {
        const res = await fetch(
          `/api/location?latitude=${coord.lat}&longitude=${coord.lng}`,
        );
        const data = await res.json();
        setRate(data);
      } catch {
        setRate(null);
      } finally {
        setLoadingRate(false);
      }
    }, 400); // debounce 400ms para no spamear mientras arrastra
  }, []);

  // Calcular al recibir coordenada inicial
  useEffect(() => {
    if (clientCoord) calcularTarifa(clientCoord);
  }, [clientCoord, calcularTarifa]);

  const handleDragEnd = (coord: Coord) => {
    setClientCoord(coord);
    calcularTarifa(coord);
  };

  const handleContinuar = () => {
    if (!rate || !rate.available) return;

    // Serializar datos de la tarifa y coordenadas para pasar a la siguiente página
    const queryParams = new URLSearchParams({
      step: "2",
      email: params.email ?? "",
      distance_km: String(rate.distance_km),
      radius: rate.radius,
      base_rate: String(rate.base_rate),
      surcharge: String(rate.surcharge),
      total: String(rate.total),
      restriction: rate.restriction ?? "",
      lat: String(clientCoord!.lat),
      lng: String(clientCoord!.lng),
    });

    router.push(
      `https://web.chefmargaro.com/checkout?${queryParams.toString()}`,
    );
  };

  const branch = clientCoord ? closestBranch(clientCoord) : null;

  if (!params.email) {
    return <div>No se proporcionó un correo electrónico.</div>;
  }

  return (
    <Suspense fallback={<div>Cargando...</div>}>
      <APIProvider apiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY!}>
        <div
          style={{
            display: "flex",
            height: "100vh",
            width: "100vw",
            position: "relative",
          }}
        >
          {/* MAPA — ahora ocupa todo el ancho */}
          <div style={{ flex: "1", position: "relative" }}>
            {clientCoord && branch ? (
              <DraggableMap
                clientCoord={clientCoord}
                branchCoord={branch.center}
                onDragEnd={handleDragEnd}
                initialZoom={geoPermission === "denied" ? 6 : 13}
              />
            ) : (
              <div
                style={{
                  height: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: "#f3f4f6",
                  flexDirection: "column",
                  gap: "12px",
                  color: "#6b7280",
                }}
              >
                <div style={{ fontSize: "40px" }}>🗺️</div>
                <p style={{ margin: 0, fontSize: "16px" }}>
                  Obteniendo ubicación...
                </p>
              </div>
            )}

            {/* Banner si denegó permisos */}
            {geoPermission === "denied" && (
              <div
                style={{
                  position: "absolute",
                  top: "16px",
                  left: "50%",
                  transform: "translateX(-50%)",
                  backgroundColor: "#fffbeb",
                  border: "1px solid #fcd34d",
                  borderRadius: "8px",
                  padding: "10px 16px",
                  fontSize: "13px",
                  color: "#92400e",
                  whiteSpace: "nowrap",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
                  zIndex: 10,
                }}
              >
                📍 Ubicación no disponible — arrastra el pin rojo para
                posicionarte
              </div>
            )}

            {/* ─── BOTÓN CONTINUAR (parte inferior del mapa) ───────────── */}
            <div
              style={{
                position: "absolute",
                bottom: "24px",
                left: "50%",
                transform: "translateX(-50%)",
                zIndex: 20,
                width: "90%",
                maxWidth: "400px",
              }}
            >
              <button
                onClick={handleContinuar}
                disabled={!rate || !rate.available || loadingRate}
                style={{
                  width: "100%",
                  padding: "18px 32px",
                  fontSize: "16px",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  color: "#ffffff",
                  backgroundColor:
                    !rate || !rate.available || loadingRate
                      ? "#9ca3af"
                      : "#2563eb",
                  border: "none",
                  borderRadius: "14px",
                  cursor:
                    !rate || !rate.available || loadingRate
                      ? "not-allowed"
                      : "pointer",
                  transition: "all 0.2s ease",
                  boxShadow:
                    !rate || !rate.available || loadingRate
                      ? "none"
                      : "0 6px 20px rgba(37, 99, 235, 0.4)",
                }}
                onMouseEnter={(e) => {
                  if (rate && rate.available && !loadingRate) {
                    e.currentTarget.style.backgroundColor = "#1d4ed8";
                    e.currentTarget.style.transform = "translateY(-2px)";
                    e.currentTarget.style.boxShadow =
                      "0 8px 25px rgba(37, 99, 235, 0.5)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (rate && rate.available && !loadingRate) {
                    e.currentTarget.style.backgroundColor = "#2563eb";
                    e.currentTarget.style.transform = "translateY(0)";
                    e.currentTarget.style.boxShadow =
                      "0 6px 20px rgba(37, 99, 235, 0.4)";
                  }
                }}
              >
                {loadingRate ? "Calculando..." : "Continuar"}
              </button>

              {/* Mensaje si no está disponible */}
              {rate && !rate.available && (
                <div
                  style={{
                    marginTop: "10px",
                    padding: "10px 14px",
                    backgroundColor: "#fef2f2",
                    border: "1px solid #fecaca",
                    borderRadius: "10px",
                    textAlign: "center",
                    fontSize: "13px",
                    color: "#991b1b",
                  }}
                >
                  ❌ {rate.reason}
                </div>
              )}
            </div>
          </div>
        </div>
      </APIProvider>
    </Suspense>
  );
}
