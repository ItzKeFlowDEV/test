Config = {}

Config.AdminCommand = 'djadmin'     -- panel para crear / editar cabinas
Config.InteractKey  = 38            -- E
Config.MaxQueue     = 40            -- canciones maximas en la cola de cada cabina
Config.MaxRadius    = 250.0         -- metros maximos que un admin puede poner

-- Valores por defecto al crear una cabina
Config.Defaults = {
    radius = 40.0,       -- metros que se escucha
    volume = 0.85,       -- volumen maximo de la cabina (0 - 1)
    interact = 2.5,      -- metros para abrir la cabina
    access = 'all',      -- 'all' (cualquiera) | 'job' (solo un trabajo) | 'admin'
    job = '',
    blip = true,
}

Config.Blip = { sprite = 614, color = 27, scale = 0.8 }

-- Quien es admin (basta con cumplir UNA)
Config.AdminGroups = { 'admin', 'superadmin', 'god', 'owner', 'mod', 'moderator' }
Config.AdminAce = 'flowdj.admin'
Config.AceCommandIsAdmin = true
Config.Admins = {
    -- 'license:0000000000000000000000000000000000000000',
}

-- Trabajo del jugador para cabinas con access = 'job' (ESX / QBCore / QBox). Cambialo si usas otro framework.
Config.GetJob = function(src)
    if GetResourceState('qbx_core') == 'started' then
        local p = exports.qbx_core:GetPlayer(src)
        return p and p.PlayerData.job.name
    elseif GetResourceState('qb-core') == 'started' then
        local p = exports['qb-core']:GetCoreObject().Functions.GetPlayer(src)
        return p and p.PlayerData.job.name
    elseif GetResourceState('es_extended') == 'started' then
        local x = exports['es_extended']:getSharedObject().GetPlayerFromId(src)
        return x and x.job.name
    end
end
