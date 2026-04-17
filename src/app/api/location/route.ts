// src/app/api/location/route.ts
import { NextRequest, NextResponse } from "next/server";
import branchesRaw from "@/data/sedes-data.json";

// ─── Tipos ────────────────────────────────────────────────────────────────────

type Coord = { lat: number; lng: number };
type Polygon = { name: string; coords: [number, number][] };
type Branch = { name: string; center: Coord; polygons: Polygon[] };

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
    };

const BRANCH_NAMES: Record<string, string> = {
  maracay: "Maracay",
  valencia: "Valencia",
  barquisimeto: "Barquisimeto",
  caracas_florida: "Caracas - La Florida",
  caracas_catia: "Caracas - Catia",
};

// ─── Cargar sedes desde JSON ──────────────────────────────────────────────────

const BRANCHES: Branch[] = Object.entries(branchesRaw).map(([key, value]) => ({
  name: BRANCH_NAMES[key] ?? key,
  center: value.center as Coord,
  polygons: value.polygons as Polygon[],
}));

// ─── Tabla de tarifas ─────────────────────────────────────────────────────────

const RADII = [
  { name: "R1", min: 0, max: 1, rate: 1 },
  { name: "R2", min: 1, max: 3, rate: 2 },
  { name: "R3", min: 3, max: 6, rate: 4 },
  { name: "R4", min: 6, max: 9, rate: 6 },
  { name: "R5", min: 9, max: 12, rate: 8 },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Distancia Haversine entre dos coordenadas en km */
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

/** Ray casting: punto dentro de polígono
 * coords = array de [lng, lat] tal como vienen del KML
 */
function isPointInPolygon(point: Coord, polygon: [number, number][]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  const px = point.lng;
  const py = point.lat;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0]; // lng
    const yi = polygon[i][1]; // lat
    const xj = polygon[j][0];
    const yj = polygon[j][1];
    const intersect =
      yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Parsea la hora límite desde el nombre del polígono → minutos desde medianoche */
function parseLimitTime(name: string): number | null {
  const upper = name.toUpperCase();
  const match = upper.match(/(\d{1,2})(?::(\d{2}))?\s*PM/);
  if (!match) return null;
  const hour = parseInt(match[1]);
  const minutes = match[2] ? parseInt(match[2]) : 0;
  const hour24 = hour === 12 ? 12 : hour + 12;
  return hour24 * 60 + minutes;
}

/** Clasifica el polígono según su nombre */
function classifyPolygon(
  name: string,
): "no_delivery" | "time_restriction" | "surcharge" | "limit" | "other" {
  const upper = name.toUpperCase();
  if (
    upper.includes("NO LLEGAMOS") ||
    upper.includes("NO LLEGA") ||
    upper.includes("PELIGROSO") ||
    upper.includes("ZONA ROJA")
  )
    return "no_delivery";
  if (
    upper.includes("RESTRINGIDO") ||
    upper.includes("RESTRINGIDA") ||
    upper.includes("LLEGAMOS HASTA") ||
    upper.includes("RESTRICCION") ||
    upper.includes("RESTRICCIÓN")
  )
    return "time_restriction";
  if (upper.includes("+1$") || upper.includes("ADICIONAL")) return "surcharge";
  if (
    upper.includes("LIMITE") ||
    upper.includes("LÍMITE") ||
    upper.includes("ZONAS LIMITES")
  )
    return "limit";
  return "other";
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const latParam = searchParams.get("latitude");
  const lngParam = searchParams.get("longitude");

  if (!latParam || !lngParam) {
    return NextResponse.json(
      { error: "Latitude and longitude parameters are required" },
      { status: 400 },
    );
  }

  const lat = parseFloat(latParam);
  const lng = parseFloat(lngParam);

  if (isNaN(lat) || isNaN(lng)) {
    return NextResponse.json(
      { error: "Latitude and longitude must be valid numbers" },
      { status: 400 },
    );
  }

  const client: Coord = { lat, lng };

  // 1. Sede más cercana
  const branchWithDistance = BRANCHES.map((branch) => ({
    branch,
    distance: haversineKm(client, branch.center),
  })).sort((a, b) => a.distance - b.distance)[0];

  const { branch, distance } = branchWithDistance;
  const distanceKm = Math.round(distance * 100) / 100;

  // 2. Fuera de cobertura
  if (distanceKm > 12) {
    return NextResponse.json<RateResponse>({
      available: false,
      branch: branch.name,
      reason: `Outside coverage area (${distanceKm} km). Maximum 12 km.`,
    });
  }

  // 3. Radio tarifario
  const radius = RADII.find((r) => distanceKm >= r.min && distanceKm < r.max);
  if (!radius) {
    return NextResponse.json<RateResponse>({
      available: false,
      branch: branch.name,
      reason: "Could not determine the rate radius.",
    });
  }

  // 4. Hora Venezuela (UTC-4)
  const now = new Date();
  const venezuelaTime = new Date(now.getTime() - 4 * 60 * 60 * 1000);
  const currentMinutes =
    venezuelaTime.getUTCHours() * 60 + venezuelaTime.getUTCMinutes();
  const timeStr = `${venezuelaTime.getUTCHours()}:${String(venezuelaTime.getUTCMinutes()).padStart(2, "0")}`;

  // 5. Verificar polígonos
  let surcharge = 0;
  let activeRestriction: string | null = null;
  let noDelivery = false;

  for (const polygon of branch.polygons) {
    if (polygon.coords.length < 3) continue;

    const isInside = isPointInPolygon(client, polygon.coords);
    if (!isInside) continue;

    const type = classifyPolygon(polygon.name);

    if (type === "no_delivery") {
      noDelivery = true;
      activeRestriction = polygon.name;
      break;
    }

    if (type === "surcharge") {
      surcharge += 1;
      activeRestriction = polygon.name;
    }

    if (type === "time_restriction") {
      const limitTime = parseLimitTime(polygon.name);
      if (limitTime !== null && currentMinutes >= limitTime) {
        noDelivery = true;
        activeRestriction = `${polygon.name} (VE time: ${timeStr})`;
        break;
      }
    }
  }

  if (noDelivery) {
    return NextResponse.json<RateResponse>({
      available: false,
      branch: branch.name,
      reason: activeRestriction ?? "Zone not available",
    });
  }

  // 6. Total
  const total = radius.rate + surcharge;

  return NextResponse.json<RateResponse>({
    available: true,
    branch: branch.name,
    distance_km: distanceKm,
    radius: radius.name,
    base_rate: radius.rate,
    surcharge,
    total,
    restriction: activeRestriction,
  });
}
