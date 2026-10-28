# flow-reports

Sistema de reportes con cola, chat jugador ↔ admin y acciones de administración. Standalone (ESX, QBCore, QBox o sin framework).

## Instalación
1. Copia `flow-reports` a `resources/` y pon `ensure flow-reports` en `server.cfg`.
2. Admins: ya entran los `group.admin` de ACE/txAdmin (`add_ace group.admin command allow`), los grupos de admin de ESX / QBCore / QBox,
   quien tenga `flowreports.admin` o su identificador en `Config.Admins`. Se ajusta en `config.lua`.

## Jugador · `/reportar`
- Elige categoría (Bug, Reportar jugador, Ayuda, Pérdida de items, Vehículo, Otro) y escribe el mensaje (mínimo 10 letras).
- Queda **en cola** con su posición y un contador de tiempo. Si cierra el menú, abajo se queda una **barra de carga**
  “Esperando por respuesta de administrador”. Cambia cuando un admin lo atiende o le responde (con sonido).
- Con `/reportar` otra vez ve su reporte, chatea con el admin o lo cancela.
- **Captura de pantalla**: botón 📷 en el chat → saca una captura del juego, la ve antes y la envía al reporte. El admin la ve en el chat y la amplía con un clic. Necesita el recurso **screenshot-basic** (`ensure screenshot-basic` antes de flow-reports). Máx. `Config.MaxScreenshots` por reporte.
- Antiflood: un reporte abierto a la vez y `Config.Cooldown` segundos entre reportes.

## Admin · `/reportes`
- Lista de reportes con filtros (Todos / En cola / Míos), búsqueda, tiempo esperando y quién lo atiende.
- **Reclamar** / **Liberar** / **Cerrar** y chat con el jugador.
- Acciones: **Ir**, **Traer**, **Devolver** (a donde estaba antes de traerlo), **Revivir**, **Curar**, **Skin** (abre el menú de ropa),
  **Escala** (le abre al jugador el menú de escala para que él elija su tamaño, 0.5x–1.5x; todos lo ven así), **Congelar** y **Expulsar** con motivo.
- Aviso a todos los admins cuando entra un reporte nuevo y un contador de “reportes abiertos” arriba a la derecha.
- Los reportes cerrados se guardan en `data/log.json` (últimos 200).

## Ajustes
- Menú de escala: si ya usas otro script de escala, ábrelo en `Config.OpenScaleMenu` (ej. `ExecuteCommand('scalemenu') return true`).
- Menú de ropa: `Config.OpenSkinMenu` (detecta illenium-appearance, fivem-appearance, qb-clothing y esx_skin; cámbialo si usas otro).
- Revivir / curar: lo hace el script y además lanza los eventos de tu framework (`Config.ReviveEvents`, `Config.HealEvents`).
