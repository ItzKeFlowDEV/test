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
RegisterNUICallback('audioError', function(d, cb)
    notify('~r~Audio: ~s~' .. tostring(d.msg))
    cb('ok')
end)
RegisterNUICallback('removeSong', function(d, cb) TriggerServerEvent('chipeo:removeSong', d.id) cb('ok') end)

---------------------------------------------------------------- camara al ritmo del bajo
-- El NUI mide los graves ya atenuados por distancia y volumen y los envia aqui.
-- Modo 'pulse': en cada golpe de bajo la camara se aleja (FOV + retroceso) y vuelve suave a su sitio.
-- Modo 'shake': temblor clasico de camara mientras el bajo este fuerte.
local bassLevel = 0.0
local punch = 0.0      -- impulso objetivo (0-1)
local pulse = 0.0      -- valor suavizado aplicado a la camara

RegisterNUICallback('bass', function(d, cb)
    bassLevel = tonumber(d.level) or 0.0
    cb('ok')
end)

-- Cercania al vehiculo que suena: 1 dentro, baja con la distancia fuera (hasta Config.Shake.radius)
local function beatProximity(netId)
    local veh = netId and NetworkDoesNetworkIdExist(netId) and NetworkGetEntityFromNetworkId(netId) or 0
    if veh == 0 or not DoesEntityExist(veh) then return 0.0 end
    local ped = PlayerPedId()
    if GetVehiclePedIsIn(ped, false) == veh then return 1.0 end
    local d = #(GetEntityCoords(ped) - GetEntityCoords(veh))
    local n = math.max(0.0, 1.0 - d / Config.Shake.radius)
    return (n ^ 1.3) * Config.Shake.outsideStrength
end

RegisterNUICallback('beat', function(d, cb)
    cb('ok')
    local cfg = Config.Shake
    if not cfg.enabled then return end
    local lvl = tonumber(d.level) or 0.0
    if lvl <= cfg.threshold then return end
    local strength = math.min(1.0, (lvl - cfg.threshold) / (1.0 - cfg.threshold)) * beatProximity(tonumber(d.netId))
    if strength > 0.02 then punch = math.max(punch, strength) end
end)

local function canUseScriptCam(own)
    if IsPauseMenuActive() or IsPlayerSwitchInProgress() then return false end
    local rendering = GetRenderingCam()
    return rendering == -1 or rendering == own
end

CreateThread(function()
    local cfg = Config.Shake
    local cam, active = nil, false
    local shaking = false
    while true do
        if not cfg.enabled then
            Wait(500)
        elseif cfg.mode == 'shake' then
            -- temblor clasico
            local amp = math.max(0.0, (bassLevel - cfg.threshold) / (1.0 - cfg.threshold)) * cfg.maxAmplitude
            if amp > 0.02 then
                if IsGameplayCamShaking() then SetGameplayCamShakeAmplitude(amp) else ShakeGameplayCam(cfg.camShake, amp) end
                shaking = true
            elseif shaking then
                StopGameplayCamShaking(true)
                shaking = false
            end
            Wait(shaking and 0 or 150)
        else
            -- pulso: alejar y volver
            local dt = GetFrameTime()
            pulse = pulse + (punch - pulse) * math.min(1.0, dt * cfg.pulseAttack)   -- sube rapido
            punch = punch * (cfg.pulseRelease ^ (dt * 60.0))                        -- vuelve suave
            if pulse < 0.003 and punch < 0.003 then pulse, punch = 0.0, 0.0 end

            if pulse > 0.0 and canUseScriptCam(cam) then
                if not cam then cam = CreateCam('DEFAULT_SCRIPTED_CAMERA', false) end
                local pos, rot, fov = GetGameplayCamCoord(), GetGameplayCamRot(2), GetGameplayCamFov()
                local p, h = math.rad(rot.x), math.rad(rot.z)
                local fx, fy, fz = -math.sin(h) * math.cos(p), math.cos(h) * math.cos(p), math.sin(p)
                local back = pulse * cfg.pulseDistance
                SetCamCoord(cam, pos.x - fx * back, pos.y - fy * back, pos.z - fz * back)
                SetCamRot(cam, rot.x, rot.y, rot.z, 2)
                SetCamFov(cam, math.min(110.0, fov + pulse * cfg.pulseFov))
                if not active then
                    SetCamActive(cam, true)
                    RenderScriptCams(true, false, 0, false, false)
                    active = true
                end
                Wait(0)
            else
                if active then
                    RenderScriptCams(false, false, 0, false, false)
                    SetCamActive(cam, false)
                    active = false
                end
                Wait(punch > 0 and 0 or 50)
            end
        end
    end
end)

AddEventHandler('onResourceStop', function(res)
    if res ~= GetCurrentResourceName() then return end
    if GetRenderingCam() ~= -1 then RenderScriptCams(false, false, 0, false, false) end
    StopGameplayCamShaking(true)
end)

---------------------------------------------------------------- diagnostico (/chipeo_debug)
RegisterNUICallback('debugInfo', function(d, cb)
    print('^3[chipeo_audio] diagnostico NUI:^7 ' .. json.encode(d))
    cb('ok')
end)

RegisterCommand('chipeo_debug', function()
    local netId = currentVehicleNetId()
    print(('^3[chipeo_audio]^7 vehiculo netId=%s, estados activos=%s'):format(tostring(netId), json.encode(states)))
    SendNUIMessage({ action = 'debug' })
end, false)

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
            local inside = nil
            local myVehNet = myVeh ~= 0 and NetworkGetEntityIsNetworked(myVeh) and NetworkGetNetworkIdFromEntity(myVeh) or nil
            local camPos = GetGameplayCamCoord()
            local camRot = math.rad(GetGameplayCamRot(2).z)
            local rx, ry = math.cos(camRot), math.sin(camRot)   -- vector "derecha" de la camara

            for netId in pairs(states) do
                local veh = NetworkDoesNetworkIdExist(netId) and NetworkGetEntityFromNetworkId(netId) or 0
                local key = tostring(netId)
                if veh ~= 0 and DoesEntityExist(veh) then
                    if veh == myVeh or netId == myVehNet then
                        inside = netId
                        factors[key] = { f = 1.0, p = 0.0, m = 0.0 }
                    else
                        local vpos = GetEntityCoords(veh)
                        local d = #(pos - vpos)
                        local n = math.max(0.0, 1.0 - d / Config.MaxDistance)
                        -- caida de volumen mas natural (cerca fuerte, lejos se pierde suave)
                        local f = (n ^ 1.6) * Config.OutsideMuffle

                        -- panorama: izquierda/derecha segun hacia donde mira la camara
                        local dx, dy = vpos.x - camPos.x, vpos.y - camPos.y
                        local len = math.sqrt(dx * dx + dy * dy)
                        local p = len > 0.5 and ((dx * rx + dy * ry) / len) * 0.75 or 0.0

                        -- apagado (paso bajo): puertas/maletero/ventanas abiertas dejan salir los agudos
                        local open = 0.0
                        for door = 0, 5 do
                            if GetVehicleDoorAngleRatio(veh, door) > 0.1 then open = math.max(open, door >= 4 and 1.0 or 0.6) end
                        end
                        for w = 0, 3 do
                            if not IsVehicleWindowIntact(veh, w) then open = math.max(open, 0.45) end
                        end
                        local m = Config.ClosedMuffle * (1.0 - open) + (1.0 - n) * 0.35
                        if myVeh ~= 0 then m = m + 0.2 end -- tu tambien estas dentro de otro carro
                        if open >= 1.0 then f = math.min(1.0, f * 1.35) end -- maletero abierto: suena mas

                        factors[key] = { f = f, p = p, m = math.min(1.0, m) }
                    end
                else
                    factors[key] = { f = 0.0, p = 0.0, m = 1.0 }
                end
            end

            local temp, volt = 0, 12.4
            if myVeh ~= 0 then
                temp = GetVehicleEngineTemperature(myVeh)
                volt = GetIsVehicleEngineRunning(myVeh) and 13.3 or 12.4
            end
            SendNUIMessage({ action = 'tick', factors = factors, inside = inside, temp = temp, volt = volt })

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
