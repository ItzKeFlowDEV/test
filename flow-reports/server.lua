local RESOURCE = GetCurrentResourceName()
local reports = {}        -- [id] = report
local byPlayer = {}       -- [src] = id del reporte activo
local cooldown = {}       -- [src] = os.time() del ultimo reporte
local lastPos = {}        -- [target] = coords antes de "traer" (para devolver)
local nextId = 1

---------------------------------------------------------------- permisos
local ESX, QBCore
CreateThread(function()
    if GetResourceState('es_extended') == 'started' then pcall(function() ESX = exports['es_extended']:getSharedObject() end) end
    if GetResourceState('qb-core') == 'started' then pcall(function() QBCore = exports['qb-core']:GetCoreObject() end) end
end)

local function inGroups(g)
    for _, name in ipairs(Config.AdminGroups) do if g == name then return true end end
    return false
end

local function isAdmin(src)
    src = tonumber(src)
    if not src or not GetPlayerName(src) then return false end
    if IsPlayerAceAllowed(src, Config.AdminAce) then return true end
    if Config.AceCommandIsAdmin and IsPlayerAceAllowed(src, 'command') then return true end
    for _, g in ipairs(Config.AdminGroups) do
        if IsPlayerAceAllowed(src, 'group.' .. g) then return true end
    end
    if ESX then
        local ok, res = pcall(function() local x = ESX.GetPlayerFromId(src) return x and inGroups(x.getGroup()) end)
        if ok and res then return true end
    end
    if QBCore then
        for _, g in ipairs(Config.AdminGroups) do
            local ok, res = pcall(QBCore.Functions.HasPermission, src, g)
            if ok and res then return true end
        end
    end
    for _, id in ipairs(GetPlayerIdentifiers(src)) do
        for _, a in ipairs(Config.Admins) do if id == a then return true end end
    end
    return false
end
exports('isAdmin', isAdmin)

local function admins()
    local list = {}
    for _, id in ipairs(GetPlayers()) do
        if isAdmin(id) then list[#list + 1] = tonumber(id) end
    end
    return list
end

---------------------------------------------------------------- utilidades
local function notify(src, msg, kind)
    TriggerClientEvent('flowreports:notify', src, msg, kind or 'info')
end

local function now() return os.time() end

local function clean(text, max)
    if type(text) ~= 'string' then return '' end
    text = text:gsub('[%c<>]', ' '):gsub('%s+', ' '):gsub('^%s+', ''):gsub('%s+$', '')
    return text:sub(1, max)
end

local function category(id)
    for _, c in ipairs(Config.Categories) do if c.id == id then return c end end
end

local function queuePosition(report)
    if report.status ~= 'open' then return 0 end
    local pos = 1
    for _, r in pairs(reports) do
        if r.status == 'open' and r.created < report.created then pos = pos + 1 end
    end
    return pos
end

local function addMessage(report, from, name, text)
    report.messages[#report.messages + 1] = { from = from, name = name, text = text, t = now() }
    report.updated = now()
end

-- datos que ve el jugador de su propio reporte
local function playerView(report)
    if not report then return nil end
    return {
        id = report.id, category = report.category, message = report.message, created = report.created,
        status = report.status, position = queuePosition(report),
        admin = report.claimedBy and report.claimedBy.name or nil,
        messages = report.messages, serverNow = now()
    }
end

local function sendPlayer(report)
    if report and GetPlayerName(report.src) and not report.offline then
        TriggerClientEvent('flowreports:playerUpdate', report.src, playerView(report))
    end
end

local function adminList()
    local list = {}
    for _, r in pairs(reports) do list[#list + 1] = r end
    table.sort(list, function(a, b) return a.created < b.created end)
    return list
end

local function sendAdmins(newReport)
    local list = adminList()
    for _, a in ipairs(admins()) do
        TriggerClientEvent('flowreports:adminUpdate', a, list, now(), newReport)
    end
end

local function log(report)
    local data = json.decode(LoadResourceFile(RESOURCE, 'data/log.json') or '[]') or {}
    table.insert(data, 1, report)
    while #data > Config.LogClosed do table.remove(data) end
    SaveResourceFile(RESOURCE, 'data/log.json', json.encode(data), -1)
end

local function closeReport(report, byName, reason)
    report.status = 'closed'
    report.closedBy = byName
    report.closedAt = now()
    addMessage(report, 'system', 'Sistema', reason or ('Reporte cerrado por ' .. byName))
    sendPlayer(report)
    byPlayer[report.src] = nil
    reports[report.id] = nil
    log(report)
    sendAdmins()
end

---------------------------------------------------------------- jugador
RegisterCommand(Config.ReportCommand, function(src)
    if src == 0 then return end
    local id = byPlayer[src]
    TriggerClientEvent('flowreports:openPlayer', src, id and playerView(reports[id]) or nil, Config.Categories)
end, false)

RegisterNetEvent('flowreports:create', function(cat, message)
    local src = source
    if byPlayer[src] then return notify(src, 'Ya tienes un reporte abierto', 'error') end
    local c = category(cat)
    message = clean(message, Config.MaxMessage)
    if not c then return notify(src, 'Elige una categoría', 'error') end
    if #message < Config.MinMessage then return notify(src, ('Explica un poco más (mínimo %d letras)'):format(Config.MinMessage), 'error') end
    if cooldown[src] and now() - cooldown[src] < Config.Cooldown then
        return notify(src, ('Espera %d segundos para enviar otro reporte'):format(Config.Cooldown - (now() - cooldown[src])), 'error')
    end

    local report = {
        id = nextId, src = src, name = GetPlayerName(src), category = c.id, categoryLabel = c.label, icon = c.icon,
        message = message, created = now(), updated = now(), status = 'open', messages = {}
    }
    nextId = nextId + 1
    addMessage(report, 'player', report.name, message)
    reports[report.id] = report
    byPlayer[src] = report.id
    cooldown[src] = now()

    sendPlayer(report)
    sendAdmins(report)
    for _, r in pairs(reports) do if r ~= report then sendPlayer(r) end end   -- posiciones en la cola
end)

RegisterNetEvent('flowreports:playerMessage', function(text)
    local src = source
    local report = reports[byPlayer[src] or -1]
    text = clean(text, 300)
    if not report or text == '' then return end
    addMessage(report, 'player', report.name, text)
    sendPlayer(report)
    sendAdmins()
    if report.claimedBy then notify(report.claimedBy.src, ('Reporte #%d: nuevo mensaje de %s'):format(report.id, report.name), 'info') end
end)

RegisterNetEvent('flowreports:cancel', function()
    local src = source
    local report = reports[byPlayer[src] or -1]
    if report then closeReport(report, report.name, 'El jugador canceló el reporte') end
end)

AddEventHandler('playerDropped', function()
    local src = source
    local report = reports[byPlayer[src] or -1]
    if report then
        report.offline = true
        addMessage(report, 'system', 'Sistema', 'El jugador se desconectó')
        byPlayer[src] = nil
        sendAdmins()
    end
    cooldown[src], lastPos[src] = nil, nil
end)

---------------------------------------------------------------- admin
RegisterCommand(Config.AdminCommand, function(src)
    if src == 0 then return end
    if not isAdmin(src) then return notify(src, 'No tienes permiso para ver los reportes', 'error') end
    TriggerClientEvent('flowreports:openAdmin', src, adminList(), now(), { id = src, name = GetPlayerName(src) })
end, false)

local function adminReport(src, id)
    if not isAdmin(src) then return nil end
    return reports[tonumber(id) or -1]
end

RegisterNetEvent('flowreports:claim', function(id)
    local src = source
    local report = adminReport(src, id)
    if not report then return end
    if report.claimedBy and report.claimedBy.src ~= src then
        return notify(src, ('Ese reporte ya lo atiende %s'):format(report.claimedBy.name), 'error')
    end
    report.status = 'claimed'
    report.claimedBy = { src = src, name = GetPlayerName(src) }
    addMessage(report, 'system', 'Sistema', report.claimedBy.name .. ' está atendiendo tu reporte')
    sendPlayer(report)
    sendAdmins()
    for _, r in pairs(reports) do if r ~= report then sendPlayer(r) end end
end)

RegisterNetEvent('flowreports:unclaim', function(id)
    local src = source
    local report = adminReport(src, id)
    if not report or not report.claimedBy then return end
    report.status = 'open'
    report.claimedBy = nil
    addMessage(report, 'system', 'Sistema', 'Tu reporte volvió a la cola')
    sendPlayer(report)
    sendAdmins()
end)

RegisterNetEvent('flowreports:reply', function(id, text)
    local src = source
    local report = adminReport(src, id)
    text = clean(text, 300)
    if not report or text == '' then return end
    if not report.claimedBy then
        report.status = 'claimed'
        report.claimedBy = { src = src, name = GetPlayerName(src) }
    end
    addMessage(report, 'admin', GetPlayerName(src), text)
    sendPlayer(report)
    sendAdmins()
end)

RegisterNetEvent('flowreports:close', function(id)
    local src = source
    local report = adminReport(src, id)
    if report then closeReport(report, GetPlayerName(src)) end
end)

---------------------------------------------------------------- acciones sobre el jugador
local function coordsOf(src)
    local ped = GetPlayerPed(src)
    if not ped or ped == 0 then return nil end
    return GetEntityCoords(ped)
end

RegisterNetEvent('flowreports:action', function(id, action, value)
    local src = source
    local report = adminReport(src, id)
    if not report then return end
    local target = report.src
    if report.offline or not GetPlayerName(target) then return notify(src, 'El jugador ya no está conectado', 'error') end
    local adminName = GetPlayerName(src)

    if action == 'goto' then
        local c = coordsOf(target)
        if c then TriggerClientEvent('flowreports:teleport', src, c.x, c.y, c.z) end
        notify(src, 'Te teletransportaste a ' .. report.name, 'success')
    elseif action == 'bring' then
        local c, t = coordsOf(src), coordsOf(target)
        if c then
            lastPos[target] = t
            TriggerClientEvent('flowreports:teleport', target, c.x, c.y, c.z)
            notify(src, 'Trajiste a ' .. report.name, 'success')
        end
    elseif action == 'return' then
        local p = lastPos[target]
        if not p then return notify(src, 'No hay una posición anterior guardada', 'error') end
        TriggerClientEvent('flowreports:teleport', target, p.x, p.y, p.z)
        lastPos[target] = nil
        notify(src, report.name .. ' volvió a donde estaba', 'success')
    elseif action == 'revive' or action == 'heal' or action == 'skin' or action == 'freeze' then
        TriggerClientEvent('flowreports:doAction', target, action, adminName)
        notify(src, ({ revive = 'Reviviste a ', heal = 'Curaste a ', skin = 'Abriste el menú de ropa a ', freeze = 'Congelar / descongelar: ' })[action] .. report.name, 'success')
    elseif action == 'scale' then
        local s = tonumber(value) or 1.0
        s = math.max(Config.ScaleMin, math.min(Config.ScaleMax, s))
        Player(target).state:set('flowScale', s ~= 1.0 and s or nil, true)
        notify(src, ('Escala de %s: %.2f'):format(report.name, s), 'success')
    elseif action == 'kick' then
        local reason = clean(value, 120)
        if reason == '' then reason = 'Expulsado por un administrador' end
        closeReport(report, adminName, 'Jugador expulsado: ' .. reason)
        DropPlayer(target, reason)
        return
    else
        return
    end
    addMessage(report, 'system', 'Sistema', ('%s usó: %s'):format(adminName, ({
        ['goto'] = 'Ir al jugador', bring = 'Traer', ['return'] = 'Devolver', revive = 'Revivir', heal = 'Curar',
        skin = 'Menú de ropa', freeze = 'Congelar', scale = ('Escala %.2f'):format(tonumber(value) or 1)
    })[action]))
    sendAdmins()
end)
