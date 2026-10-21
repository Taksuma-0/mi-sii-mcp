// Fechas como texto ISO `AAAA-MM-DD`; la aritmética se hace en UTC para no depender de la zona del equipo.
const DIA_MS = 86_400_000;
const aUtc = (iso: string): number => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
const deUtc = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

export const sumarDias = (iso: string, dias: number): string => deUtc(aUtc(iso) + dias * DIA_MS);

export const diasEntre = (desde: string, hasta: string): number => Math.round((aUtc(hasta) - aUtc(desde)) / DIA_MS);

/** 0 = domingo … 6 = sábado. */
export const diaSemana = (iso: string): number => new Date(aUtc(iso)).getUTCDay();

/** Fecha civil (`AAAA-MM-DD`) de un instante en America/Santiago. */
export function fechaEnSantiago(instante: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santiago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instante);
}

/** `DD/MM/AAAA[ HH:MM[:SS]]` → `AAAA-MM-DD[ HH:MM[:SS]]`. Si no calza, devuelve el texto tal cual. */
export function ddmmaaaaAIso(valor: string | null | undefined): string | null {
  if (valor === null || valor === undefined) return null;
  const s = String(valor).trim();
  if (!s) return null;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{2}:\d{2}(?::\d{2})?))?$/.exec(s);
  if (!m) return s;
  const iso = `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
  return m[4] ? `${iso} ${m[4]}` : iso;
}
