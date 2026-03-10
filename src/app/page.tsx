"use client";

import {
  APIProvider,
  Map,
  Marker,
  useMapsLibrary,
  useMap,
} from "@vis.gl/react-google-maps";
import React, { useRef, useEffect } from "react";

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
        origin: { lat: 40.7128, lng: -74.006 },
        destination: { lat: 40.758, lng: -73.985 },
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
      <Map
        defaultCenter={{ lat: 40.7128, lng: -74.006 }}
        defaultZoom={12}
        style={{ height: "100vh", width: "100vw" }}
      >
        <Marker position={{ lat: 40.7128, lng: -74.006 }} label="Sucursal" />
        <Directions />
      </Map>
    </APIProvider>
  );
}
