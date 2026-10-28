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

-- ===================== efectos de pista (puntos que pone el admin en cada cabina) =====================
-- asset/name: particulas de GTA. Si alguna no te gusta, cambiala aqui.
Config.MaxFxPoints = 12
Config.Effects = {
    fire     = { label = 'Fuego',   asset = 'core', name = 'ent_sht_flame',          looped = true,  scale = 2.6, duration = 1500, zOff = 0.0 },
    smoke    = { label = 'Humo',    asset = 'core', name = 'exp_grd_grenade_smoke',  looped = true,  scale = 0.9, duration = 4500, zOff = 0.0 },
    confetti = { label = 'Confeti', asset = 'scr_xs_celebration', name = 'scr_xs_confetti_burst', looped = false, scale = 1.5, zOff = 1.2 },
}
Config.FxCooldown = 1.2       -- segundos entre disparos del mismo efecto

-- ===================== sonidos de DJ (se generan en el juego, no necesitan archivos) =====================
Config.Sounds = { 'airhorn', 'siren', 'rewind', 'boom', 'scratch', 'applause' }

-- ===================== micro del DJ =====================
-- Con pma-voice usa overrideProximityRange; sin pma-voice usa la proximidad nativa de FiveM.
Config.MicDuck = 0.22         -- volumen de la musica mientras el DJ habla (0.22 = baja al 22%)
Config.MicMaxDistance = 15.0  -- si el DJ se aleja mas de esto de la cabina, el micro se apaga solo

-- ===================== transiciones =====================
Config.Transition = { mode = 'fade', secs = 6, auto = true }   -- mode: 'cut' | 'fade' | 'filter'
