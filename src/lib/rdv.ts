// Helpers créneau RDV (Opération Show-Up) — heure de Paris.

// 'YYYY-MM-DDTHH:mm' saisi en heure de Paris → ISO avec le bon décalage
export function parisIso(local: string): string {
  const probe = new Date(`${local}:00Z`);
  const tz = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Paris', timeZoneName: 'longOffset' })
    .formatToParts(probe).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+01:00';
  const m = tz.match(/GMT([+-]\d{2}):(\d{2})/);
  return `${local}:00${m ? `${m[1]}:${m[2]}` : '+01:00'}`;
}

// ISO → « 14h00 » (heure de Paris)
export function formatHeureFr(iso: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso)).replace(':', 'h');
}

// ISO → « jeudi 17 juillet à 14h00 »
export function formatRdvFr(iso: string): string {
  const txt = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris', weekday: 'long', day: 'numeric', month: 'long',
    hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso));
  return txt.replace(/,?\s(\d{2}):(\d{2})$/, ' à $1h$2');
}
