import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { describe, expect, it } from 'vitest';
import type { DepsApp } from '../../src/app/deps.js';
import { crearServidorMcp, HERRAMIENTAS } from '../../src/interfaces/mcp/servidor.js';
import { declaracion, fila, perfilEmpresa, resumen, RUT_EMPRESA, valores } from '../helpers/fabricas.js';
import { depsDePrueba } from '../helpers/deps.js';
import { sembrarMes } from '../helpers/sembrar.js';

async function conectar(deps: DepsApp) {
  const servidor = crearServidorMcp(deps, '0.1.0-test');
  const [ladoCliente, ladoServidor] = InMemoryTransport.createLinkedPair();
  await servidor.connect(ladoServidor);
  const cliente = new Client({ name: 'prueba', version: '1.0.0' });
  await cliente.connect(ladoCliente);
  return cliente;
}

const textoDe = (r: unknown): string => (r as { content: { type: string; text: string }[] }).content[0]?.text ?? '';
const esError = (r: unknown): boolean => (r as { isError?: boolean }).isError === true;

describe('servidor MCP', () => {
  it('expone exactamente las 7 herramientas, ninguna pide una clave y las consultas son de solo lectura', async () => {
    const cliente = await conectar(depsDePrueba().deps);
    const { tools } = await cliente.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...HERRAMIENTAS].sort());
    expect(JSON.stringify(tools.map((t) => t.inputSchema)).toLowerCase()).not.toMatch(/clave|password|contrase/);
    expect(tools.find((t) => t.name === 'iva_resumen')?.annotations?.readOnlyHint).toBe(true);
    expect(tools.find((t) => t.name === 'sincronizar')?.annotations?.readOnlyHint).toBe(false);
    await cliente.close();
  });

  it('iva_resumen responde con el texto del resumen y los datos', async () => {
    const { deps, store } = depsDePrueba();
    store.guardarContribuyente(perfilEmpresa());
    sembrarMes(store, '2026-09', { resumenes: [resumen({ lado: 'VENTA', filas: [fila(33, 1_000_000, 190_000, 2)] })], declaraciones: [declaracion()], valores: [valores({ '538': 190_000, '537': 0 })] });
    const cliente = await conectar(deps);
    const r = await cliente.callTool({ name: 'iva_resumen', arguments: { rut: '22.222.222-2', periodo: '2026-09' } });
    expect(esError(r)).toBe(false);
    expect(textoDe(r)).toContain('IVA 2026-09 — 22222222-2');
    expect(textoDe(r)).toContain('"debitoRcv": 190000');
    await cliente.close();
  });

  it('un error de dominio vuelve como resultado de error de la herramienta', async () => {
    const cliente = await conectar(depsDePrueba().deps);
    const r = await cliente.callTool({ name: 'iva_resumen', arguments: { rut: RUT_EMPRESA, periodo: '2026-09' } });
    expect(esError(r)).toBe(true);
    expect(textoDe(r)).toContain('PERFIL_NO_EXISTE');
    await cliente.close();
  });

  it('valida el formato del período', async () => {
    const cliente = await conectar(depsDePrueba().deps);
    const r = await cliente.callTool({ name: 'iva_resumen', arguments: { rut: RUT_EMPRESA, periodo: '2026-9' } });
    expect(esError(r)).toBe(true);
    await cliente.close();
  });

  it('sincronizar usa el lector del SII y resume lo traído', async () => {
    const { deps, store, sii } = depsDePrueba();
    store.guardarContribuyente(perfilEmpresa());
    sii.declaraciones.set('2026-09', []);
    const cliente = await conectar(deps);
    const r = await cliente.callTool({ name: 'sincronizar', arguments: { rut: RUT_EMPRESA, desde: '2026-09' } });
    expect(textoDe(r)).toContain('Sincronización 22222222-2');
    expect(sii.llamadas).toContain('f29|2026-09');
    await cliente.close();
  });
});
