import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";

const CHECKLIST = [
  {
    title: "1. Allmänt om fastigheten",
    items: [
      "Fastighetens adress och typ",
      "Antal byggnader och lägenheter",
      "Byggår och större renoveringar",
      "Kontaktperson och ansvarig förvaltare",
    ],
  },
  {
    title: "2. Utemiljö och byggnad",
    items: [
      "Fasad och sockel",
      "Tak och takavvattning",
      "Fönster och entréer",
      "Gårdar, gångar och parkering",
      "Belysning och skyltning",
    ],
  },
  {
    title: "3. Gemensamma utrymmen",
    items: [
      "Trapphus och korridorer",
      "Tvättstuga",
      "Källare och vind",
      "Soprum och avfallshantering",
      "Förråd och tekniska utrymmen",
    ],
  },
  {
    title: "4. Tekniska installationer",
    items: [
      "Värme och ventilation",
      "Vatten och avlopp",
      "El och belysning",
      "Brandskydd och utrymningsvägar",
      "Hissar, om sådana finns",
    ],
  },
  {
    title: "5. Drift och förvaltning",
    items: [
      "Pågående fel och brister",
      "Befintliga serviceavtal",
      "Återkommande tillsyn och kontroller",
      "Kontakt med entreprenörer",
      "Akuta behov och prioriteringar",
    ],
  },
];

function GenomgangAvFastighetPage() {
  const [propertyName, setPropertyName] = useState("");
  const [address, setAddress] = useState("");
  const [contact, setContact] = useState("");
  const [visitDate, setVisitDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [comments, setComments] = useState<Record<string, string>>({});
  const [generalNotes, setGeneralNotes] = useState("");
const [savedWalkthroughs, setSavedWalkthroughs] = useState<any[]>([]);
const [currentWalkthroughId, setCurrentWalkthroughId] = useState<string | null>(null);

useEffect(() => {
  try {
    const saved = localStorage.getItem("bayt-property-walkthroughs");
    if (saved) setSavedWalkthroughs(JSON.parse(saved));
  } catch {
    console.error("Kunde inte läsa sparade genomgångar.");
  }
}, []);

function saveWalkthrough() {
  const record = {
    id: currentWalkthroughId ?? crypto.randomUUID(),
    propertyName,
    address,
    contact,
    visitDate,
    answers,
    comments,
    generalNotes,
    updatedAt: new Date().toISOString(),
  };

  const updated = [
    record,
    ...savedWalkthroughs.filter((item) => item.id !== record.id),
  ];

  try {
    localStorage.setItem(
      "bayt-property-walkthroughs",
      JSON.stringify(updated),
    );
    setSavedWalkthroughs(updated);
    setCurrentWalkthroughId(record.id);
    alert("Genomgången har sparats på den här enheten.");
  } catch {
    alert("Kunde inte spara genomgången i webbläsaren.");
  }
}
  const total = CHECKLIST.reduce(
    (sum, section) => sum + section.items.length,
    0,
  );
  const checked = Object.values(answers).filter(
    (answer) => answer === "Kontrollerat",
  ).length;

  function exportNotes() {
    const lines = [
      "BAYT – GENOMGÅNG AV FASTIGHET",
      `Fastighet: ${propertyName}`,
      `Adress: ${address}`,
      `Kontaktperson: ${contact}`,
      `Besöksdatum: ${visitDate}`,
      "",
      ...CHECKLIST.flatMap((section) => [
        section.title,
        ...section.items.map((item) => {
          const key = `${section.title}::${item}`;
          return `- ${item}: ${answers[key] || "Ej bedömt"}${
            comments[key] ? ` – ${comments[key]}` : ""
          }`;
        }),
        "",
      ]),
      "Övergripande anteckningar:",
      generalNotes,
    ];

    const blob = new Blob(["\uFEFF" + lines.join("\n")], {
      type: "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "bayt-genomgang-fastighet.txt";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-4 md:p-8">
      <div>
        <p className="text-sm font-medium uppercase tracking-widest text-emerald-700">
          BAYT · NY KUND
        </p>
        <h1 className="mt-2 text-3xl font-semibold">
          Platsbesök
        </h1>
        <p className="mt-2 text-muted-foreground">
          Underlag inför platsbesök och offert. Denna genomgång är separat
          från befintliga fastigheter och besiktningar.
        </p>
      </div>

      <div className="rounded-xl border p-5">
<h2 className="mb-4 flex items-center gap-2 text-lg font-semibold"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-100 text-emerald-800">🏢</span>Grunduppgifter</h2>`
        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-1">
            <span className="text-sm font-medium">Fastighet / kund</span>
            <input
              className="w-full rounded-md border bg-background p-2"
              value={propertyName}
              onChange={(event) => setPropertyName(event.target.value)}
              placeholder="Namn på fastigheten eller kunden"
            />
          </label>
          <label className="space-y-1">
            <span className="text-sm font-medium">Adress</span>
            <input
              className="w-full rounded-md border bg-background p-2"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              placeholder="Fastighetens adress"
            />
          </label>
          <label className="space-y-1">
            <span className="text-sm font-medium">Kontaktperson</span>
            <input
              className="w-full rounded-md border bg-background p-2"
              value={contact}
              onChange={(event) => setContact(event.target.value)}
              placeholder="Namn och kontaktuppgifter"
            />
          </label>
          <label className="space-y-1">
            <span className="text-sm font-medium">Besöksdatum</span>
            <input
              className="w-full rounded-md border bg-background p-2"
              type="date"
              value={visitDate}
              onChange={(event) => setVisitDate(event.target.value)}
            />
          </label>
        </div>
      </div>

      <div className="rounded-xl border p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Checklista</h2>
          <span className="text-sm text-muted-foreground">
            {checked} av {total} kontrollerade
          </span>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full bg-emerald-700 transition-all"
            style={{ width: `${(checked / total) * 100}%` }}
          />
        </div>

        <div className="mt-6 space-y-8">
          {CHECKLIST.map((section) => (
            <section key={section.title} className="space-y-3">
              <h3 className="border-b pb-2 font-semibold">
                {section.title}
              </h3>
              {section.items.map((item) => {
                const key = `${section.title}::${item}`;
                return (
                  <div
                    key={key}
                    className="space-y-2 rounded-lg bg-muted/30 p-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <span className="font-medium">{item}</span>
                      <select
                        className="rounded-md border bg-background p-2 text-sm"
                        value={answers[key] || ""}
                        onChange={(event) =>
                          setAnswers((current) => ({
                            ...current,
                            [key]: event.target.value,
                          }))
                        }
                      >
                        <option value="">Ej bedömt</option>
                        <option value="Kontrollerat">Kontrollerat</option>
                        <option value="Åtgärd krävs">Åtgärd krävs</option>
                        <option value="Ej aktuellt">Ej aktuellt</option>
                      </select>
                    </div>
                    <textarea
                      className="w-full rounded-md border bg-background p-2 text-sm"
                      rows={2}
                      placeholder="Kommentar eller observation (valfritt)"
                      value={comments[key] || ""}
                      onChange={(event) =>
                        setComments((current) => ({
                          ...current,
                          [key]: event.target.value,
                        }))
                      }
                    />
                  </div>
                );
              })}
            </section>
          ))}
        </div>
      </div>

      <div className="rounded-xl border p-5">
        <h2 className="mb-3 text-lg font-semibold">
          Övergripande anteckningar
        </h2>
        <textarea
          className="w-full rounded-md border bg-background p-3"
          rows={5}
          placeholder="Sammanfattning, kundens önskemål, risker och underlag inför offert..."
          value={generalNotes}
          onChange={(event) => setGeneralNotes(event.target.value)}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4">
        <p className="text-sm text-muted-foreground">
          {checked} av {total} punkter markerade som kontrollerade.
          Uppgifterna sparas inte automatiskt i databasen.
        </p>
        <button
          type="button"
          className="rounded-md bg-emerald-800 px-5 py-3 font-medium text-white"
          onClick={exportNotes}
        >
          Exportera anteckningar
        </button>
     <button
  type="button"
  className="rounded-md bg-emerald-800 px-5 py-3 font-medium text-white"
  onClick={saveWalkthrough}
>
  Spara genomgång
</button>
     {savedWalkthroughs.length > 0 && (
  <div className="mt-4 rounded-xl border p-4">
    <h2 className="mb-3 text-lg font-semibold">
      Sparade genomgångar
    </h2>
    <div className="space-y-2">
      {savedWalkthroughs.map((item) => (
        <button
          key={item.id}
          type="button"
          className="block w-full rounded-md border p-3 text-left hover:bg-muted/50"
          onClick={() => {
            setCurrentWalkthroughId(item.id);
            setPropertyName(item.propertyName ?? "");
            setAddress(item.address ?? "");
            setContact(item.contact ?? "");
            setVisitDate(item.visitDate ?? "");
            setAnswers(item.answers ?? {});
            setComments(item.comments ?? {});
            setGeneralNotes(item.generalNotes ?? "");
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
        >
          <span className="block font-medium">
            {item.propertyName || "Namnlös fastighet"}
          </span>
          <span className="block text-sm text-muted-foreground">
            {item.address || "Ingen adress angiven"}
          </span>
          <span className="block text-xs text-muted-foreground">
            Senast sparad:{" "}
            {new Date(item.updatedAt).toLocaleString("sv-SE")}
          </span>
        </button>
      ))}
    </div>
  </div>
)}
      </div>
    </div>
  );
}

export const Route = createFileRoute("/_authenticated/genomgang-av-fastighet")({
  component: GenomgangAvFastighetPage,
});
