Config = {}

Config.AdminCommand = 'pedadmin'   -- panel para dar/quitar peds
Config.MenuCommand  = 'pedmenu'    -- menu del jugador para cambiarse de ped

-- Quien puede usar /pedadmin:
--  1) cualquiera con el permiso ACE de abajo   (server.cfg: add_ace group.admin flowpeds.admin allow)
--  2) o los identificadores de esta lista      (license:xxxx, discord:xxxx, fivem:xxxx ...)
Config.AdminAce = 'flowpeds.admin'
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
