
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useIsMobile } from "@/hooks/use-mobile";
import { useScopedProperties } from "@/hooks/useVisibleProperties";
import { PropertyCard } from "@/components/PropertyCard";
import { supabase } from "@/lib/supabase";

type Property = {
  id: string;
  name: string;
  address: string | null;
  designation: string | null;
  unit_count: number | null;
  image_url: string | null;
  created_at: string | null;
  created_by: string | null;
};

type PropertyObject = {
  id: string;
  property_id: string;
};

const PROPERTY_COLUMNS =
  "id, name, address, designation, unit_count, image_url, created_at, created_by";

const C = {
  text: "#1a1a1a",
  secondary: "#6B7280",
  border: "#E5E7EB",
};

export const Route = createFileRoute("/_authenticated/objects/")({
  head: () => ({ meta: [{ title: "Objekt — BAYT" }] }),
  component: ObjectsOverviewPage,
});

function ObjectsOverviewPage() {
  const isMobile = useIsMobile();
  const navigate = useNavigate();

  const { properties, allowedIds, isLoading } =
    useScopedProperties<Property>(PROPERTY_COLUMNS);

  const objectsQuery = useQuery({
    queryKey: ["objects-overview-counts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("property_objects")
        .select("id, property_id");

      if (error) throw error;
      return (data ?? []) as PropertyObject[];
    },
  });

  const visibleProperties = useMemo(
    () =>
      allowedIds === null
        ? properties
        : properties.filter((property) => allowedIds.has(property.id)),
    [properties, allowedIds],
  );

  const counts = useMemo(() => {
    const result = new Map<string, number>();

    for (const object of objectsQuery.data ?? []) {
      result.set(
        object.property_id,
        (result.get(object.property_id) ?? 0) + 1,
      );
    }

    return result;
  }, [objectsQuery.data]);

  return (
    <div style={{ padding: isMobile ? 16 : 32 }}>
      <h1
        style={{
          margin: "0 0 8px",
          fontSize: isMobile ? 24 : 28,
          fontWeight: 700,
          color: C.text,
          fontFamily: "Outfit, Inter, system-ui, sans-serif",
        }}
      >
        Objekt
      </h1>

      <p style={{ margin: "0 0 24px", color: C.secondary, fontSize: 14 }}>
        Välj en fastighet för att se dess objekt.
      </p>

      {isLoading || objectsQuery.isLoading ? (
        <div style={{ padding: 24, color: C.secondary }}>
          Laddar fastigheter och objekt…
        </div>
      ) : objectsQuery.isError ? (
        <div style={{ padding: 20, color: C.secondary }}>
          Kunde inte ladda objekten. Uppdatera sidan och försök igen.
        </div>
      ) : visibleProperties.length === 0 ? (
        <div style={{ padding: 32, textAlign: "center", color: C.secondary }}>
          Inga fastigheter hittades.
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gap: 16,
            gridTemplateColumns: isMobile
              ? "1fr"
              : "repeat(auto-fill, minmax(360px, 1fr))",
          }}
        >
          {visibleProperties.map((property) => (
            <div
              key={property.id}
              style={{
                border: `1px solid ${C.border}`,
                borderRadius: 12,
                overflow: "hidden",
                background: "#fff",
              }}
            >
              <PropertyCard
                property={property}
                linkTo="/properties/$id/objects/"
                cornerBadge={
                  <div
                    style={{
                      position: "absolute",
                      top: 12,
                      right: 12,
                      padding: "6px 12px",
                      borderRadius: 999,
                      background: "rgba(13,43,30,0.9)",
                      color: "#fff",
                      fontSize: 12,
                      fontWeight: 700,
                    }}
                  >
                    {counts.get(property.id) ?? 0} objekt
                  </div>
                }
              />

              <button
                type="button"
                onClick={() =>
                  navigate({
                    to: "/properties/$id/objects/",
                    params: { id: property.id },
                  })
                }
                style={{
                  width: "100%",
                  padding: "12px 16px",
                  border: "none",
                  borderTop: `1px solid ${C.border}`,
                  background: "#fff",
                  color: "#0D2B1E",
                  fontSize: 14,
                  fontWeight: 600,
                  textAlign: "left",
                  cursor: "pointer",
                }}
              >
                Visa objekt →
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
