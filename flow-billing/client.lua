local open = false

local function notify(msg, kind)
    SendNUIMessage({ action = 'notify', msg = msg, kind = kind })
end
RegisterNetEvent('flowbilling:notify', notify)

local function openMenu()
    if open then return end
    TriggerServerEvent('flowbilling:open')
end

RegisterCommand(Config.Command, openMenu, false)
if Config.Key and Config.Key ~= '' then
    RegisterKeyMapping(Config.Command, 'Abrir facturas', 'keyboard', Config.Key)
end

RegisterNetEvent('flowbilling:data', function(data)
    if not open then
        open = true
        SetNuiFocus(true, true)
        data.open = true
    end
    SendNUIMessage({ action = 'data', data = data })
end)

-- aviso de factura nueva (aunque el menu este cerrado)
RegisterNetEvent('flowbilling:received', function(bill)
    PlaySoundFrontend(-1, 'Event_Message_Purple', 'GTAO_FM_Events_Soundset', true)
    SendNUIMessage({ action = 'received', bill = bill, command = Config.Command })
    if open then TriggerServerEvent('flowbilling:open') end
end)

RegisterNetEvent('flowbilling:paid', function(id)
    PlaySoundFrontend(-1, 'PURCHASE', 'HUD_LIQUOR_STORE_SOUNDSET', true)
    SendNUIMessage({ action = 'paid', id = id })
end)

RegisterNetEvent('flowbilling:nearby', function(list)
    SendNUIMessage({ action = 'nearby', list = list })
end)

---------------------------------------------------------------- NUI
RegisterNUICallback('close', function(_, cb)
    open = false
    SetNuiFocus(false, false)
    SendNUIMessage({ action = 'close' })
    cb('ok')
end)

RegisterNUICallback('refresh', function(_, cb) TriggerServerEvent('flowbilling:open') cb('ok') end)
RegisterNUICallback('pay', function(d, cb) TriggerServerEvent('flowbilling:pay', d.id, d.method) cb('ok') end)
RegisterNUICallback('create', function(d, cb) TriggerServerEvent('flowbilling:create', d) cb('ok') end)
RegisterNUICallback('cancel', function(d, cb) TriggerServerEvent('flowbilling:cancel', d.id) cb('ok') end)

RegisterNUICallback('nearby', function(_, cb)
    cb('ok')
    local me = PlayerPedId()
    local pos = GetEntityCoords(me)
    local ids = {}
    for _, pid in ipairs(GetActivePlayers()) do
        local ped = GetPlayerPed(pid)
        if ped ~= me and #(GetEntityCoords(ped) - pos) <= Config.NearbyDistance then
            ids[#ids + 1] = GetPlayerServerId(pid)
        end
    end
    TriggerServerEvent('flowbilling:nearby', ids)
end)

AddEventHandler('onResourceStop', function(res)
    if res == GetCurrentResourceName() and open then SetNuiFocus(false, false) end
end)
