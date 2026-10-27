import { ErrorMiSiiMcp } from '../../src/domain/errores.js';

/** Código del ErrorMiSiiMcp con que falla la promesa, o una descripción si no falla así. */
export async function codigoDe(promesa: Promise<unknown>): Promise<string> {
  try {
    await promesa;
    return 'sin error';
  } catch (e) {
    return e instanceof ErrorMiSiiMcp ? e.codigo : `otro error: ${String(e)}`;
  }
}
