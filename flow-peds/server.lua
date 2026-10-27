local RESOURCE = GetCurrentResourceName()
local FILE = 'data/peds.json'

-- [license] = { name = 'Ultimo nombre visto', peds = { { model = 'a_m_y_x', label = 'Nombre' }, ... } }
local db = json.decode(LoadResourceFile(RESOURCE, FILE) or '{}') or {}

local function save()
    SaveResourceFile(RESOURCE, FILE, json.encode(db), -1)
end

local function license(src)
    return GetPlayerIdentifierByType(src, 'license') or GetPlayerIdentifierByType(src, 'fivem')
end

local function notify(src, msg, kind)
    TriggerClientEvent('flowpeds:notify', src, msg, kind or 'info')
end

local function isAdmin(src)
    if IsPlayerAceAllowed(src, Config.AdminAce) then return true end
    for _, id in ipairs(GetPlayerIdentifiers(src)) do
        for _, admin in ipairs(Config.Admins) do
            if id == admin then return true end
        end
    end
    return false
end

local function pedsOf(src)
    local lic = license(src)
    return lic and db[lic] and db[lic].peds or {}
end

local function hasPed(src, model)
    for _, p in ipairs(pedsOf(src)) do
        if p.model == model then return true end
    end
    return false
end
exports('hasPed', hasPed)
exports('getPeds', pedsOf)

local function cleanModel(m)
    if type(m) ~= 'string' then return nil end
    m = m:lower():gsub('%s', '')
    if #m < 2 or #m > 48 or not m:match('^[%w_%-]+$') then return nil end
    return m
end

local function cleanLabel(l, fallback)
    l = type(l) == 'string' and l:gsub('[%c<>]', ''):sub(1, 32) or ''
    if l:match('^%s*$') then return fallback end
    return l
end

local function adminData()
    local players = {}
    for _, id in ipairs(GetPlayers()) do
        local src = tonumber(id)
        players[#players + 1] = { id = src, name = GetPlayerName(src), peds = pedsOf(src) }
    end
    table.sort(players, function(a, b) return a.id < b.id end)
    return players
end

local function sendAdmin(src)
    TriggerClientEvent('flowpeds:adminData', src, adminData())
end

local function sendMine(src)
    TriggerClientEvent('flowpeds:myPeds', src, pedsOf(src))
end

---------------------------------------------------------------- comandos
RegisterCommand(Config.AdminCommand, function(src)
    if src == 0 then return print('[flow-peds] usa este comando dentro del juego') end
    if not isAdmin(src) then return notify(src, 'No tienes permiso para usar este comando', 'error') end
    TriggerClientEvent('flowpeds:openAdmin', src, adminData())
end, false)

RegisterCommand(Config.MenuCommand, function(src)
    if src == 0 then return end
    TriggerClientEvent('flowpeds:openMenu', src, pedsOf(src))
end, false)

---------------------------------------------------------------- admin
RegisterNetEvent('flowpeds:grant', function(target, model, label)
    local src = source
    if not isAdmin(src) then return end
    target = tonumber(target)
    if not target or not GetPlayerName(target) then return notify(src, 'Ese jugador ya no esta conectado', 'error') end
    model = cleanModel(model)
    if not model then return notify(src, 'Nombre de modelo no valido', 'error') end

    local lic = license(target)
    if not lic then return notify(src, 'No se pudo identificar al jugador', 'error') end
    db[lic] = db[lic] or { peds = {} }
    db[lic].name = GetPlayerName(target)
    local list = db[lic].peds
    for _, p in ipairs(list) do
        if p.model == model then return notify(src, 'Ese jugador ya tiene ese ped', 'error') end
    end
    if #list >= Config.MaxPedsPerPlayer then return notify(src, 'Ese jugador llego al maximo de peds', 'error') end

    list[#list + 1] = { model = model, label = cleanLabel(label, model) }
    save()
    sendAdmin(src)
    sendMine(target)
    notify(src, ('Ped %s asignado a %s'):format(model, GetPlayerName(target)), 'success')
    if target ~= src then notify(target, ('Un admin te dio acceso al ped %s · usa /%s'):format(list[#list].label, Config.MenuCommand), 'success') end
end)

RegisterNetEvent('flowpeds:revoke', function(target, model)
    local src = source
    if not isAdmin(src) then return end
    target = tonumber(target)
    local lic = target and license(target)
    if not lic or not db[lic] then return end
    for i, p in ipairs(db[lic].peds) do
        if p.model == model then
            table.remove(db[lic].peds, i)
            save()
            sendAdmin(src)
            sendMine(target)
            TriggerClientEvent('flowpeds:revoked', target, model)
            return notify(src, ('Ped %s quitado'):format(model), 'success')
        end
    end
end)

RegisterNetEvent('flowpeds:refreshAdmin', function()
    local src = source
    if isAdmin(src) then sendAdmin(src) end
end)

---------------------------------------------------------------- jugador
RegisterNetEvent('flowpeds:use', function(model)
    local src = source
    if type(model) ~= 'string' or not hasPed(src, model) then
        return notify(src, 'No tienes acceso a ese ped', 'error')
    end
    TriggerClientEvent('flowpeds:apply', src, model)
end)

-- actualiza el nombre guardado al entrar
AddEventHandler('playerJoining', function()
    local src = source
    local lic = license(src)
    if lic and db[lic] then db[lic].name = GetPlayerName(src) end
end)
