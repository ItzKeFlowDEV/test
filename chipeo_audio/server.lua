local RESOURCE = GetCurrentResourceName()
local FILE = 'data/library.json'

local library = json.decode(LoadResourceFile(RESOURCE, FILE) or '{}') or {}
local states = {} -- [netId] = { url, title, playing, position, updatedAt, volume, settings }

local function save()
    SaveResourceFile(RESOURCE, FILE, json.encode(library), -1)
end

local function identifier(src)
    return GetPlayerIdentifierByType(src, 'license') or GetPlayerIdentifierByType(src, 'fivem') or ('src:' .. src)
end

local blockedHosts = { 'spotify.com', 'soundcloud.com', 'music.apple.com', 'tiktok.com' }

-- Devuelve true, o false + motivo
local function validUrl(url)
    if type(url) ~= 'string' or #url > 500 then return false, 'Enlace no valido' end
    local host = url:match('^https?://([^/%?#:]+)')
    if not host then return false, 'El enlace debe empezar con https://' end
    host = host:lower()
    if host == 'youtu.be' or host == 'youtube.com' or host:sub(-12) == '.youtube.com' then
        if url:match('youtu%.be/[%w_%-]+') or url:match('[%?&]v=[%w_%-]+') or url:match('/shorts/[%w_%-]+')
            or url:match('/embed/[%w_%-]+') or url:match('/live/[%w_%-]+') then
            return true
        end
        return false, 'Enlace de YouTube no valido (debe ser de un video)'
    end
    for _, h in ipairs(blockedHosts) do
        if host == h or host:sub(-#h - 1) == '.' .. h then
            return false, 'Ese enlace es una pagina web, no un archivo. Usa YouTube o un enlace DIRECTO a un .mp3/.wav'
        end
    end
    if Config.RequireExtension then
        local path = url:lower():gsub('[?#].*$', '')
        for _, ext in ipairs(Config.AllowedExt) do
            if path:sub(-#ext) == ext then return true end
        end
        return false, 'El enlace debe terminar en .mp3, .wav u .ogg'
    end
    return true
end

local function cleanTitle(t, fallback)
    t = type(t) == 'string' and t:gsub('[%c<>]', ''):sub(1, 40) or ''
    if t:match('^%s*$') then return fallback end
    return t
end

local function notify(src, msg)
    TriggerClientEvent('chipeo:notify', src, msg)
end

local function sendLibrary(src)
    TriggerClientEvent('chipeo:library', src, library[identifier(src)] or {})
end

-- El jugador debe estar dentro del vehiculo que intenta controlar
local function canControl(src, netId)
    if type(netId) ~= 'number' then return false end
    local veh = NetworkGetEntityFromNetworkId(netId)
    if not veh or veh == 0 or not DoesEntityExist(veh) then return false end
    local ped = GetPlayerPed(src)
    if GetVehiclePedIsIn(ped, false) ~= veh then return false end
    if Config.DriverOnly and GetPedInVehicleSeat(veh, -1) ~= ped then return false end
    return true
end

local function broadcast(netId)
    if states[netId] then
        TriggerClientEvent('chipeo:sync', -1, netId, states[netId], GetGameTimer())
    else
        TriggerClientEvent('chipeo:remove', -1, netId)
    end
end

local function currentPosition(st)
    if not st.playing then return st.position end
    return st.position + (GetGameTimer() - st.updatedAt) / 1000.0
end

local function defaultSettings()
    local amps = {}
    for i = 1, 3 do
        amps[i] = { vol = 0.5, fader = 0.5, sub = 0.5, freq = 0.4, eq = { 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5 } }
    end
    return { master = 0.7, bassBoost = false, amps = amps }
end

---------------------------------------------------------------- biblioteca
RegisterNetEvent('chipeo:getLibrary', function() sendLibrary(source) end)

RegisterNetEvent('chipeo:addSong', function(title, url)
    local src = source
    local ok, why = validUrl(url)
    if not ok then return notify(src, why) end
    local id = identifier(src)
    library[id] = library[id] or {}
    if #library[id] >= Config.MaxSongs then return notify(src, 'Tu biblioteca esta llena') end
    for _, s in ipairs(library[id]) do
        if s.url == url then return notify(src, 'Esa cancion ya esta en tu biblioteca') end
    end
    library[id][#library[id] + 1] = {
        id = ('%d%d'):format(os.time(), math.random(100, 999)),
        title = cleanTitle(title, 'Cancion'),
        url = url
    }
    save()
    sendLibrary(src)
    notify(src, 'Cancion guardada')
end)

RegisterNetEvent('chipeo:removeSong', function(songId)
    local src = source
    local list = library[identifier(src)] or {}
    for i, s in ipairs(list) do
        if s.id == songId then table.remove(list, i) break end
    end
    save()
    sendLibrary(src)
end)

-- Clona (guarda en tu biblioteca) la cancion que suena ahora en el vehiculo
RegisterNetEvent('chipeo:cloneCurrent', function(netId, title)
    local src = source
    local st = states[netId]
    if not st or not canControl(src, netId) then return notify(src, 'No hay nada sonando para clonar') end
    TriggerEvent('chipeo:internalAdd', src, cleanTitle(title, st.title), st.url)
end)
AddEventHandler('chipeo:internalAdd', function(src, title, url)
    local id = identifier(src)
    library[id] = library[id] or {}
    if #library[id] >= Config.MaxSongs then return notify(src, 'Tu biblioteca esta llena') end
    library[id][#library[id] + 1] = { id = ('%d%d'):format(os.time(), math.random(100, 999)), title = title, url = url }
    save()
    sendLibrary(src)
    notify(src, 'USB clonada a tu biblioteca')
end)

---------------------------------------------------------------- reproduccion
RegisterNetEvent('chipeo:play', function(netId, url, title)
    local src = source
    if not canControl(src, netId) then
        return notify(src, 'No se pudo controlar el equipo (debes estar dentro del vehiculo)')
    end
    local ok, why = validUrl(url)
    if not ok then return notify(src, why) end
    if Config.Debug then print(('[chipeo_audio] %s reproduce %s en netId %s'):format(GetPlayerName(src), url, netId)) end
    local old = states[netId]
    states[netId] = {
        url = url,
        title = cleanTitle(title, 'Cancion'),
        playing = true,
        position = 0.0,
        updatedAt = GetGameTimer(),
        settings = old and old.settings or defaultSettings()
    }
    broadcast(netId)
end)

RegisterNetEvent('chipeo:pause', function(netId)
    local st = states[netId]
    if not st or not canControl(source, netId) then return end
    st.position = currentPosition(st)
    st.playing = false
    st.updatedAt = GetGameTimer()
    broadcast(netId)
end)

RegisterNetEvent('chipeo:resume', function(netId)
    local st = states[netId]
    if not st or not canControl(source, netId) then return end
    st.playing = true
    st.updatedAt = GetGameTimer()
    broadcast(netId)
end)

RegisterNetEvent('chipeo:stop', function(netId)
    if not states[netId] or not canControl(source, netId) then return end
    states[netId] = nil
    broadcast(netId)
end)

RegisterNetEvent('chipeo:seek', function(netId, seconds)
    local st = states[netId]
    if not st or type(seconds) ~= 'number' or not canControl(source, netId) then return end
    st.position = math.max(0.0, seconds)
    st.updatedAt = GetGameTimer()
    broadcast(netId)
end)

RegisterNetEvent('chipeo:settings', function(netId, settings)
    local st = states[netId]
    if not st or type(settings) ~= 'table' or not canControl(source, netId) then return end
    local function n(v, d) v = tonumber(v) or d return math.min(1.0, math.max(0.0, v)) end
    local clean = { master = n(settings.master, 0.7), bassBoost = settings.bassBoost == true, amps = {} }
    for i = 1, 3 do
        local a = (settings.amps or {})[i] or {}
        clean.amps[i] = { vol = n(a.vol, 0.5), fader = n(a.fader, 0.5), sub = n(a.sub, 0.5), freq = n(a.freq, 0.4), eq = {} }
        for b = 1, 7 do clean.amps[i].eq[b] = n((a.eq or {})[b], 0.5) end
    end
    st.settings = clean
    broadcast(netId)
end)

RegisterNetEvent('chipeo:ended', function(netId)
    local st = states[netId]
    if st and st.playing and currentPosition(st) > 5.0 then
        states[netId] = nil
        broadcast(netId)
    end
end)

RegisterNetEvent('chipeo:requestStates', function()
    local src = source
    for netId, st in pairs(states) do
        TriggerClientEvent('chipeo:sync', src, netId, st, GetGameTimer())
    end
end)

-- Limpieza de vehiculos eliminados
CreateThread(function()
    while true do
        Wait(10000)
        for netId in pairs(states) do
            local veh = NetworkGetEntityFromNetworkId(netId)
            if not veh or veh == 0 or not DoesEntityExist(veh) then
                states[netId] = nil
                broadcast(netId)
            end
        end
    end
end)
