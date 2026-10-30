import type { Notificador } from '../../ports/index.js';
import { ejecutorSistema, type Ejecutor } from './ejecutor.js';

/**
 * Notificación de Windows con la API de notificaciones de Windows PowerShell 5.1 (`powershell.exe`, que sí carga los tipos
 * de WinRT). El título y el cuerpo llegan por variables de entorno y se insertan como texto del XML: nunca se interpretan.
 */
export const SCRIPT_NOTIFICACION = [
  '[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null',
  '$xml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)',
  '$textos = $xml.GetElementsByTagName("text")',
  '$textos.Item(0).AppendChild($xml.CreateTextNode($env:MI_SII_MCP_TITULO)) | Out-Null',
  '$textos.Item(1).AppendChild($xml.CreateTextNode($env:MI_SII_MCP_CUERPO)) | Out-Null',
  '$app = "{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe"',
  '[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($app).Show([Windows.UI.Notifications.ToastNotification]::new($xml))',
].join('; ');

export class NotificadorWindows implements Notificador {
  constructor(private readonly ejecutar: Ejecutor = ejecutorSistema) {}

  async notificar(titulo: string, cuerpo: string): Promise<boolean> {
    const r = await this.ejecutar('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', SCRIPT_NOTIFICACION], {
      MI_SII_MCP_TITULO: titulo,
      MI_SII_MCP_CUERPO: cuerpo,
    });
    return r.codigo === 0;
  }
}
