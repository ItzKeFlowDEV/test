# flow-peds

Asignación de peds por jugador con panel de administración y menú NUI. Standalone (funciona con o sin framework).

## Instalación
1. Copia la carpeta `flow-peds` a `resources/`.
2. En `server.cfg`:
   ```
   ensure flow-peds
   add_ace group.admin flowpeds.admin allow
   ```
   (o pon los identificadores de los admins en `Config.Admins`).

## Comandos
- `/pedadmin` (solo admins): lista los jugadores conectados. Eliges a uno, escribes el modelo del ped (ej. `s_m_y_cop_01`) y un nombre opcional, y pulsas **Dar acceso**. Desde ahí también le quitas peds (botón ✕ en la tarjeta). El modelo se valida antes de guardarlo: si no existe en el juego / servidor, avisa.
- `/pedmenu`: el jugador ve solo los peds que le asignaron, se pone uno con un clic o vuelve a **Personaje normal**.

Los accesos se guardan por licencia en `data/peds.json` (sobreviven reinicios). Si a alguien le quitan el ped que lleva puesto, vuelve solo a su personaje.

## Volver al personaje normal
Con `Config.Restore = 'auto'` usa, en este orden: illenium-appearance / fivem-appearance (copia exacta antes de cambiarse), qb-clothing, esx_skin. Si no hay ninguno, guarda una copia de ropa, accesorios, pelo, rasgos y maquillaje antes de cambiarte y la restaura.

## Imágenes
Las tarjetas muestran la foto del ped desde `docs.fivem.net/peds/<modelo>.webp`. Los peds addon sin foto muestran una silueta; puedes ponerles imagen en `Config.CustomImages`.

## Exports
- Servidor: `exports['flow-peds']:hasPed(source, model)`, `exports['flow-peds']:getPeds(source)`
- Cliente: `exports['flow-peds']:getCurrentPed()`, `exports['flow-peds']:restoreNormal()`
