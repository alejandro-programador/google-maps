// src/app/api/location/route.ts
import { NextRequest, NextResponse } from "next/server";
import sedesRaw from "@/data/sedes-data.json";

// ─── Tipos ────────────────────────────────────────────────────────────────────

type Coord = { lat: number; lng: number };
type Polygon = { name: string; coords: [number, number][] };
type Sede = { name: string; center: Coord; polygons: Polygon[] };

type TarifaResponse =
  | {
      disponible: true;
      sede: string;
      distancia_km: number;
      radio: string;
      tarifa_base: number;
      recargo: number;
      total: number;
      restriccion: string | null;
    }
  | {
      disponible: false;
      sede: string;
      motivo: string;
    };

// ─── Nombres legibles por sede ────────────────────────────────────────────────

const SEDE_NOMBRES: Record<string, string> = {
  maracay: "Maracay",
  valencia: "Valencia",
  barquisimeto: "Barquisimeto",
  caracas_florida: "Caracas - La Florida",
  caracas_catia: "Caracas - Catia",
};

// ─── Cargar sedes desde JSON ──────────────────────────────────────────────────

const SEDES: Sede[] = Object.entries(sedesRaw).map(([key, value]) => ({
  name: SEDE_NOMBRES[key] ?? key,
  center: value.center as Coord,
  polygons: value.polygons as Polygon[],
}));

// ─── Tabla de tarifas ─────────────────────────────────────────────────────────

const RADIOS = [
  { nombre: "R1", min: 0, max: 1, tarifa: 1 },
  { nombre: "R2", min: 1, max: 3, tarifa: 2 },
  { nombre: "R3", min: 3, max: 6, tarifa: 4 },
  { nombre: "R4", min: 6, max: 9, tarifa: 6 },
  { nombre: "R5", min: 9, max: 12, tarifa: 8 },
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
 *  coords = array de [lng, lat] tal como vienen del KML
 */
function puntoDentroDePoligono(
  punto: Coord,
  poligono: [number, number][],
): boolean {
  if (poligono.length < 3) return false;
  let dentro = false;
  const px = punto.lng;
  const py = punto.lat;
  for (let i = 0, j = poligono.length - 1; i < poligono.length; j = i++) {
    const xi = poligono[i][0]; // lng
    const yi = poligono[i][1]; // lat
    const xj = poligono[j][0];
    const yj = poligono[j][1];
    const intersecta =
      yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersecta) dentro = !dentro;
  }
  return dentro;
}

/** Parsea la hora límite desde el nombre del polígono → minutos desde medianoche */
function parsearHoraLimite(nombre: string): number | null {
  const upper = nombre.toUpperCase();
  const match = upper.match(/(\d{1,2})(?::(\d{2}))?\s*PM/);
  if (!match) return null;
  const hora = parseInt(match[1]);
  const minutos = match[2] ? parseInt(match[2]) : 0;
  const hora24 = hora === 12 ? 12 : hora + 12;
  return hora24 * 60 + minutos;
}

/** Clasifica el polígono según su nombre */
function clasificarPoligono(
  nombre: string,
): "no_llega" | "restriccion_hora" | "recargo" | "limite" | "otro" {
  const upper = nombre.toUpperCase();
  if (
    upper.includes("NO LLEGAMOS") ||
    upper.includes("NO LLEGA") ||
    upper.includes("PELIGROSO") ||
    upper.includes("ZONA ROJA")
  )
    return "no_llega";
  if (
    upper.includes("RESTRINGIDO") ||
    upper.includes("RESTRINGIDA") ||
    upper.includes("LLEGAMOS HASTA") ||
    upper.includes("RESTRICCION") ||
    upper.includes("RESTRICCIÓN")
  )
    return "restriccion_hora";
  if (upper.includes("+1$") || upper.includes("ADICIONAL")) return "recargo";
  if (
    upper.includes("LIMITE") ||
    upper.includes("LÍMITE") ||
    upper.includes("ZONAS LIMITES")
  )
    return "limite";
  return "otro";
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const latParam = searchParams.get("latitude");
  const lngParam = searchParams.get("longitude");

  if (!latParam || !lngParam) {
    return NextResponse.json(
      { error: "Se requieren los parámetros latitude y longitude" },
      { status: 400 },
    );
  }

  const lat = parseFloat(latParam);
  const lng = parseFloat(lngParam);

  if (isNaN(lat) || isNaN(lng)) {
    return NextResponse.json(
      { error: "latitude y longitude deben ser números válidos" },
      { status: 400 },
    );
  }

  const cliente: Coord = { lat, lng };

  // 1. Sede más cercana
  const sedeConDistancia = SEDES.map((sede) => ({
    sede,
    distancia: haversineKm(cliente, sede.center),
  })).sort((a, b) => a.distancia - b.distancia)[0];

  const { sede, distancia } = sedeConDistancia;
  const distanciaKm = Math.round(distancia * 100) / 100;

  // 2. Fuera de cobertura
  if (distanciaKm > 12) {
    return NextResponse.json<TarifaResponse>({
      disponible: false,
      sede: sede.name,
      motivo: `Fuera del área de cobertura (${distanciaKm} km). Máximo 12 km.`,
    });
  }

  // 3. Radio tarifario
  const radio = RADIOS.find((r) => distanciaKm >= r.min && distanciaKm < r.max);
  if (!radio) {
    return NextResponse.json<TarifaResponse>({
      disponible: false,
      sede: sede.name,
      motivo: "No se pudo determinar el radio tarifario.",
    });
  }

  // 4. Hora Venezuela (UTC-4)
  const ahora = new Date();
  const horaVE = new Date(ahora.getTime() - 4 * 60 * 60 * 1000);
  const minutosActuales = horaVE.getUTCHours() * 60 + horaVE.getUTCMinutes();
  const horaStr = `${horaVE.getUTCHours()}:${String(horaVE.getUTCMinutes()).padStart(2, "0")}`;

  // 5. Verificar polígonos
  let recargo = 0;
  let restriccionActiva: string | null = null;
  let noLlega = false;

  for (const poligono of sede.polygons) {
    if (poligono.coords.length < 3) continue;

    const estaDentro = puntoDentroDePoligono(cliente, poligono.coords);
    if (!estaDentro) continue;

    const tipo = clasificarPoligono(poligono.name);

    if (tipo === "no_llega") {
      noLlega = true;
      restriccionActiva = poligono.name;
      break;
    }

    if (tipo === "recargo") {
      recargo += 1;
      restriccionActiva = poligono.name;
    }

    if (tipo === "restriccion_hora") {
      const horaLimite = parsearHoraLimite(poligono.name);
      if (horaLimite !== null && minutosActuales >= horaLimite) {
        noLlega = true;
        restriccionActiva = `${poligono.name} (hora VE: ${horaStr})`;
        break;
      }
    }
  }

  if (noLlega) {
    return NextResponse.json<TarifaResponse>({
      disponible: false,
      sede: sede.name,
      motivo: restriccionActiva ?? "Zona no disponible",
    });
  }

  // 6. Total
  const total = radio.tarifa + recargo;

  return NextResponse.json<TarifaResponse>({
    disponible: true,
    sede: sede.name,
    distancia_km: distanciaKm,
    radio: radio.nombre,
    tarifa_base: radio.tarifa,
    recargo,
    total,
    restriccion: restriccionActiva,
  });
}
