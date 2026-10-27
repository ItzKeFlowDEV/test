Config = {}

Config.AdminCommand = 'pedadmin'   -- panel para dar/quitar peds
Config.MenuCommand  = 'pedmenu'    -- menu del jugador para cambiarse de ped

-- Quien puede usar /pedadmin (basta con cumplir UNA):
--  1) Grupos de admin de tu framework (ESX: getGroup() · QBCore: permisos · QBox/ox: ACE group.xxx)
Config.AdminGroups = { 'admin', 'superadmin', 'god', 'owner', 'mod', 'moderator' }
--  2) Admins por ACE: el permiso de abajo, o cualquiera que tenga 'command' (el group.admin de txAdmin
--     ya lo trae: add_ace group.admin command allow)
Config.AdminAce = 'flowpeds.admin'
Config.AceCommandIsAdmin = true
--  3) Identificadores sueltos (license:xxxx, discord:xxxx, fivem:xxxx ...)
Config.Admins = {
    -- 'license:0000000000000000000000000000000000000000',
}

-- Como volver al personaje normal:
--  'auto'  = detecta illenium-appearance / fivem-appearance / qb-clothing / esx_skin y si no hay ninguno
--            guarda una copia de tu ropa antes de cambiarte y la restaura
--  'snapshot' = siempre usar la copia guardada
Config.Restore = 'auto'

-- Imagen de cada ped en el menu (%s = nombre del modelo). Los peds addon sin imagen muestran una silueta.
Config.ImageUrl = 'https://docs.fivem.net/peds/%s.webp'

-- Imagenes propias para peds addon: ['modelo'] = 'https://...'
Config.CustomImages = {
}

Config.MaxPedsPerPlayer = 40
