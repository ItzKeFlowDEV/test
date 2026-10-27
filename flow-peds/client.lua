local view = nil          -- 'menu' | 'admin' | nil
local myPeds = {}
local currentPed = nil    -- modelo del ped puesto; nil = personaje normal
local snapshot = nil      -- copia de la apariencia normal (cuando no hay script de ropa)
local appearance = nil    -- copia via exports de illenium / fivem-appearance

local function notify(msg, kind)
    SendNUIMessage({ action = 'notify', msg = msg, kind = kind })
    if not view then
        BeginTextCommandThefeedPost('STRING')
        AddTextComponentSubstringPlayerName(msg)
        EndTextCommandThefeedPostTicker(false, false)
    end
end
RegisterNetEvent('flowpeds:notify', notify)

local function open(v, data)
    view = v
    SetNuiFocus(true, true)
    SendNUIMessage({
        action = v == 'admin' and 'openAdmin' or 'openMenu',
        players = v == 'admin' and data or nil,
        peds = v == 'menu' and data or nil,
        current = currentPed,
        imageUrl = Config.ImageUrl,
        customImages = Config.CustomImages,
        menuCommand = Config.MenuCommand
    })
end

local function close()
    view = nil
    SetNuiFocus(false, false)
    SendNUIMessage({ action = 'close' })
end

---------------------------------------------------------------- apariencia normal
local function started(res) return GetResourceState(res) == 'started' end

local appearanceRes = nil
local function appearanceResource()
    if Config.Restore ~= 'auto' then return nil end
    for _, res in ipairs({ 'illenium-appearance', 'fivem-appearance' }) do
        if started(res) then return res end
    end
end

-- Copia manual: modelo, ropa, accesorios, pelo, rasgos y maquillaje
local function takeSnapshot(ped)
    local s = { model = GetEntityModel(ped), comps = {}, props = {}, features = {}, overlays = {} }
    for i = 0, 11 do
        s.comps[i] = { GetPedDrawableVariation(ped, i), GetPedTextureVariation(ped, i), GetPedPaletteVariation(ped, i) }
    end
    for i = 0, 7 do
        s.props[i] = { GetPedPropIndex(ped, i), GetPedPropTextureIndex(ped, i) }
    end
    s.hair = { GetPedHairColor(ped), GetPedHairHighlightColor(ped) }
    s.eyes = GetPedEyeColor(ped)
    for i = 0, 19 do s.features[i] = GetPedFaceFeature(ped, i) end
    for i = 0, 12 do
        local ok, value, colourType, c1, c2, opacity = GetPedHeadOverlayData(ped, i)
        if ok then s.overlays[i] = { value, colourType, c1, c2, opacity } end
    end
    return s
end

local function loadModel(hash)
    if not IsModelInCdimage(hash) or not IsModelAPed(hash) then return false end
    RequestModel(hash)
    local timeout = GetGameTimer() + 8000
    while not HasModelLoaded(hash) do
        if GetGameTimer() > timeout then return false end
        Wait(10)
    end
    return true
end

local function setModelKeepingStats(hash)
    local ped = PlayerPedId()
    local health, armour = GetEntityHealth(ped), GetPedArmour(ped)
    SetPlayerModel(PlayerId(), hash)
    SetModelAsNoLongerNeeded(hash)
    ped = PlayerPedId()
    SetEntityHealth(ped, math.min(health, GetEntityMaxHealth(ped)))
    SetPedArmour(ped, armour)
    return ped
end

local function applySnapshot(s)
    if not loadModel(s.model) then return false end
    local ped = setModelKeepingStats(s.model)
    for i, c in pairs(s.comps) do SetPedComponentVariation(ped, i, c[1], c[2], c[3]) end
    for i, p in pairs(s.props) do
        if p[1] == -1 then ClearPedProp(ped, i) else SetPedPropIndex(ped, i, p[1], p[2], true) end
    end
    SetPedHairColor(ped, s.hair[1], s.hair[2])
    SetPedEyeColor(ped, s.eyes)
    for i, v in pairs(s.features) do SetPedFaceFeature(ped, i, v) end
    for i, o in pairs(s.overlays) do
        SetPedHeadOverlay(ped, i, o[1], o[5])
        if o[2] > 0 then SetPedHeadOverlayColor(ped, i, o[2], o[3], o[4]) end
    end
    return true
end

-- Se llama justo antes de cambiar del personaje normal a un ped
local function saveNormal()
    local ped = PlayerPedId()
    appearanceRes = appearanceResource()
    appearance, snapshot = nil, nil
    if appearanceRes then
        local ok, app = pcall(function() return exports[appearanceRes]:getPedAppearance(ped) end)
        if ok and app then appearance = app return end
    end
    snapshot = takeSnapshot(ped)
end

local function restoreNormal()
    if not currentPed then return notify('Ya estas con tu personaje normal', 'info') end

    if appearance and appearanceRes and started(appearanceRes) then
        local ok = pcall(function() exports[appearanceRes]:setPlayerAppearance(appearance) end)
        if ok then currentPed = nil return true end
    end
    if Config.Restore == 'auto' then
        if started('illenium-appearance') then
            TriggerEvent('illenium-appearance:client:reloadSkin')
            currentPed = nil return true
        elseif started('qb-clothing') then
            TriggerServerEvent('qb-clothes:loadPlayerSkin')
            currentPed = nil return true
        elseif started('esx_skin') and started('es_extended') then
            local ESX = exports['es_extended']:getSharedObject()
            ESX.TriggerServerCallback('esx_skin:getPlayerSkin', function(skin)
                if skin then TriggerEvent('skinchanger:loadSkin', skin) end
            end)
            currentPed = nil return true
        end
    end
    if snapshot and applySnapshot(snapshot) then
        currentPed = nil
        return true
    end
    notify('No se pudo restaurar tu personaje (no hay copia guardada)', 'error')
    return false
end

local function applyPed(model)
    local hash = GetHashKey(model)
    if not IsModelInCdimage(hash) or not IsModelAPed(hash) then
        return notify(('El modelo %s no existe en el servidor'):format(model), 'error')
    end
    if not loadModel(hash) then return notify('No se pudo cargar el modelo', 'error') end
    if not currentPed then saveNormal() end
    local ped = setModelKeepingStats(hash)
    SetPedDefaultComponentVariation(ped)
    currentPed = model
    SendNUIMessage({ action = 'current', current = currentPed })
    notify('Ahora eres ' .. model, 'success')
end

---------------------------------------------------------------- eventos del servidor
RegisterNetEvent('flowpeds:openMenu', function(peds)
    myPeds = peds or {}
    open('menu', myPeds)
end)

RegisterNetEvent('flowpeds:openAdmin', function(players)
    open('admin', players)
end)

RegisterNetEvent('flowpeds:adminData', function(players)
    SendNUIMessage({ action = 'adminData', players = players })
end)

RegisterNetEvent('flowpeds:myPeds', function(peds)
    myPeds = peds or {}
    SendNUIMessage({ action = 'myPeds', peds = myPeds })
end)

RegisterNetEvent('flowpeds:apply', applyPed)

-- si un admin te quita el ped que llevas puesto, vuelves a tu personaje
RegisterNetEvent('flowpeds:revoked', function(model)
    if currentPed == model then
        restoreNormal()
        SendNUIMessage({ action = 'current', current = currentPed })
        notify('Te quitaron el acceso al ped ' .. model, 'error')
    end
end)

---------------------------------------------------------------- NUI
RegisterNUICallback('close', function(_, cb) close() cb('ok') end)

RegisterNUICallback('use', function(d, cb)
    cb('ok')
    if type(d.model) == 'string' then TriggerServerEvent('flowpeds:use', d.model) end
end)

RegisterNUICallback('normal', function(_, cb)
    cb('ok')
    if restoreNormal() then
        SendNUIMessage({ action = 'current', current = currentPed })
        notify('Volviste a tu personaje normal', 'success')
    end
end)

RegisterNUICallback('grant', function(d, cb)
    local model = type(d.model) == 'string' and d.model:lower():gsub('%s', '') or ''
    local hash = GetHashKey(model)
    if model == '' or not IsModelInCdimage(hash) or not IsModelAPed(hash) then
        return cb({ ok = false, msg = ('"%s" no es un modelo de ped valido'):format(model) })
    end
    TriggerServerEvent('flowpeds:grant', d.target, model, d.label)
    cb({ ok = true })
end)

RegisterNUICallback('revoke', function(d, cb)
    TriggerServerEvent('flowpeds:revoke', d.target, d.model)
    cb('ok')
end)

RegisterNUICallback('refresh', function(_, cb)
    TriggerServerEvent('flowpeds:refreshAdmin')
    cb('ok')
end)

AddEventHandler('onResourceStop', function(res)
    if res == GetCurrentResourceName() and view then SetNuiFocus(false, false) end
end)

exports('getCurrentPed', function() return currentPed end)
exports('restoreNormal', restoreNormal)
