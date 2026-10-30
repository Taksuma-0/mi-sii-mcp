export interface Migracion {
  readonly version: number;
  readonly sql: string;
}

const V1 = `
CREATE TABLE contribuyente (
  rut TEXT PRIMARY KEY,
  alias TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('persona', 'empresa')),
  razon_social TEXT,
  representa_json TEXT NOT NULL DEFAULT '[]',
  creado_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE sincronizacion (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rut TEXT NOT NULL,
  superficie TEXT NOT NULL,
  periodo TEXT NOT NULL,
  iniciado_en TEXT NOT NULL,
  terminado_en TEXT,
  estado TEXT NOT NULL DEFAULT 'en_curso' CHECK (estado IN ('en_curso', 'ok', 'error')),
  error_codigo TEXT,
  error_detalle TEXT
);
CREATE INDEX ix_sincronizacion ON sincronizacion (rut, periodo, superficie);

CREATE TABLE respuesta_cruda (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sincronizacion_id INTEGER NOT NULL REFERENCES sincronizacion (id),
  superficie TEXT NOT NULL,
  parametros_json TEXT NOT NULL,
  cuerpo TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  obtenido_en TEXT NOT NULL
);

CREATE TABLE rcv_resumen (
  rut TEXT NOT NULL,
  periodo TEXT NOT NULL,
  lado TEXT NOT NULL,
  estado_rcv TEXT NOT NULL,
  tipo_doc INTEGER NOT NULL,
  descripcion TEXT,
  cantidad INTEGER NOT NULL,
  exento INTEGER NOT NULL,
  neto INTEGER NOT NULL,
  iva INTEGER NOT NULL,
  total INTEGER NOT NULL,
  sincronizacion_id INTEGER NOT NULL REFERENCES sincronizacion (id),
  obtenido_en TEXT NOT NULL,
  PRIMARY KEY (rut, periodo, lado, estado_rcv, tipo_doc)
);

CREATE TABLE rcv_documento (
  rut TEXT NOT NULL,
  periodo TEXT NOT NULL,
  lado TEXT NOT NULL,
  estado_rcv TEXT NOT NULL,
  tipo_doc INTEGER NOT NULL,
  rut_contraparte TEXT NOT NULL,
  folio INTEGER NOT NULL,
  razon_social TEXT,
  fecha_emision TEXT,
  fecha_recepcion TEXT,
  fecha_acuse TEXT,
  monto_exento INTEGER NOT NULL,
  monto_neto INTEGER NOT NULL,
  monto_iva INTEGER NOT NULL,
  monto_iva_no_recuperable INTEGER NOT NULL,
  monto_iva_uso_comun INTEGER NOT NULL,
  monto_total INTEGER NOT NULL,
  tipo_compra TEXT,
  evento_receptor TEXT,
  sincronizacion_id INTEGER NOT NULL REFERENCES sincronizacion (id),
  obtenido_en TEXT NOT NULL,
  PRIMARY KEY (rut, lado, tipo_doc, rut_contraparte, folio)
);
CREATE INDEX ix_documento_periodo ON rcv_documento (rut, periodo, lado, estado_rcv);

CREATE TABLE rcv_documento_snapshot (
  sincronizacion_id INTEGER NOT NULL REFERENCES sincronizacion (id),
  rut TEXT NOT NULL,
  periodo TEXT NOT NULL,
  clave_doc TEXT NOT NULL,
  estado_rcv TEXT NOT NULL,
  sha256_fila TEXT NOT NULL,
  PRIMARY KEY (sincronizacion_id, clave_doc)
);
CREATE INDEX ix_snapshot ON rcv_documento_snapshot (rut, periodo);

CREATE TABLE f29_declaracion (
  rut TEXT NOT NULL,
  periodo TEXT NOT NULL,
  folio INTEGER NOT NULL,
  estado TEXT NOT NULL,
  fecha_presentacion TEXT,
  codigo_interno INTEGER,
  total_a_pagar INTEGER,
  sincronizacion_id INTEGER NOT NULL REFERENCES sincronizacion (id),
  obtenido_en TEXT NOT NULL,
  PRIMARY KEY (rut, periodo, folio)
);

CREATE TABLE f29_valor (
  rut TEXT NOT NULL,
  periodo TEXT NOT NULL,
  folio INTEGER NOT NULL,
  codigo TEXT NOT NULL,
  valor REAL NOT NULL,
  PRIMARY KEY (rut, periodo, folio, codigo)
);

CREATE TABLE hallazgo (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rut TEXT NOT NULL,
  periodo TEXT NOT NULL,
  regla TEXT NOT NULL,
  severidad TEXT NOT NULL,
  naturaleza TEXT NOT NULL,
  titulo TEXT NOT NULL,
  detalle TEXT NOT NULL,
  datos_json TEXT NOT NULL,
  version_reglas TEXT NOT NULL,
  calculado_en TEXT NOT NULL
);
CREATE INDEX ix_hallazgo ON hallazgo (rut, periodo);
`;

/** Id del estado de la declaración según el SII (10 guardada, 70 rechazada, entre otros); NULL en lo ya guardado. */
const V2 = `
ALTER TABLE f29_declaracion ADD COLUMN estado_id INTEGER;
`;

/** Cómo se leyó cada folio guardado del F29: versión del lector, origen y si el autocontrol cuadró. */
const V3 = `
CREATE TABLE f29_lectura (
  rut TEXT NOT NULL,
  periodo TEXT NOT NULL,
  folio INTEGER NOT NULL,
  version_lector TEXT NOT NULL,
  origen TEXT NOT NULL CHECK (origen IN ('sincronizacion', 'relectura')),
  leido_en TEXT NOT NULL,
  codigos INTEGER NOT NULL,
  coherente INTEGER NOT NULL CHECK (coherente IN (0, 1)),
  PRIMARY KEY (rut, periodo, folio)
);
`;

/** Propuesta de F29 del SII por mes: cabecera y los códigos propuestos y administrativos (nunca los de identificación). */
const V4 = `
CREATE TABLE f29_propuesta (
  rut TEXT NOT NULL,
  periodo TEXT NOT NULL,
  tipo_propuesta INTEGER,
  descripcion_tipo TEXT,
  estado_calculo INTEGER,
  sin_propuesta INTEGER NOT NULL CHECK (sin_propuesta IN (0, 1)),
  sincronizacion_id INTEGER NOT NULL REFERENCES sincronizacion (id),
  obtenido_en TEXT NOT NULL,
  PRIMARY KEY (rut, periodo)
);

CREATE TABLE f29_propuesta_valor (
  rut TEXT NOT NULL,
  periodo TEXT NOT NULL,
  lista TEXT NOT NULL CHECK (lista IN ('propuesto', 'administrativo')),
  codigo TEXT NOT NULL,
  valor REAL NOT NULL,
  PRIMARY KEY (rut, periodo, lista, codigo)
);
`;

/**
 * Boletas de honorarios electrónicas recibidas, por receptor, emisor y folio (una boleta pertenece a un solo mes). Sin
 * código de barras ni comuna del emisor.
 */
const V5 = `
CREATE TABLE bhe_recibida (
  rut TEXT NOT NULL,
  periodo TEXT NOT NULL,
  rut_emisor TEXT NOT NULL,
  folio INTEGER NOT NULL,
  nombre_emisor TEXT,
  fecha TEXT,
  bruto INTEGER NOT NULL,
  retencion INTEGER NOT NULL,
  liquido INTEGER NOT NULL,
  sociedad_profesional INTEGER NOT NULL CHECK (sociedad_profesional IN (0, 1)),
  anulada INTEGER NOT NULL CHECK (anulada IN (0, 1)),
  fecha_anulacion TEXT,
  sincronizacion_id INTEGER NOT NULL REFERENCES sincronizacion (id),
  obtenido_en TEXT NOT NULL,
  PRIMARY KEY (rut, rut_emisor, folio)
);
CREATE INDEX ix_bhe_recibida ON bhe_recibida (rut, periodo);
`;

/**
 * Cuenta del SII. El perfil tributario de Mi SII es solo una lista permitida (sin nombres, correo, teléfonos ni
 * direcciones; los atributos solo traen valor si no es personal). Las empresas autorizadas se reemplazan completas en
 * cada lectura; fecha_desautorizacion NULL = activa.
 */
const V6 = `
CREATE TABLE contribuyente_tributario (
  rut TEXT PRIMARY KEY,
  autorizado_dia20 INTEGER CHECK (autorizado_dia20 IN (0, 1)),
  tipo_codigo TEXT,
  tipo_descripcion TEXT,
  subtipo_codigo TEXT,
  subtipo_descripcion TEXT,
  segmento_codigo TEXT,
  segmento_descripcion TEXT,
  glosa_actividad TEXT,
  fecha_inicio_actividades TEXT,
  fecha_termino_giro TEXT,
  persona_empresa TEXT,
  atributos_json TEXT NOT NULL DEFAULT '[]',
  obtenido_en TEXT NOT NULL
);

CREATE TABLE sii_empresa_autorizada (
  rut TEXT NOT NULL,
  rut_empresa TEXT NOT NULL,
  razon_social TEXT,
  privilegios TEXT,
  fecha_desautorizacion TEXT,
  sincronizacion_id INTEGER NOT NULL REFERENCES sincronizacion (id),
  obtenido_en TEXT NOT NULL,
  PRIMARY KEY (rut, rut_empresa)
);
`;

/**
 * Renta anual (F22) por año tributario y folio. Solo campos permitidos: sin nombres, domicilio, cuenta ni banco; los
 * códigos de identificación del compacto no se guardan, y las observaciones y eventos van sin enlace ni referencia.
 */
const V7 = `
CREATE TABLE f22_declaracion (
  rut TEXT NOT NULL,
  anio_tributario INTEGER NOT NULL,
  folio INTEGER NOT NULL,
  vigente INTEGER CHECK (vigente IN (0, 1)),
  codigo_conclusion TEXT,
  conclusion TEXT,
  fecha_ingreso TEXT,
  tipo_impugnado TEXT,
  remanente_solicitado INTEGER,
  remanente_devuelto INTEGER,
  impuesto_pagado INTEGER,
  monto_giro INTEGER,
  fecha_vencimiento TEXT,
  sincronizacion_id INTEGER NOT NULL REFERENCES sincronizacion (id),
  obtenido_en TEXT NOT NULL,
  PRIMARY KEY (rut, anio_tributario, folio)
);

CREATE TABLE f22_valor (
  rut TEXT NOT NULL,
  anio_tributario INTEGER NOT NULL,
  folio INTEGER NOT NULL,
  codigo TEXT NOT NULL,
  valor REAL,
  glosa TEXT,
  PRIMARY KEY (rut, anio_tributario, folio, codigo)
);

CREATE TABLE f22_observacion (
  rut TEXT NOT NULL,
  anio_tributario INTEGER NOT NULL,
  folio INTEGER NOT NULL,
  codigo TEXT NOT NULL,
  descripcion TEXT,
  PRIMARY KEY (rut, anio_tributario, folio, codigo)
);

CREATE TABLE f22_evento (
  rut TEXT NOT NULL,
  anio_tributario INTEGER NOT NULL,
  folio INTEGER NOT NULL,
  orden INTEGER NOT NULL,
  codigo_evento TEXT,
  nombre TEXT,
  fecha TEXT,
  tipo TEXT,
  codigo_carta TEXT,
  PRIMARY KEY (rut, anio_tributario, folio, orden)
);
`;

/** Con qué sesión se entra al SII por cada contribuyente (p. ej., la empresa vía su representante); NULL = la propia. */
const V8 = `
ALTER TABLE contribuyente ADD COLUMN acceso_rut TEXT;
`;

/**
 * Informe anual de boletas de honorarios emitidas por el contribuyente: una fila por año comercial (anio) y mes, con
 * montos nominales. Se reemplaza el año completo en cada lectura; un mes sin boletas queda en 0 y sin folios.
 */
const V9 = `
CREATE TABLE bhe_emitida_mes (
  rut TEXT NOT NULL,
  anio INTEGER NOT NULL,
  mes INTEGER NOT NULL CHECK (mes BETWEEN 1 AND 12),
  bruto INTEGER NOT NULL,
  retencion_terceros INTEGER NOT NULL,
  retencion_propia INTEGER NOT NULL,
  vigentes INTEGER NOT NULL,
  anuladas INTEGER NOT NULL,
  folio_inicial INTEGER,
  folio_final INTEGER,
  sincronizacion_id INTEGER NOT NULL REFERENCES sincronizacion (id),
  obtenido_en TEXT NOT NULL,
  PRIMARY KEY (rut, anio, mes)
);
`;

/**
 * Boletas de honorarios emitidas por el contribuyente, boleta por boleta, del informe mensual del SII: una fila por mes
 * (periodo AAAA-MM) y folio. Sin la identidad del emisor (es el propio contribuyente), el correo del receptor ni el
 * código de barras. Se reemplaza el mes completo en cada lectura.
 */
const V10 = `
CREATE TABLE bhe_emitida (
  rut TEXT NOT NULL,
  periodo TEXT NOT NULL,
  folio INTEGER NOT NULL,
  rut_receptor TEXT NOT NULL,
  nombre_receptor TEXT,
  fecha TEXT,
  fecha_emision TEXT,
  bruto INTEGER NOT NULL,
  retencion_emisor INTEGER NOT NULL,
  retencion_receptor INTEGER NOT NULL,
  liquido INTEGER NOT NULL,
  sociedad_profesional INTEGER NOT NULL CHECK (sociedad_profesional IN (0, 1)),
  anulada INTEGER NOT NULL CHECK (anulada IN (0, 1)),
  fecha_anulacion TEXT,
  sincronizacion_id INTEGER NOT NULL REFERENCES sincronizacion (id),
  obtenido_en TEXT NOT NULL,
  PRIMARY KEY (rut, periodo, folio)
);
`;

/**
 * Declaraciones juradas que terceros informaron al SII sobre el contribuyente (rentas informadas por terceros): una fila
 * por año tributario, DJ, informante y folio. `meses` son los meses con rentas separados por coma ("7,8,9"; vacío si
 * ninguno) y `montos_json` las columnas de montos de la DJ (cabecera → monto o null). La retención de honorarios, la
 * renta del sueldo y el impuesto único son NULL si las cabeceras de la DJ no los traen. Se reemplaza el año y la DJ
 * completos en cada lectura. Sin datos de contacto de los informantes.
 */
const V11 = `
CREATE TABLE dj_tercero (
  rut TEXT NOT NULL,
  anio_tributario INTEGER NOT NULL,
  dj INTEGER NOT NULL,
  informante_rut TEXT NOT NULL,
  informante_nombre TEXT,
  estado TEXT,
  observada INTEGER NOT NULL CHECK (observada IN (0, 1)),
  certificado TEXT,
  folio INTEGER NOT NULL,
  fecha_presentacion TEXT,
  meses TEXT NOT NULL,
  montos_json TEXT NOT NULL,
  retencion_honorarios INTEGER,
  renta_sueldo INTEGER,
  impuesto_unico_retenido INTEGER,
  sincronizacion_id INTEGER NOT NULL REFERENCES sincronizacion (id),
  obtenido_en TEXT NOT NULL,
  PRIMARY KEY (rut, anio_tributario, dj, informante_rut, folio)
);
`;

/**
 * Cartolas bancarias que importa la persona y su conciliación con lo que sabe el SII. De la cuenta solo se guarda su alias.
 * `orden` es la posición del movimiento en su archivo (ordena los del mismo día). En la conciliación, una fila con
 * criterio `manual` y sin clave es un movimiento descartado a mano; una partida solo puede estar en un movimiento.
 */
const V12 = `
CREATE TABLE banco_importacion (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rut TEXT NOT NULL,
  cuenta TEXT NOT NULL,
  archivo TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  filas INTEGER NOT NULL,
  nuevos INTEGER NOT NULL,
  desde TEXT,
  hasta TEXT,
  importado_en TEXT NOT NULL
);

CREATE TABLE banco_movimiento (
  rut TEXT NOT NULL,
  huella TEXT NOT NULL,
  cuenta TEXT NOT NULL,
  fecha TEXT NOT NULL,
  descripcion TEXT NOT NULL,
  documento TEXT,
  monto INTEGER NOT NULL,
  saldo INTEGER,
  orden INTEGER NOT NULL,
  importacion_id INTEGER NOT NULL REFERENCES banco_importacion (id),
  PRIMARY KEY (rut, huella)
);
CREATE INDEX ix_banco_movimiento ON banco_movimiento (rut, fecha);

CREATE TABLE conciliacion_bancaria (
  rut TEXT NOT NULL,
  huella TEXT NOT NULL,
  tipo TEXT,
  clave TEXT,
  criterio TEXT NOT NULL CHECK (criterio IN ('monto_rut', 'monto_fecha', 'manual')),
  dias INTEGER,
  creado_en TEXT NOT NULL,
  PRIMARY KEY (rut, huella)
);
CREATE UNIQUE INDEX ux_conciliacion_partida ON conciliacion_bancaria (rut, tipo, clave) WHERE clave IS NOT NULL;
`;

export const MIGRACIONES: readonly Migracion[] = [
  { version: 1, sql: V1 },
  { version: 2, sql: V2 },
  { version: 3, sql: V3 },
  { version: 4, sql: V4 },
  { version: 5, sql: V5 },
  { version: 6, sql: V6 },
  { version: 7, sql: V7 },
  { version: 8, sql: V8 },
  { version: 9, sql: V9 },
  { version: 10, sql: V10 },
  { version: 11, sql: V11 },
  { version: 12, sql: V12 },
];
