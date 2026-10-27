import type { LectorPdfF29, Store } from '../../src/ports/index.js';
import { RUT_EMPRESA } from './fabricas.js';

export const VERSION_LECTOR_PRUEBA = 'f29-prueba-1';

/** PDF de prueba: `%PDF-` seguido del JSON de sus códigos. `LectorPdfFalso` lo lee sin un PDF real. */
export const pdfFalso = (codigos: Record<string, number>): Uint8Array => new TextEncoder().encode(`%PDF-${JSON.stringify(codigos)}`);

/** Lee los PDF de `pdfFalso`; cualquier otro contenido falla como un PDF ilegible. Cuenta las lecturas. */
export class LectorPdfFalso implements LectorPdfF29 {
  lecturas = 0;
  constructor(public version: string = VERSION_LECTOR_PRUEBA) {}

  async extraer(bytes: Uint8Array): Promise<Record<string, number>> {
    this.lecturas++;
    const texto = new TextDecoder('latin1').decode(bytes);
    if (!texto.startsWith('%PDF-')) throw new Error('No es un PDF.');
    return JSON.parse(texto.slice(5)) as Record<string, number>;
  }
}

/**
 * Guarda como evidencia de una sincronización el PDF compacto de un folio, como lo deja el conector. `estado` es el de
 * la sincronización que lo trajo.
 */
export function guardarPdfF29(
  store: Store,
  o: { periodo: string; folio: number; cuerpo: Uint8Array | string; obtenidoEn: string; rut?: string; estado?: 'ok' | 'error'; superficie?: string },
): void {
  const rut = o.rut ?? RUT_EMPRESA;
  const id = store.iniciarSincronizacion(rut, 'f29.valores', o.periodo, o.obtenidoEn);
  const cuerpo = typeof o.cuerpo === 'string' ? o.cuerpo : Buffer.from(o.cuerpo).toString('base64');
  store.guardarRespuestaCruda(id, { superficie: o.superficie ?? 'f29.formCompacto', parametros: { periodo: o.periodo, folio: o.folio }, cuerpo, obtenidoEn: o.obtenidoEn });
  store.terminarSincronizacion(id, o.obtenidoEn, o.estado ?? 'ok', o.estado === 'error' ? { codigo: 'LECTURA_INCOHERENTE', detalle: 'x' } : undefined);
}
