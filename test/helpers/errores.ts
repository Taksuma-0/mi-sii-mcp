import { ErrorImpuestocl } from '../../src/domain/errores.js';

/** Código del ErrorImpuestocl con que falla la promesa, o una descripción si no falla así. */
export async function codigoDe(promesa: Promise<unknown>): Promise<string> {
  try {
    await promesa;
    return 'sin error';
  } catch (e) {
    return e instanceof ErrorImpuestocl ? e.codigo : `otro error: ${String(e)}`;
  }
}
