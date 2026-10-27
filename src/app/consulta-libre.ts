import { ErrorImpuestocl } from '../domain/errores.js';
import { NOMBRES_TIPO_DOCUMENTO } from '../domain/formato.js';
import type { LimitesConsulta, ResultadoConsulta } from '../ports/index.js';
import { CODIGO_F29, CODIGOS_CREDITO_FUERA_RCV, LINEAS_DE_TOTALES, TIPOS_DOC_NEGATIVOS } from '../reconciliation/mapeo-f29.js';
import type { DepsApp } from './deps.js';
import { SOLO_RESUMEN_VENTA } from './sincronizar.js';

/** Tope de cada respuesta: lo primero que se alcance entre filas y caracteres del JSON compacto (unos 10 000 tokens). */
export const LIMITES_CONSULTA: LimitesConsulta = { filas: 200, caracteres: 40_000, caracteresCelda: 1_000, milisegundos: 15_000 };
export const MAX_CARACTERES_SQL = 20_000;

/** Valida el texto y delega en el puerto; la copia curada, la sentencia de solo lectura y el plazo son del adaptador. */
export async function consultaSql(deps: DepsApp, sql: string, limites: LimitesConsulta = LIMITES_CONSULTA): Promise<ResultadoConsulta> {
  if (sql.trim() === '') {
    throw new ErrorImpuestocl('CONSULTA_RECHAZADA', 'La consulta está vacía: escribe una sentencia SELECT o WITH.');
  }
  if (sql.length > MAX_CARACTERES_SQL) {
    throw new ErrorImpuestocl('CONSULTA_RECHAZADA', `La consulta tiene ${sql.length} caracteres y el máximo es ${MAX_CARACTERES_SQL}.`);
  }
  return deps.consultaLibre.consultar(sql, { limites, tiposNegativos: TIPOS_DOC_NEGATIVOS });
}

export interface ColumnaEsquema {
  readonly nombre: string;
  readonly tipo: string;
  readonly significado: string;
}

export interface TablaEsquema {
  readonly nombre: string;
  readonly descripcion: string;
  readonly columnas: readonly ColumnaEsquema[];
}

export interface EsquemaDatos {
  readonly tablas: readonly TablaEsquema[];
  readonly reglas: readonly string[];
}

const col = (nombre: string, tipo: 'INTEGER' | 'TEXT' | 'REAL', significado: string): ColumnaEsquema => ({ nombre, tipo, significado });

const RUT = col('rut', 'TEXT', 'RUT del contribuyente, sin puntos y con guion (22222222-2)');
const PERIODO = col('periodo', 'TEXT', 'Período tributario AAAA-MM');
const LADO = col('lado', 'TEXT', 'COMPRA (documentos recibidos) o VENTA (emitidos)');
const ESTADO_RCV = col('estado_rcv', 'TEXT', 'REGISTRO, PENDIENTE, NO_INCLUIR o RECLAMADO (ver reglas); las VENTA solo traen REGISTRO');
const TIPO_DOC = col('tipo_doc', 'INTEGER', 'Código SII del tipo de documento (nombres en las reglas)');
const SINCRONIZACION_ID = col('sincronizacion_id', 'INTEGER', 'sincronizacion.id que trajo la fila');
const OBTENIDO_EN = col('obtenido_en', 'TEXT', 'Instante ISO UTC en que se obtuvo del SII');
const SIGNO = col('signo', 'INTEGER', '-1 en notas de crédito, 1 en el resto: multiplica los montos por signo al sumar');

const TABLAS: readonly TablaEsquema[] = [
  {
    nombre: 'contribuyente',
    descripcion: 'Perfiles guardados (personas y empresas); hay uno por RUT consultable.',
    columnas: [
      RUT,
      col('alias', 'TEXT', 'Nombre corto del perfil'),
      col('tipo', 'TEXT', 'persona o empresa'),
      col('razon_social', 'TEXT', 'Razón social; NULL si no se conoce'),
      col('representa_json', 'TEXT', 'Arreglo JSON con los RUT que este perfil representa'),
      col('creado_en', 'TEXT', 'Instante ISO UTC de creación del perfil'),
    ],
  },
  {
    nombre: 'rcv_resumen',
    descripcion:
      'Resumen del RCV: una fila por rut, periodo, lado, estado_rcv y tipo_doc, con cantidad y montos del grupo. Fuente de los totales de IVA: incluye las boletas de venta, que no existen en rcv_documento.',
    columnas: [
      RUT,
      PERIODO,
      LADO,
      ESTADO_RCV,
      TIPO_DOC,
      col('descripcion', 'TEXT', 'Nombre del tipo según el SII; puede ser NULL'),
      col('cantidad', 'INTEGER', 'Documentos del grupo'),
      col('exento', 'INTEGER', 'Monto exento del grupo, en pesos'),
      col('neto', 'INTEGER', 'Monto neto del grupo, en pesos'),
      col('iva', 'INTEGER', 'IVA del grupo, en pesos (positivo también en notas de crédito: usa signo)'),
      col('total', 'INTEGER', 'Monto total del grupo, en pesos'),
      SINCRONIZACION_ID,
      OBTENIDO_EN,
      SIGNO,
    ],
  },
  {
    nombre: 'rcv_documento',
    descripcion:
      'Detalle del RCV: un documento por fila (rut, lado, tipo_doc, rut_contraparte, folio). Úsala para proveedores, clientes, folios y fechas. No trae las boletas de venta.',
    columnas: [
      RUT,
      PERIODO,
      LADO,
      ESTADO_RCV,
      TIPO_DOC,
      col('rut_contraparte', 'TEXT', 'RUT del proveedor (COMPRA) o del cliente (VENTA); DESCONOCIDO si el SII no lo informa'),
      col('folio', 'INTEGER', 'Folio del documento'),
      col('razon_social', 'TEXT', 'Razón social de la contraparte; puede ser NULL'),
      col('fecha_emision', 'TEXT', 'Fecha de emisión AAAA-MM-DD; puede ser NULL'),
      col('fecha_recepcion', 'TEXT', 'Fecha de recepción; suele traer hora (AAAA-MM-DD HH:MM:SS), así que para filtrar o agrupar por día usa substr(fecha_recepcion, 1, 10); puede ser NULL'),
      col('fecha_acuse', 'TEXT', 'Fecha del acuse de recibo; suele traer hora (AAAA-MM-DD HH:MM:SS) y, si el SII la manda en otro formato, queda tal cual: usa substr(fecha_acuse, 1, 10) para el día; NULL si no hay'),
      col('monto_exento', 'INTEGER', 'Monto exento, en pesos'),
      col('monto_neto', 'INTEGER', 'Monto neto, en pesos'),
      col('monto_iva', 'INTEGER', 'IVA, en pesos (positivo también en notas de crédito: usa signo)'),
      col('monto_iva_no_recuperable', 'INTEGER', 'IVA no recuperable, en pesos'),
      col('monto_iva_uso_comun', 'INTEGER', 'IVA de uso común, en pesos'),
      col('monto_total', 'INTEGER', 'Monto total, en pesos'),
      col('tipo_compra', 'TEXT', 'Tipo de transacción de la compra según el SII; puede ser NULL'),
      col('evento_receptor', 'TEXT', 'Evento registrado por el receptor según el SII; NULL si no hay'),
      SINCRONIZACION_ID,
      OBTENIDO_EN,
      SIGNO,
    ],
  },
  {
    nombre: 'f29_declaracion',
    descripcion: 'Declaraciones F29 por rut y periodo; un período puede tener varias (una fila por folio). La vigente se elige con la regla de las reglas.',
    columnas: [
      RUT,
      PERIODO,
      col('folio', 'INTEGER', 'Folio de la declaración; 0 si solo está guardada y no presentada'),
      col('estado', 'TEXT', 'Estado según el SII (por ejemplo Vigente)'),
      col('estado_id', 'INTEGER', 'Id del estado según el SII: 10 guardada sin presentar, 70 rechazada; NULL si el SII no lo informó o la fila es anterior a esta columna (entonces decide el texto de estado)'),
      col('fecha_presentacion', 'TEXT', 'Fecha de presentación AAAA-MM-DD; si el SII informa la hora viene como AAAA-MM-DD HH:MM:SS, por lo que para el día conviene substr(fecha_presentacion, 1, 10); puede ser NULL'),
      col('codigo_interno', 'INTEGER', 'Identificador interno del portal para descargar el F29; sin valor tributario'),
      col('total_a_pagar', 'INTEGER', 'Total a pagar según el listado del SII, en pesos; puede ser NULL'),
      SINCRONIZACION_ID,
      OBTENIDO_EN,
    ],
  },
  {
    nombre: 'f29_valor',
    descripcion: 'Valores de los códigos del formulario F29: una fila por rut, periodo, folio y codigo. Solo existen para las declaraciones cuyo detalle se descargó (normalmente la vigente).',
    columnas: [
      RUT,
      PERIODO,
      col('folio', 'INTEGER', 'Folio de f29_declaracion'),
      col('codigo', 'TEXT', "Código del formulario, como texto: codigo = '538'"),
      col('valor', 'REAL', 'Valor del código (pesos; las tasas, como decimal)'),
    ],
  },
  {
    nombre: 'f29_lectura',
    descripcion:
      'Cómo se leyeron los valores de cada folio en f29_valor (una fila por rut, periodo y folio): versión del lector del PDF, origen y si el autocontrol del formulario cuadró. Un folio con valores sin fila aquí se leyó antes de que existiera esta tabla.',
    columnas: [
      RUT,
      PERIODO,
      col('folio', 'INTEGER', 'Folio de f29_declaracion'),
      col('version_lector', 'TEXT', 'Versión del lector del PDF compacto que obtuvo los valores'),
      col('origen', 'TEXT', 'sincronizacion (PDF recién bajado del SII) o relectura (PDF ya guardado, leído de nuevo sin volver al SII)'),
      col('leido_en', 'TEXT', 'Instante ISO UTC de la lectura'),
      col('codigos', 'INTEGER', 'Cantidad de códigos guardados del folio'),
      col('coherente', 'INTEGER', '1 si el autocontrol del F29 se pudo aplicar (538 y 537 con dato; un total ausente sin sus líneas vale 0) y cuadró; 0 si no cuadró o no se pudo verificar (revisa esos valores con cuidado)'),
    ],
  },
  {
    nombre: 'f29_propuesta',
    descripcion:
      'Propuesta de F29 que prepara el SII para el mes (una fila por rut y periodo), solo si se sincronizó la superficie propuesta. Sus montos están en f29_propuesta_valor. No es el F29 declarado: ver f29_declaracion y f29_valor.',
    columnas: [
      RUT,
      PERIODO,
      col('tipo_propuesta', 'INTEGER', 'Tipo de propuesta según el SII (40 con propuesta, 48 sin propuesta); NULL si no lo informó'),
      col('descripcion_tipo', 'TEXT', 'Descripción del tipo según el SII; puede ser NULL'),
      col('estado_calculo', 'INTEGER', 'Estado del cálculo de la propuesta según el SII (5 cuando no hay propuesta); NULL si no lo informó'),
      col('sin_propuesta', 'INTEGER', '1 si el SII no armó una propuesta para el mes (sin códigos propuestos ni administrativos); 0 si trae códigos'),
      SINCRONIZACION_ID,
      OBTENIDO_EN,
    ],
  },
  {
    nombre: 'f29_propuesta_valor',
    descripcion: 'Códigos de la propuesta de F29 del SII: una fila por rut, periodo, lista y codigo. No incluye los códigos de identificación del contribuyente.',
    columnas: [
      RUT,
      PERIODO,
      col('lista', 'TEXT', 'propuesto (monto que el SII propone para ese código) o administrativo (datos de control del SII, sin valor tributario directo)'),
      col('codigo', 'TEXT', "Código del formulario, como texto y sin ceros a la izquierda: codigo = '520'"),
      col('valor', 'REAL', 'Valor del código, en pesos'),
    ],
  },
  {
    nombre: 'bhe_recibida',
    descripcion:
      'Boletas de honorarios electrónicas recibidas por el contribuyente (rut), una fila por emisor y folio, solo si se sincronizó la superficie bhe. Incluye las anuladas (anulada = 1).',
    columnas: [
      col('rut', 'TEXT', 'RUT del contribuyente que recibió la boleta, sin puntos y con guion (22222222-2)'),
      PERIODO,
      col('rut_emisor', 'TEXT', 'RUT de quien emitió la boleta, sin puntos y con guion'),
      col('folio', 'INTEGER', 'Número de la boleta del emisor'),
      col('nombre_emisor', 'TEXT', 'Nombre de quien emitió la boleta; puede ser NULL'),
      col('fecha', 'TEXT', 'Fecha de la boleta AAAA-MM-DD; puede ser NULL'),
      col('bruto', 'INTEGER', 'Total de honorarios (bruto), en pesos'),
      col('retencion', 'INTEGER', 'Retención que hace quien recibe la boleta, en pesos'),
      col('liquido', 'INTEGER', 'Honorarios líquidos (bruto menos retención), en pesos'),
      col('sociedad_profesional', 'INTEGER', '1 si el emisor es una sociedad de profesionales; 0 si no'),
      col('anulada', 'INTEGER', '1 si la boleta está anulada (no cuenta en los montos); 0 si está vigente'),
      col('fecha_anulacion', 'TEXT', 'Fecha de anulación AAAA-MM-DD; NULL si no está anulada'),
      SINCRONIZACION_ID,
      OBTENIDO_EN,
    ],
  },
  {
    nombre: 'hallazgo',
    descripcion:
      'Resultados de la conciliación IVA (RCV contra F29) y avisos de plazos, por rut y periodo. Se recalculan al pedir iva_resumen o iva_hallazgos: una tabla vacía no prueba que no haya diferencias.',
    columnas: [
      col('id', 'INTEGER', 'Identificador interno'),
      RUT,
      PERIODO,
      col('regla', 'TEXT', 'Código de la regla (IVA-01, IVA-02…)'),
      col('severidad', 'TEXT', 'info, advertencia o critico'),
      col('naturaleza', 'TEXT', 'HECHO (observado en los datos) o DERIVADO (calculado a partir de ellos)'),
      col('titulo', 'TEXT', 'Título breve del hallazgo'),
      col('detalle', 'TEXT', 'Explicación del hallazgo'),
      col('datos_json', 'TEXT', 'JSON {"montos": {esperado, declarado, diferencia} o null, "evidencia": [texto]}'),
      col('version_reglas', 'TEXT', 'Versión de las reglas que lo calculó'),
      col('calculado_en', 'TEXT', 'Instante ISO UTC del cálculo'),
    ],
  },
  {
    nombre: 'sincronizacion',
    descripcion:
      'Bitácora de lo traído del SII: una fila por intento y por superficie y periodo. Sirve para saber qué se consultó, cuándo y si salió bien.',
    columnas: [
      col('id', 'INTEGER', 'Identificador; mayor id = intento más reciente'),
      RUT,
      col('superficie', 'TEXT', 'rcv.VENTA, rcv.COMPRA, f29 (listado de declaraciones), f29.valores (detalle de la vigente; no se repite si f29_lectura ya tiene una lectura coherente del folio con la misma versión del lector, así que puede no haber un intento reciente) , f29.propuesta (propuesta del SII; solo si se pidió) o bhe.recibidas (boletas de honorarios recibidas; solo si se pidió)'),
      PERIODO,
      col('iniciado_en', 'TEXT', 'Instante ISO UTC de inicio'),
      col('terminado_en', 'TEXT', 'Instante ISO UTC de término; NULL si sigue en curso'),
      col('estado', 'TEXT', 'ok, error o en_curso'),
      col('error_codigo', 'TEXT', 'Código del error cuando estado es error'),
    ],
  },
];

const DESCRIPCION_CODIGO_F29: Readonly<Record<keyof typeof CODIGO_F29, string>> = {
  TOTAL_DEBITOS: 'total débitos',
  TOTAL_CREDITOS: 'total créditos',
  REMANENTE_MES_ANTERIOR: 'remanente del mes anterior',
  REMANENTE_PERIODO_SIGUIENTE: 'remanente para el período siguiente',
  TOTAL_A_PAGAR: 'total a pagar',
  IVA_DETERMINADO: 'IVA determinado',
  TOTAL_DETERMINADO: 'total determinado',
  RETENCION_HONORARIOS: 'retención de honorarios',
};

function reglas(): readonly string[] {
  const codigosF29 = (Object.keys(CODIGO_F29) as (keyof typeof CODIGO_F29)[]).map((k) => `'${CODIGO_F29[k]}' ${DESCRIPCION_CODIGO_F29[k]}`).join(', ');
  const tiposConNombre = Object.entries(NOMBRES_TIPO_DOCUMENTO).map(([tipo, nombre]) => `${tipo} ${nombre}`).join(', ');
  const fueraDelRcv = CODIGOS_CREDITO_FUERA_RCV.map((c) => `'${c}'`).join(' y ');
  const citar = (codigos: readonly string[], union: string): string => codigos.map((c) => `'${c}'`).join(union);
  const totalesAnulados = Object.entries(LINEAS_DE_TOTALES)
    .map(([total, { suman, restan, informativas }]) => {
      const sinInformativas = informativas.length > 0 ? ` y no viene ${citar(informativas, ' ni ')}` : '';
      return `'${total}' ausente vale 0 solo si ${citar(restan, ' + ')} ≥ ${citar(suman, ' + ')}${sinInformativas}`;
    })
    .join('; ');
  return [
    "Montos en pesos chilenos enteros, sin decimales. Período AAAA-MM, RUT sin puntos y con guion e instantes en ISO UTC. Fechas como texto: fecha_emision viene como AAAA-MM-DD, pero fecha_recepcion, fecha_acuse y a veces fecha_presentacion traen hora (AAAA-MM-DD HH:MM:SS). Una comparación directa como fecha_recepcion BETWEEN '2026-09-01' AND '2026-09-30' pierde los documentos del último día porque tienen hora; para filtrar o agrupar por día usa substr(fecha_recepcion, 1, 10) BETWEEN '2026-09-01' AND '2026-09-30' (o date(columna)).",
    'Hay varios contribuyentes en la misma base: filtra siempre por rut (y por periodo); mira contribuyente para conocerlos.',
    `RCV: lado es COMPRA o VENTA. estado_rcv: REGISTRO = documento aceptado en el registro, el único que da derecho a crédito fiscal (IVA de compras) y el que cuenta como débito en ventas; PENDIENTE = recibido sin decisión del receptor, todavía sin derecho a crédito; NO_INCLUIR = el receptor lo excluyó del registro; RECLAMADO = el receptor lo reclamó. Las ventas solo se guardan como REGISTRO. Para IVA considera REGISTRO salvo que se pida otra cosa.`,
    `Al sumar montos usa signo: -1 en las notas de crédito (tipo_doc ${TIPOS_DOC_NEGATIVOS.join(', ')}), 1 en el resto; por ejemplo SUM(signo * iva). Los montos de una nota de crédito vienen en positivo.`,
    `Totales de IVA y de montos por período: rcv_resumen, que incluye las boletas y comprobantes de venta (tipo_doc ${[...SOLO_RESUMEN_VENTA].join(', ')}); el SII las entrega solo como resumen y no existen en rcv_documento. Detalle por documento o contraparte (proveedor, cliente, folio, fechas): rcv_documento.`,
    `Tipos de documento (tipo_doc): ${tiposConNombre}. Otros códigos pueden aparecer sin nombre; rcv_resumen.descripcion trae el nombre del SII.`,
    `F29: f29_valor.codigo es texto (codigo = '538'). Códigos clave: ${codigosF29}. El crédito del F29 comparable con el RCV es '${CODIGO_F29.TOTAL_CREDITOS}' menos ${fueraDelRcv}. El PDF compacto del F29 omite las líneas vacías e impuestocl guarda cada línea con valor de la tabla del formulario, así que si el folio tiene filas en f29_valor un código ausente vale 0. Excepción, los totales: ${totalesAnulados}; si no, falta por una lectura fallida y queda sin dato. Si el folio no tiene ninguna fila, sus valores no se leyeron.`,
    "Un período puede tener varias declaraciones F29 (folios; por ejemplo rectificatorias). La vigente: solo cuentan las presentadas (folio > 0 y ni guardadas ni rechazadas ni anuladas: estado_id fuera de 10 y 70 y estado sin «guardad», «rechazad» ni «anulad»; un estado desconocido cuenta como presentado); si alguna tiene un estado con «vigente», se consideran solo esas y si no, todas las presentadas; gana la de fecha_presentacion más reciente (NULL es la más antigua) y, si empatan, el folio más alto. En SQL: `SELECT * FROM f29_declaracion WHERE rut = '<RUT>' AND periodo = '<AAAA-MM>' AND folio > 0 AND COALESCE(estado_id, 0) NOT IN (10, 70) AND estado NOT LIKE '%guardad%' AND estado NOT LIKE '%rechazad%' AND estado NOT LIKE '%anulad%' ORDER BY (estado LIKE '%vigente%') DESC, COALESCE(fecha_presentacion, '') DESC, folio DESC LIMIT 1`. Une sus valores por rut, periodo y folio.",
    "Propuesta del SII (f29_propuesta y f29_propuesta_valor, solo si se sincronizó la superficie propuesta): lo que el SII propone antes de declarar. Trae el crédito propuesto ('520'; '511' es el crédito neto por documentos), el remanente ('504') y la retención ('151'); no trae débito ni total a pagar, así que no sirve para saber si el F29 llevará pago. Con sin_propuesta = 1 el SII no propuso nada. No reemplaza al F29 declarado.",
    `Boletas de honorarios recibidas (bhe_recibida, solo si se sincronizó la superficie bhe): para montos usa solo las vigentes (anulada = 0). La retención del mes (SUM(retencion) con anulada = 0) se compara con el código '${CODIGO_F29.RETENCION_HONORARIOS}' (retención de honorarios) del F29 del mismo periodo; puede diferir si alguna boleta se pagó en otro mes o si el F29 incluye otras retenciones.`,
    'Que no haya filas no significa cero: un período no sincronizado no tiene filas. Revisa sincronizacion (el intento más reciente por rut, superficie y periodo): estado ok sin filas = el SII no tenía documentos o declaraciones; sin fila o con estado error = se desconoce, y los datos pueden estar incompletos o ser de un intento anterior.',
    'Cobertura: solo el RCV (compras y ventas), el F29, la propuesta del F29 y las boletas de honorarios recibidas traídos por impuestocl. No hay otros impuestos ni trámites del SII, y esto no es asesoría tributaria.',
  ];
}

/** Mapa de las tablas que ve `consultaSql` y reglas para interpretarlas; las reglas se arman desde las constantes del código. */
export function esquemaDatos(): EsquemaDatos {
  return { tablas: TABLAS, reglas: reglas() };
}
