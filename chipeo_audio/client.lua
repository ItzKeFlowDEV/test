local uiOpen = false
local states = {}      -- [netId] = true mientras haya audio activo en ese vehiculo
local currentNetId = nil

local function currentVehicleNetId()
    local ped = PlayerPedId()
    local veh = GetVehiclePedIsIn(ped, false)
    if veh == 0 or not NetworkGetEntityIsNetworked(veh) then return nil, nil end
    if Config.DriverOnly and GetPedInVehicleSeat(veh, -1) ~= ped then return nil, nil end
    return NetworkGetNetworkIdFromEntity(veh), veh
end

local function notify(msg)
    BeginTextCommandThefeedPost('STRING')
    AddTextComponentSubstringPlayerName(msg)
    EndTextCommandThefeedPostTicker(false, false)
end

local function setUi(open)
    uiOpen = open
    SetNuiFocus(open, open)
    SendNUIMessage({ action = open and 'open' or 'close', netId = currentNetId })
end

local function toggle()
    if uiOpen then return setUi(false) end
    local netId = currentVehicleNetId()
    if not netId then return notify('Debes estar dentro de un vehiculo') end
    currentNetId = netId
    TriggerServerEvent('chipeo:getLibrary')
    setUi(true)
end

RegisterCommand(Config.Command, toggle, false)
RegisterKeyMapping(Config.Command, 'Abrir sistema de audio del vehiculo', 'keyboard', Config.DefaultKey)

---------------------------------------------------------------- NUI -> cliente
local function nui(name, fn)
    RegisterNUICallback(name, function(data, cb)
        if currentNetId then fn(data or {}) end
        cb('ok')
    end)
end

RegisterNUICallback('close', function(_, cb) setUi(false) cb('ok') end)

nui('play',     function(d) TriggerServerEvent('chipeo:play', currentNetId, d.url, d.title) end)
nui('pause',    function() TriggerServerEvent('chipeo:pause', currentNetId) end)
nui('resume',   function() TriggerServerEvent('chipeo:resume', currentNetId) end)
nui('stop',     function() TriggerServerEvent('chipeo:stop', currentNetId) end)
nui('seek',     function(d) TriggerServerEvent('chipeo:seek', currentNetId, tonumber(d.time) or 0) end)
nui('settings', function(d) TriggerServerEvent('chipeo:settings', currentNetId, d) end)
nui('ended',    function() TriggerServerEvent('chipeo:ended', currentNetId) end)
nui('addSong',  function(d) TriggerServerEvent('chipeo:addSong', d.title, d.url) end)
nui('clone',    function(d) TriggerServerEvent('chipeo:cloneCurrent', currentNetId, d.title) end)
RegisterNUICallback('removeSong', function(d, cb) TriggerServerEvent('chipeo:removeSong', d.id) cb('ok') end)

---------------------------------------------------------------- vibracion por graves
-- El NUI mide los graves ya atenuados por distancia y volumen y los envia aqui.
local bassLevel = 0.0

RegisterNUICallback('bass', function(d, cb)
    bassLevel = tonumber(d.level) or 0.0
    cb('ok')
end)

CreateThread(function()
    local shaking = false
    local cfg = Config.Shake
    while true do
        if cfg.enabled and (bassLevel > cfg.threshold or shaking) then
            local amp = math.max(0.0, (bassLevel - cfg.threshold) / (1.0 - cfg.threshold)) * cfg.maxAmplitude
            if amp > 0.02 then
                if IsGameplayCamShaking() then
                    SetGameplayCamShakeAmplitude(amp)
                else
                    ShakeGameplayCam(cfg.camShake, amp)
                end
                shaking = true
            elseif shaking then
                StopGameplayCamShaking(true)
                shaking = false
            end
            Wait(0)
        else
            Wait(150)
        end
    end
end)

---------------------------------------------------------------- servidor -> cliente
RegisterNetEvent('chipeo:library', function(list)
    SendNUIMessage({ action = 'library', list = list })
end)

RegisterNetEvent('chipeo:notify', notify)

RegisterNetEvent('chipeo:sync', function(netId, state, serverNow)
    states[netId] = true
    SendNUIMessage({ action = 'sync', netId = netId, state = state, serverNow = serverNow })
end)

RegisterNetEvent('chipeo:remove', function(netId)
    states[netId] = nil
    SendNUIMessage({ action = 'remove', netId = netId })
end)

CreateThread(function()
    Wait(2000)
    TriggerServerEvent('chipeo:requestStates')
end)

---------------------------------------------------------------- volumen por distancia + telemetria
CreateThread(function()
    while true do
        if next(states) or uiOpen then
            local ped = PlayerPedId()
            local myVeh = GetVehiclePedIsIn(ped, false)
            local pos = GetEntityCoords(ped)
            local factors = {}

            for netId in pairs(states) do
                local veh = NetworkDoesNetworkIdExist(netId) and NetworkGetEntityFromNetworkId(netId) or 0
                if veh ~= 0 and DoesEntityExist(veh) then
                    if veh == myVeh then
                        factors[netId] = 1.0
                    else
                        local d = #(pos - GetEntityCoords(veh))
                        local f = math.max(0.0, 1.0 - d / Config.MaxDistance)
                        factors[netId] = f * f * Config.OutsideMuffle
                    end
                else
                    factors[netId] = 0.0
                end
            end

            local temp, volt = 0, 12.4
            if myVeh ~= 0 then
                temp = GetVehicleEngineTemperature(myVeh)
                volt = GetIsVehicleEngineRunning(myVeh) and 13.3 or 12.4
            end
            SendNUIMessage({ action = 'tick', factors = factors, temp = temp, volt = volt })

            if uiOpen and myVeh == 0 then setUi(false) end
            Wait(150)
        else
            Wait(500)
        end
    end
end)

AddEventHandler('onResourceStop', function(res)
    if res == GetCurrentResourceName() and uiOpen then SetNuiFocus(false, false) end
end)
