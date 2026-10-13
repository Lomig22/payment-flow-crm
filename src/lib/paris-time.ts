// Minuit (heure de Paris) du jour courant, en instant UTC.
export function startOfTodayParis(): Date {
  const now = new Date();
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Paris', hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(now).map((x) => [x.type, x.value]),
  );
  const parisAsUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  const offsetMs = parisAsUtc - now.getTime();
  return new Date(Date.UTC(+p.year, +p.month - 1, +p.day) - offsetMs);
}
