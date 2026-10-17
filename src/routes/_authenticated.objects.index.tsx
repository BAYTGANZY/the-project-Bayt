import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Building02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { supabase } from "@/lib/supabase";
import { objectStatusMeta, objectTypeLabel } from "@/lib/object-tokens";
import { useIsMobile } from "@/hooks/use-mobile";

export const Route = createFileRoute("/_authenticated/objects/")({
  head: () => ({ meta: [{ title: "Objekt — BAYT" }] }),
  component: ObjectsPage,
});

type Property = { id: string; name: string };
type ObjectRow = {
  id: string;
  name: string;
  type: string;
  status: string | null;
  property_id: string;
};

const C = { text: "#1a1a1a", secondary: "#6B7280", border: "#E5E7EB", green: "#3D8A30" };

function ObjectsPage() {
  const isMobile = useIsMobile();
  const propertiesQ = useQuery({
    queryKey: ["all-object-properties"],
    queryFn: async () => {
      const { data, error } = await supabase.from("properties").select("id, name").order("name");
      if (error) throw error;
      return (data ?? []) as Property[];
    },
  });
  const objectsQ = useQuery({
    queryKey: ["all-property-objects"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("property_objects")
        .select("id, name, type, status, property_id")
        .order("name");
      if (error) throw error;
      return (data ?? []) as ObjectRow[];
    },
  });

  const propertyNames = useMemo(
    () => new Map((propertiesQ.data ?? []).map((property) => [property.id, property.name])),
    [propertiesQ.data],
  );
  const objects = objectsQ.data ?? [];
  const loading = propertiesQ.isLoading || objectsQ.isLoading;
  const error = propertiesQ.error || objectsQ.error;

  return (
    <div style={{ padding: isMobile ? 16 : 32 }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700, color: C.text, fontFamily: "Outfit, Inter, system-ui, sans-serif" }}>
          Objekt
        </h1>
        <p style={{ margin: "6px 0 0", color: C.secondary, fontSize: 14 }}>
          Alla objekt samlade från fastigheterna.
        </p>
      </div>

      {loading ? (
        <div style={{ color: C.secondary, padding: 24 }}>Laddar objekt…</div>
      ) : error ? (
        <div role="alert" style={{ color: "#B91C1C", padding: 24 }}>Det gick inte att ladda objekten.</div>
      ) : objects.length === 0 ? (
        <div style={{ display: "flex", alignItems: "center", gap: 12, color: C.secondary, padding: 24, border: `1px solid ${C.border}`, borderRadius: 12 }}>
          <HugeiconsIcon icon={Building02Icon} size={24} />
          Inga objekt hittades.
        </div>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {objects.map((object) => {
            const status = objectStatusMeta(object.status);
            return (
              <Link
                key={object.id}
                to="/properties/$id/objects/$objectId"
                params={{ id: object.property_id, objectId: object.id }}
                style={{ display: "flex", alignItems: "center", gap: 14, padding: "16px 18px", background: "#fff", border: `1px solid ${C.border}`, borderRadius: 12, color: C.text, textDecoration: "none" }}
              >
                <span aria-hidden style={{ width: 12, height: 12, flexShrink: 0, borderRadius: "50%", background: status.color }} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 15, fontWeight: 600 }}>{object.name}</span>
                  <span style={{ display: "block", marginTop: 4, color: C.secondary, fontSize: 12 }}>
                    {objectTypeLabel(object.type)} · {propertyNames.get(object.property_id) ?? "Fastighet"}
                  </span>
                </span>
                <span style={{ color: C.green, fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" }}>{status.label}</span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
