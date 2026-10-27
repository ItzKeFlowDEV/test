# flow-peds

Asignación de peds por jugador con panel de administración y menú NUI. Standalone (funciona con o sin framework).

## Instalación
1. Copia la carpeta `flow-peds` a `resources/`.
2. En `server.cfg`:
   ```
   ensure flow-peds
   ```
   No hace falta nada más para los admins: `/pedadmin` lo pueden usar
   - los **group.admin** de ACE / txAdmin (los que tienen `add_ace group.admin command allow`, que viene por defecto),
   - los grupos de admin de **ESX** (`admin`, `superadmin`...) y **QBCore** (`admin`, `god`...), y **QBox/ox** por `group.admin`,
   - cualquiera con el permiso `flowpeds.admin`, o con su identificador en `Config.Admins`.

   Los grupos se cambian en `Config.AdminGroups`. Si quieres que solo entren los que tengan `flowpeds.admin`, pon `Config.AceCommandIsAdmin = false` y deja `Config.AdminGroups = {}`.

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
