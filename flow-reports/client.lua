local view = nil            -- 'player' | 'admin' | nil
local isAdminCache = false
local myReport = nil
local frozen = false

local function notify(msg, kind)
    SendNUIMessage({ action = 'notify', msg = msg, kind = kind })
end
RegisterNetEvent('flowreports:notify', notify)

local function close()
    view = nil
    SetNuiFocus(false, false)
    SendNUIMessage({ action = 'close' })
end

---------------------------------------------------------------- jugador
RegisterNetEvent('flowreports:openPlayer', function(report, categories)
    view = 'player'
    myReport = report
    SetNuiFocus(true, true)
    SendNUIMessage({ action = 'openPlayer', report = report, categories = categories,
        min = Config.MinMessage, max = Config.MaxMessage })
end)

-- actualiza la barra de "esperando respuesta" y la vista del reporte
RegisterNetEvent('flowreports:playerUpdate', function(report)
    local prev = myReport
    myReport = report and report.status ~= 'closed' and report or nil
    SendNUIMessage({ action = 'playerUpdate', report = report })
    if report and prev then
        local last = report.messages[#report.messages]
        if last and last.from == 'admin' and #report.messages > #prev.messages and view ~= 'player' then
            PlaySoundFrontend(-1, 'Text_Arrive_Tone', 'Phone_SoundSet_Default', true)
        end
    end
end)

---------------------------------------------------------------- admin
RegisterNetEvent('flowreports:openAdmin', function(list, serverNow, me)
    view = 'admin'
    isAdminCache = true
    SetNuiFocus(true, true)
    SendNUIMessage({ action = 'openAdmin', reports = list, serverNow = serverNow, me = me,
        scaleMin = Config.ScaleMin, scaleMax = Config.ScaleMax })
end)

RegisterNetEvent('flowreports:adminUpdate', function(list, serverNow, newReport)
    isAdminCache = true
    SendNUIMessage({ action = 'adminUpdate', reports = list, serverNow = serverNow, newReport = newReport })
    if newReport then PlaySoundFrontend(-1, 'Event_Message_Purple', 'GTAO_FM_Events_Soundset', true) end
end)

---------------------------------------------------------------- acciones recibidas
RegisterNetEvent('flowreports:teleport', function(x, y, z)
    local ped = PlayerPedId()
    local veh = GetVehiclePedIsIn(ped, false)
    DoScreenFadeOut(250)
    Wait(260)
    RequestCollisionAtCoord(x, y, z)
    SetEntityCoords(veh ~= 0 and GetPedInVehicleSeat(veh, -1) == ped and veh or ped, x + 1.0, y, z, false, false, false, false)
    local t = GetGameTimer() + 2000
    while not HasCollisionLoadedAroundEntity(ped) and GetGameTimer() < t do Wait(0) end
    DoScreenFadeIn(300)
end)

RegisterNetEvent('flowreports:doAction', function(action, adminName)
    local ped = PlayerPedId()
    if action == 'revive' then
        local c = GetEntityCoords(ped)
        if IsEntityDead(ped) or IsPedFatallyInjured(ped) then
            NetworkResurrectLocalPlayer(c.x, c.y, c.z, GetEntityHeading(ped), true, false)
            ped = PlayerPedId()
        end
        SetEntityHealth(ped, GetEntityMaxHealth(ped))
        ClearPedBloodDamage(ped)
        ClearPedTasksImmediately(ped)
        for _, e in ipairs(Config.ReviveEvents) do
            if GetResourceState(e.resource) == 'started' then TriggerEvent(e.event) end
        end
        notify(adminName .. ' te revivió', 'success')
    elseif action == 'heal' then
        SetEntityHealth(ped, GetEntityMaxHealth(ped))
        ClearPedBloodDamage(ped)
        for _, e in ipairs(Config.HealEvents) do
            if GetResourceState(e.resource) == 'started' then TriggerEvent(e.event) end
        end
        notify(adminName .. ' te curó', 'success')
    elseif action == 'skin' then
        if view then close() end
        if not Config.OpenSkinMenu() then notify('No se encontró un menú de ropa en el servidor', 'error') end
    elseif action == 'freeze' then
        frozen = not frozen
        FreezeEntityPosition(ped, frozen)
        notify(frozen and (adminName .. ' te congeló') or 'Ya puedes moverte', frozen and 'error' or 'success')
    end
end)

---------------------------------------------------------------- escala visual de jugadores (state bag "flowScale")
-- Se aplica en todos los clientes para que todos vean al jugador grande o pequeño.
CreateThread(function()
    while true do
        local any = false
        for _, pid in ipairs(GetActivePlayers()) do
            local s = Player(GetPlayerServerId(pid)).state.flowScale
            if s and s ~= 1.0 then
                any = true
                local ped = GetPlayerPed(pid)
                if DoesEntityExist(ped) and not IsPedInAnyVehicle(ped, false) then
                    local f, r, u, p = GetEntityMatrix(ped)
                    -- se ajusta la altura para que los pies sigan tocando el suelo
                    SetEntityMatrix(ped, f.x * s, f.y * s, f.z * s, r.x * s, r.y * s, r.z * s, u.x * s, u.y * s, u.z * s,
                        p.x, p.y, p.z - (1.0 - s) * 0.98)
                end
            end
        end
        Wait(any and 0 or 500)
    end
end)

---------------------------------------------------------------- NUI
RegisterNUICallback('close', function(_, cb) close() cb('ok') end)
RegisterNUICallback('create', function(d, cb) TriggerServerEvent('flowreports:create', d.category, d.message) cb('ok') end)
RegisterNUICallback('playerMessage', function(d, cb) TriggerServerEvent('flowreports:playerMessage', d.text) cb('ok') end)
RegisterNUICallback('cancel', function(_, cb) TriggerServerEvent('flowreports:cancel') cb('ok') end)
RegisterNUICallback('claim', function(d, cb) TriggerServerEvent('flowreports:claim', d.id) cb('ok') end)
RegisterNUICallback('unclaim', function(d, cb) TriggerServerEvent('flowreports:unclaim', d.id) cb('ok') end)
RegisterNUICallback('reply', function(d, cb) TriggerServerEvent('flowreports:reply', d.id, d.text) cb('ok') end)
RegisterNUICallback('closeReport', function(d, cb) TriggerServerEvent('flowreports:close', d.id) cb('ok') end)
RegisterNUICallback('action', function(d, cb) TriggerServerEvent('flowreports:action', d.id, d.action, d.value) cb('ok') end)

AddEventHandler('onResourceStop', function(res)
    if res ~= GetCurrentResourceName() then return end
    if view then SetNuiFocus(false, false) end
    if frozen then FreezeEntityPosition(PlayerPedId(), false) end
end)
