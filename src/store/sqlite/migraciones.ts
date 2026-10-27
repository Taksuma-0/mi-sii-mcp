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

export const MIGRACIONES: readonly Migracion[] = [
  { version: 1, sql: V1 },
  { version: 2, sql: V2 },
];
