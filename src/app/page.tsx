"use client";

import { Card } from "@/components/ui/card";
import {
  APIProvider,
  Map,
  Marker,
  useMapsLibrary,
  useMap,
} from "@vis.gl/react-google-maps";
import React, { useRef, useEffect } from "react";

const SUCURSAL = { lat: 40.7128, lng: -74.006 };
const CLIENTE = { lat: 40.758, lng: -73.985 };

const MOCK = {
  distancia: "2.5 km",
  radio: "R2",
  zona: "A",
  horario: "Normal",
  total: "$2.00",
};

const Directions: React.FC = () => {
  const map = useMap();
  const routesLibrary = useMapsLibrary("routes");
  const serviceRef = useRef<google.maps.DirectionsService | null>(null);
  const rendererRef = useRef<google.maps.DirectionsRenderer | null>(null);

  useEffect(() => {
    if (!routesLibrary || !map) return;

    serviceRef.current = new routesLibrary.DirectionsService();
    rendererRef.current = new routesLibrary.DirectionsRenderer({ map });

    serviceRef.current.route(
      {
        origin: SUCURSAL,
        destination: CLIENTE,
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
  }, [routesLibrary, map]);

  return null;
};

export default function Home() {
  return (
    <APIProvider apiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY!}>
      <div style={{ display: "flex", height: "100vh", width: "100vw" }}>
        {/* MAPA */}
        <div style={{ flex: "0 0 65%" }}>
          <Map
            defaultCenter={SUCURSAL}
            defaultZoom={13}
            style={{ height: "100%", width: "100%" }}
          >
            <Marker position={SUCURSAL} label="S" />
            <Marker position={CLIENTE} label="C" />
            <Directions />
          </Map>
        </div>

        {/* CALCULADORA */}
        <Card
          style={{
            flex: "0 0 35%",
            padding: "32px 24px",
            backgroundColor: "#f9fafb",
            display: "flex",
            flexDirection: "column",
            gap: "16px",
            borderLeft: "1px solid #e5e7eb",
          }}
        >
          <h2 style={{ fontSize: "20px", fontWeight: "700", color: "#111827" }}>
            Cálculo de Tarifa
          </h2>

          {/* Datos */}
          <div
            style={{ display: "flex", flexDirection: "column", gap: "12px" }}
          >
            <Row emoji="📍" label="Distancia" value={MOCK.distancia} />
            <Row emoji="🔵" label="Radio" value={MOCK.radio} />
            <Row emoji="🏘️" label="Zona" value={MOCK.zona} />
            <Row emoji="🕐" label="Horario" value={MOCK.horario} />
          </div>

          <hr style={{ borderColor: "#e5e7eb" }} />

          {/* Total */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span
              style={{ fontSize: "18px", fontWeight: "600", color: "#374151" }}
            >
              Total
            </span>
            <span
              style={{ fontSize: "28px", fontWeight: "800", color: "#16a34a" }}
            >
              {MOCK.total}
            </span>
          </div>

          {/* Botón */}
          <button
            style={{
              marginTop: "auto",
              padding: "14px",
              backgroundColor: "#16a34a",
              color: "white",
              border: "none",
              borderRadius: "10px",
              fontSize: "16px",
              fontWeight: "600",
              cursor: "pointer",
            }}
            onClick={() => alert("Tarifa aceptada ✅")}
          >
            ✓ Aceptar
          </button>
        </Card>
      </div>
    </APIProvider>
  );
}

function Row({
  emoji,
  label,
  value,
}: {
  emoji: string;
  label: string;
  value: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
      }}
    >
      <span style={{ color: "#6b7280" }}>
        {emoji} {label}
      </span>
      <span style={{ fontWeight: "600", color: "#111827" }}>{value}</span>
    </div>
  );
}
