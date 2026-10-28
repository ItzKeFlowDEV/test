local booths = {}          -- lista de cabinas
local states = {}          -- [id] = estado (cola / cancion)
local view = nil           -- 'dj' | 'admin' | nil
local openBooth = nil
local editing = nil        -- cabina que el admin esta editando (para dibujar el radio)
local blips = {}
local micOn, micBooth = false, nil

local function notify(msg, kind) SendNUIMessage({ action = 'notify', msg = msg, kind = kind }) end
RegisterNetEvent('flowdj:notify', notify)

local function vec(c) return vector3(c.x, c.y, c.z) end

---------------------------------------------------------------- blips
local function refreshBlips()
    for _, b in pairs(blips) do RemoveBlip(b) end
    blips = {}
    for _, b in ipairs(booths) do
        if b.blip then
            local bl = AddBlipForCoord(b.coords.x, b.coords.y, b.coords.z)
            SetBlipSprite(bl, Config.Blip.sprite)
            SetBlipColour(bl, Config.Blip.color)
            SetBlipScale(bl, Config.Blip.scale)
            SetBlipAsShortRange(bl, true)
            BeginTextCommandSetBlipName('STRING')
            AddTextComponentSubstringPlayerName(b.name)
            EndTextCommandSetBlipName(bl)
            blips[b.id] = bl
        end
    end
end

RegisterNetEvent('flowdj:booths', function(list)
    booths = list or {}
    refreshBlips()
    SendNUIMessage({ action = 'booths', booths = booths })
end)

RegisterNetEvent('flowdj:state', function(id, st, serverNow)
    states[id] = st
    local b
    for _, x in ipairs(booths) do if x.id == id then b = x end end
    SendNUIMessage({ action = 'state', id = id, state = st, serverNow = serverNow, booth = b })
end)

CreateThread(function()
    Wait(1500)
    TriggerServerEvent('flowdj:hello')
end)

---------------------------------------------------------------- micro del DJ
local talking = false
local prevProximity = nil
function setMic(on)
    if on == micOn then return end
    if on then
        local b
        for _, x in ipairs(booths) do if x.id == openBooth then b = x end end
        if not b then return end
        micOn, micBooth = true, b
        if GetResourceState('pma-voice') == 'started' then
            pcall(function() exports['pma-voice']:overrideProximityRange(b.radius, true) end)
        else
            prevProximity = NetworkGetTalkerProximity()
            NetworkSetTalkerProximity(b.radius)
        end
        -- con el panel abierto dejamos pasar solo la tecla de voz
        if view then SetNuiFocusKeepInput(true) end
    else
        micOn = false
        if GetResourceState('pma-voice') == 'started' then
            pcall(function() exports['pma-voice']:clearProximityOverride() end)
        elseif prevProximity then
            NetworkSetTalkerProximity(prevProximity)
        end
        SetNuiFocusKeepInput(false)
        if talking and micBooth then TriggerServerEvent('flowdj:duck', micBooth.id, false) end
        talking, micBooth = false, nil
    end
    SendNUIMessage({ action = 'mic', on = micOn, booth = micBooth and micBooth.name })
end

CreateThread(function()
    while true do
        if micOn and micBooth then
            -- con el panel abierto y el micro activo: bloqueamos todo menos hablar
            if view then
                DisableAllControlActions(0)
                EnableControlAction(0, 249, true)   -- push to talk
            end
            local now = NetworkIsPlayerTalking(PlayerId())
            if now ~= talking then
                talking = now
                TriggerServerEvent('flowdj:duck', micBooth.id, talking)
                SendNUIMessage({ action = 'micTalking', on = talking })
            end
            local c = micBooth.coords
            if #(GetEntityCoords(PlayerPedId()) - vector3(c.x, c.y, c.z)) > (micBooth.interact or 2.5) + Config.MicMaxDistance then
                setMic(false)
            end
            Wait(view and 0 or 120)
        else
            Wait(400)
        end
    end
end)

---------------------------------------------------------------- efectos de pista y sonidos
local function loadAsset(asset)
    if HasNamedPtfxAssetLoaded(asset) then return true end
    RequestNamedPtfxAsset(asset)
    local t = GetGameTimer() + 3000
    while not HasNamedPtfxAssetLoaded(asset) and GetGameTimer() < t do Wait(0) end
    return HasNamedPtfxAssetLoaded(asset)
end

RegisterNetEvent('flowdj:fx', function(id, kind)
    local b
    for _, x in ipairs(booths) do if x.id == id then b = x end end
    local cfg = Config.Effects[kind]
    if not b or not cfg or not b.fx then return end
    local c = b.coords
    if #(GetEntityCoords(PlayerPedId()) - vector3(c.x, c.y, c.z)) > b.radius + 60.0 then return end
    if not loadAsset(cfg.asset) then return end
    SendNUIMessage({ action = 'sfx', id = id, name = kind == 'fire' and 'flame' or kind == 'confetti' and 'pop' or 'hiss' })
    local handles = {}
    for _, p in ipairs(b.fx) do
        UseParticleFxAssetNextCall(cfg.asset)
        if cfg.looped then
            handles[#handles + 1] = StartParticleFxLoopedAtCoord(cfg.name, p.x, p.y, p.z + (cfg.zOff or 0.0), 0.0, 0.0, 0.0, cfg.scale, false, false, false, false)
        else
            StartParticleFxNonLoopedAtCoord(cfg.name, p.x, p.y, p.z + (cfg.zOff or 0.0), 0.0, 0.0, 0.0, cfg.scale, false, false, false)
        end
    end
    if #handles > 0 then
        SetTimeout(cfg.duration or 1500, function()
            for _, h in ipairs(handles) do StopParticleFxLooped(h, false) end
        end)
    end
end)

RegisterNetEvent('flowdj:sfx', function(id, name)
    SendNUIMessage({ action = 'sfx', id = id, name = name })
end)

RegisterNetEvent('flowdj:duck', function(id, on)
    SendNUIMessage({ action = 'duck', id = id, on = on, level = Config.MicDuck })
end)

---------------------------------------------------------------- abrir / cerrar
local function close()
    view, openBooth, editing = nil, nil, nil
    SetNuiFocus(false, false)
    SetNuiFocusKeepInput(false)
    SendNUIMessage({ action = 'close' })
end

RegisterNetEvent('flowdj:openDJ', function(id, st, serverNow, myName)
    view, openBooth = 'dj', id
    states[id] = st
    SetNuiFocus(true, true)
    local b
    for _, x in ipairs(booths) do if x.id == id then b = x end end
    local fx = {}
    for k, v in pairs(Config.Effects) do fx[#fx + 1] = { id = k, label = v.label } end
    table.sort(fx, function(a, b2) return a.id > b2.id end)
    SendNUIMessage({ action = 'openDJ', id = id, booth = b, state = st, serverNow = serverNow, me = myName,
        effects = fx, sounds = Config.Sounds, mic = micOn })
end)

RegisterNetEvent('flowdj:openAdmin', function(list, sts, serverNow, defaults, maxRadius)
    view = 'admin'
    booths = list
    SetNuiFocus(true, true)
    local p = GetEntityCoords(PlayerPedId())
    SendNUIMessage({ action = 'openAdmin', booths = list, states = sts, serverNow = serverNow, defaults = defaults,
        maxRadius = maxRadius, here = { x = p.x, y = p.y, z = p.z - 1.0 } })
end)

RegisterNetEvent('flowdj:adminSaved', function(id) SendNUIMessage({ action = 'adminSaved', id = id }) end)

---------------------------------------------------------------- NUI
RegisterNUICallback('close', function(_, cb) close() cb('ok') end)
RegisterNUICallback('mic', function(_, cb) cb('ok') setMic(not micOn) end)
RegisterNUICallback('add', function(d, cb) TriggerServerEvent('flowdj:add', openBooth, d.url, d.now) cb('ok') end)
RegisterNUICallback('control', function(d, cb) TriggerServerEvent('flowdj:control', openBooth, d.action, d.value) cb('ok') end)
RegisterNUICallback('ended', function(d, cb) TriggerServerEvent('flowdj:ended', d.id, d.key) cb('ok') end)

RegisterNUICallback('saveBooth', function(d, cb) TriggerServerEvent('flowdj:saveBooth', d) cb('ok') end)
RegisterNUICallback('deleteBooth', function(d, cb) TriggerServerEvent('flowdj:deleteBooth', d.id) cb('ok') end)
RegisterNUICallback('adminStop', function(d, cb) TriggerServerEvent('flowdj:adminStop', d.id) cb('ok') end)
RegisterNUICallback('editing', function(d, cb) editing = d and d.coords and d or nil cb('ok') end)
RegisterNUICallback('testFx', function(d, cb)
    cb('ok')
    -- vista previa del admin en los puntos que esta editando
    if not editing or not editing.fx then return end
    local cfg = Config.Effects[d.kind or 'fire']
    if not cfg or not loadAsset(cfg.asset) then return end
    for _, p in ipairs(editing.fx) do
        UseParticleFxAssetNextCall(cfg.asset)
        if cfg.looped then
            local h = StartParticleFxLoopedAtCoord(cfg.name, p.x, p.y, p.z + (cfg.zOff or 0.0), 0.0, 0.0, 0.0, cfg.scale, false, false, false, false)
            SetTimeout(cfg.duration or 1500, function() StopParticleFxLooped(h, false) end)
        else
            StartParticleFxNonLoopedAtCoord(cfg.name, p.x, p.y, p.z + (cfg.zOff or 0.0), 0.0, 0.0, 0.0, cfg.scale, false, false, false)
        end
    end
end)
RegisterNUICallback('here', function(_, cb)
    local p = GetEntityCoords(PlayerPedId())
    cb({ x = p.x, y = p.y, z = p.z - 1.0 })
end)
RegisterNUICallback('teleport', function(d, cb)
    cb('ok')
    if d.coords then SetEntityCoords(PlayerPedId(), d.coords.x, d.coords.y, d.coords.z + 1.0, false, false, false, false) end
end)

---------------------------------------------------------------- texto de ayuda y radio dibujado
local function draw3D(x, y, z, text)
    SetTextScale(0.32, 0.32)
    SetTextFont(4)
    SetTextColour(255, 255, 255, 230)
    SetTextOutline()
    SetTextCentre(true)
    BeginTextCommandDisplayText('STRING')
    AddTextComponentSubstringPlayerName(text)
    SetDrawOrigin(x, y, z, 0)
    EndTextCommandDisplayText(0.0, 0.0)
    ClearDrawOrigin()
end

CreateThread(function()
    local prompt = false
    while true do
        local sleep = 500
        local pos = GetEntityCoords(PlayerPedId())
        local near = nil
        for _, b in ipairs(booths) do
            local d = #(pos - vec(b.coords))
            if d < 15.0 then
                sleep = 0
                DrawMarker(27, b.coords.x, b.coords.y, b.coords.z + 0.03, 0, 0, 0, 0, 0, 0, 1.2, 1.2, 1.0, 255, 45, 120, 140, false, false, 2, true, nil, nil, false)
                if d <= (b.interact or 2.5) and not view then near = b end
            end
        end
        -- radio de la cabina que el admin esta editando
        if editing then
            sleep = 0
            local r = (tonumber(editing.radius) or 40.0) * 2.0
            DrawMarker(1, editing.coords.x, editing.coords.y, editing.coords.z - 1.0, 0, 0, 0, 0, 0, 0, r, r, 3.0, 26, 213, 217, 45, false, false, 2, false, nil, nil, false)
            DrawMarker(27, editing.coords.x, editing.coords.y, editing.coords.z + 0.03, 0, 0, 0, 0, 0, 0, 1.6, 1.6, 1.0, 255, 46, 147, 200, false, false, 2, true, nil, nil, false)
            for i, p in ipairs(editing.fx or {}) do
                DrawMarker(28, p.x, p.y, p.z + 0.3, 0, 0, 0, 0, 0, 0, 0.35, 0.35, 0.35, 255, 194, 224, 200, false, false, 2, false, nil, nil, false)
                draw3D(p.x, p.y, p.z + 0.8, ('FX %d'):format(i))
            end
        end
        if near then
            if not prompt then prompt = true SendNUIMessage({ action = 'prompt', show = true, name = near.name }) end
            if IsControlJustReleased(0, Config.InteractKey) then TriggerServerEvent('flowdj:open', near.id) end
        elseif prompt then
            prompt = false
            SendNUIMessage({ action = 'prompt', show = false })
        end
        Wait(sleep)
    end
end)

---------------------------------------------------------------- volumen por distancia (audio 3D)
CreateThread(function()
    while true do
        if next(states) then
            local ped = PlayerPedId()
            local pos = GetEntityCoords(ped)
            local camRot = math.rad(GetGameplayCamRot(2).z)
            local rx, ry = math.cos(camRot), math.sin(camRot)
            local mix = {}
            local others = {}
            for _, pid in ipairs(GetActivePlayers()) do others[#others + 1] = GetEntityCoords(GetPlayerPed(pid)) end
            for _, b in ipairs(booths) do
                local st = states[b.id]
                if st and st.current then
                    local c = vec(b.coords)
                    local d = #(pos - c)
                    local n = d / b.radius
                    local f = 0.0
                    if n < 0.35 then f = 1.0 elseif n < 1.0 then f = (1.0 - (n - 0.35) / 0.65) ^ 1.6 end
                    if IsPedInAnyVehicle(ped, false) then f = f * 0.55 end
                    local dx, dy = c.x - pos.x, c.y - pos.y
                    local len = math.sqrt(dx * dx + dy * dy)
                    local pan = len > 2.0 and ((dx * rx + dy * ry) / len) * 0.6 * math.min(1.0, len / 15.0) or 0.0
                    local listeners = 0
                    for _, o in ipairs(others) do if #(o - c) <= b.radius then listeners = listeners + 1 end end
                    mix[tostring(b.id)] = { f = f * b.volume, p = pan, d = math.floor(d), m = n > 0.6 and (n - 0.6) / 0.4 or 0.0, n = listeners }
                end
            end
            SendNUIMessage({ action = 'mix', mix = mix })
            Wait(200)
        else
            Wait(1000)
        end
    end
end)

AddEventHandler('onResourceStop', function(res)
    if res ~= GetCurrentResourceName() then return end
    if view then SetNuiFocus(false, false) end
    if micOn then setMic(false) end
    for _, b in pairs(blips) do RemoveBlip(b) end
end)
