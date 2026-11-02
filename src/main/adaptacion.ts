import type { AdaptacionPortal } from '../connectors/sii/lector.js';
import { conAprendidos, MAPA_BASE } from '../connectors/sii/mapa-campos.js';
import type { AliasAprendido } from '../domain/portal.js';
import type { Store } from '../ports/index.js';

/**
 * Lo que el lector necesita para adaptarse a un cambio del portal: los nombres de campos ya aprendidos y qué hacer con uno
 * nuevo (guardarlo, anotarlo como cambio «reparado» y avisar una vez a la cuenta que lo trajo). Decisión 0010.
 */
export function adaptacionPortal(store: Store, rut: string): AdaptacionPortal {
  return {
    mapa: conAprendidos(MAPA_BASE, store.aliasAprendidos()),
    alAprender: (a: AliasAprendido) => {
      store.guardarAlias(a);
      store.registrarCambioPortal(a.superficie, 'reparado', { campo: a.campo, alias: a.alias, evidencia: a.evidencia }, a.aprendidoEn);
      store.registrarAvisos(
        [
          {
            rut,
            clave: `PA:${a.superficie}:${a.campo}:${a.alias}`,
            tipo: 'portal',
            severidad: 'advertencia',
            titulo: `El SII cambió el nombre de un campo (${a.campo}) y mi-sii-mcp se adaptó solo`,
            detalle: `Ahora lee ${a.campo} desde «${a.alias}». Comprobación: ${a.evidencia}. Si ves montos raros, revisa con diagnostico.`,
          },
        ],
        a.aprendidoEn,
      );
    },
  };
}
