// hooks/useQueryObject.ts
"use client";

import { useSearchParams } from "next/navigation";

export function useQueryObject<T extends Record<string, string>>(
  defaultValues?: T,
) {
  const searchParams = useSearchParams();

  // Convertimos los searchParams a un objeto simple
  const queryObj = Object.fromEntries(searchParams.entries()) as T;

  return { ...defaultValues, ...queryObj };
}
