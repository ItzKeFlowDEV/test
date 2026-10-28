local PERSONAL = 'personal'   -- "trabajo" interno de las facturas personales

local function notify(src, msg, kind)
    TriggerClientEvent('flowbilling:notify', src, msg, kind or 'info')
end

local function money(n) return Config.Currency .. tostring(math.floor(n)):reverse():gsub('(%d%d%d)', '%1,'):reverse():gsub('^,', '') end

local function clean(text, max)
    if type(text) ~= 'string' then return '' end
    text = text:gsub('[%c<>]', ' '):gsub('%s+', ' '):gsub('^%s+', ''):gsub('%s+$', '')
    return text:sub(1, max)
end

---------------------------------------------------------------- permisos
local function jobOf(p) return p and Config.Jobs[p.job] end

-- 'ok' | 'grade' (rango bajo) | 'duty' (fuera de servicio) | nil (su trabajo no factura)
local function jobAccess(p)
    local j = jobOf(p)
    if not j then return nil end
    if (j.minGrade or 0) > (p.grade or 0) then return 'grade' end
    if Config.RequireDuty and not p.onDuty then return 'duty' end
    return 'ok'
end

local function isBoss(p)
    local j = jobOf(p)
    return j ~= nil and (p.isBoss or (j.bossGrade and p.grade >= j.bossGrade))
end

---------------------------------------------------------------- recargos
-- recargo actual de una factura vencida
local function lateFee(b)
    if not Config.LateFee.enabled or b.status ~= 'unpaid' or not b.due or b.due == 0 then return 0 end
    local hours = math.floor((os.time() - b.due) / 3600)
    if hours <= 0 then return 0 end
    local pct = math.min(Config.LateFee.maxPercent, hours * Config.LateFee.percentPerHour)
    return math.floor(b.amount * pct / 100)
end

local function withFees(list)
    for _, b in ipairs(list) do
        if b.status == 'unpaid' then b.fee = lateFee(b) end
    end
    return list
end

---------------------------------------------------------------- pagos pendientes (facturas personales a gente desconectada)
local function deliverPayouts(src, p)
    for _, po in ipairs(DB.takePayouts(p.identifier)) do
        FW.addMoney(src, 'bank', po.amount)
        notify(src, ('Recibiste %s · %s'):format(money(po.amount), po.text or 'pago de factura'), 'success')
    end
end

---------------------------------------------------------------- datos del menu
local function sendData(src)
    local p = FW.getPlayer(src)
    if not p then return notify(src, 'No se pudo cargar tu personaje', 'error') end
    deliverPayouts(src, p)
    p = FW.getPlayer(src)
    local j = jobOf(p)
    local access = jobAccess(p)
    local data = {
        me = {
            name = p.name, job = p.job, jobLabel = j and j.label or p.jobLabel, bank = p.bank, cash = p.cash,
            canBillJob = access == 'ok', jobBlocked = access ~= 'ok' and access or nil,
            minGrade = j and j.minGrade or 0, canBillPersonal = Config.Universal.enabled, isBoss = isBoss(p)
        },
        jobs = { [PERSONAL] = { label = Config.Universal.label, color = Config.Universal.color, icon = Config.Universal.icon } },
        currency = Config.Currency, allowById = Config.AllowById,
        lateFee = Config.LateFee.enabled and { perHour = Config.LateFee.percentPerHour, max = Config.LateFee.maxPercent } or nil,
        dueHours = Config.AutoPay.dueHours, autopay = Config.AutoPay.enabled,
        myBills = withFees(DB.byReceiver(p.identifier)), serverNow = os.time()
    }
    for name, cfg in pairs(Config.Jobs) do data.jobs[name] = { label = cfg.label, color = cfg.color, icon = cfg.icon } end
    if j then
        data.job = { key = p.job, label = j.label, color = j.color, icon = j.icon, commission = j.commission,
            presets = j.presets, allowCustom = j.allowCustom, maxAmount = Config.MaxAmount }
    end
    if Config.Universal.enabled then
        local u = Config.Universal
        data.personal = { key = PERSONAL, label = u.label, color = u.color, icon = u.icon, commission = 100,
            presets = u.presets or {}, allowCustom = u.allowCustom, maxAmount = u.maxAmount or Config.MaxAmount }
    end
    if isBoss(p) then data.companyBills = withFees(DB.byJob(p.job)) end
    TriggerClientEvent('flowbilling:data', src, data)
end

RegisterNetEvent('flowbilling:open', function() sendData(source) end)

RegisterNetEvent('flowbilling:nearby', function(ids)
    local src = source
    local out = {}
    if type(ids) == 'table' then
        for _, id in ipairs(ids) do
            local p = FW.getPlayer(id)
            if p and tonumber(id) ~= src then out[#out + 1] = { id = tonumber(id), name = p.name } end
            if #out >= 12 then break end
        end
    end
    TriggerClientEvent('flowbilling:nearby', src, out)
end)

local function distance(a, b)
    local pa, pb = GetPlayerPed(a), GetPlayerPed(b)
    if pa == 0 or pb == 0 then return 99999 end
    return #(GetEntityCoords(pa) - GetEntityCoords(pb))
end

---------------------------------------------------------------- crear
-- kind: 'job' (factura oficial del trabajo) o 'personal'
local function createBill(src, target, reason, amount, note, kind)
    local issuer = FW.getPlayer(src)
    if not issuer then return false, 'No se pudo cargar tu personaje' end
    local cfg, jobKey, label
    if kind == PERSONAL then
        if not Config.Universal.enabled then return false, 'Las facturas personales están desactivadas' end
        cfg, jobKey, label = Config.Universal, PERSONAL, Config.Universal.label
    else
        local access = jobAccess(issuer)
        if access == 'grade' then return false, ('Necesitas rango %d o más para facturar'):format(jobOf(issuer).minGrade) end
        if access == 'duty' then return false, 'Debes estar de servicio para facturar' end
        if access ~= 'ok' then return false, 'Tu trabajo no puede hacer facturas' end
        cfg, jobKey, label = jobOf(issuer), issuer.job, jobOf(issuer).label
    end

    target = tonumber(target)
    if not target or target == src then return false, 'Elige a quién facturar' end
    local receiver = FW.getPlayer(target)
    if not receiver then return false, 'Ese jugador no está conectado' end
    if not Config.AllowById and distance(src, target) > Config.NearbyDistance + 2.0 then return false, 'El jugador está muy lejos' end

    reason, note = clean(reason, 120), clean(note, 255)
    amount = math.floor(tonumber(amount) or 0)
    local max = cfg.maxAmount or Config.MaxAmount
    if reason == '' then return false, 'Escribe el concepto' end
    if amount <= 0 or amount > max then return false, ('El importe debe estar entre 1 y %s'):format(money(max)) end
    if not cfg.allowCustom then
        local ok = false
        for _, pr in ipairs(cfg.presets or {}) do if pr.label == reason and pr.amount == amount then ok = true end end
        if not ok then return false, 'Solo puedes usar las plantillas de tu trabajo' end
    end

    local now = os.time()
    local bill = DB.insert({
        job = jobKey, jobLabel = label, issuer = issuer.identifier, issuerName = issuer.name,
        receiver = receiver.identifier, receiverName = receiver.name, reason = reason, amount = amount, note = note,
        created = now, due = Config.AutoPay.dueHours > 0 and now + Config.AutoPay.dueHours * 3600 or 0
    })
    TriggerClientEvent('flowbilling:received', target, {
        id = bill.id, jobLabel = label, color = cfg.color, icon = cfg.icon, reason = reason, amount = amount, issuerName = issuer.name
    })
    return true, bill
end

RegisterNetEvent('flowbilling:create', function(d)
    local src = source
    if type(d) ~= 'table' then return end
    local ok, res = createBill(src, d.target, d.reason, d.amount, d.note, d.kind == PERSONAL and PERSONAL or 'job')
    if not ok then return notify(src, res, 'error') end
    notify(src, ('Factura #%d enviada a %s · %s'):format(res.id, res.receiverName, money(res.amount)), 'success')
    sendData(src)
end)

---------------------------------------------------------------- pagar
local function payBill(src, bill, method, auto)
    if not bill or bill.status ~= 'unpaid' then return false, 'Esa factura ya no está pendiente' end
    local p = FW.getPlayer(src)
    if not p or p.identifier ~= bill.receiver then return false, 'Esa factura no es tuya' end
    method = method == 'cash' and 'cash' or 'bank'
    local fee = lateFee(bill)
    local total = bill.amount + fee
    if not FW.removeMoney(src, method, total) then
        return false, method == 'cash' and 'No tienes suficiente efectivo' or 'No tienes suficiente dinero en el banco'
    end
    DB.setStatus(bill.id, 'paid', auto and 'auto' or method, fee)

    local issuerSrc = FW.sourceOf(bill.issuer)
    if bill.job == PERSONAL then
        -- factura personal: todo para quien la emitio (si no esta, se le entrega al volver)
        local text = ('factura #%d pagada por %s'):format(bill.id, p.name)
        if issuerSrc then
            FW.addMoney(issuerSrc, 'bank', total)
            notify(issuerSrc, ('%s pagó tu factura #%d · %s'):format(p.name, bill.id, money(total)), 'success')
        else
            DB.addPayout(bill.issuer, total, text)
        end
    else
        local j = Config.Jobs[bill.job]
        local commission = (j and issuerSrc) and math.floor(bill.amount * (j.commission or 0) / 100) or 0
        if commission > 0 then
            FW.addMoney(issuerSrc, 'bank', commission)
            notify(issuerSrc, ('%s pagó la factura #%d · tu comisión: %s'):format(p.name, bill.id, money(commission)), 'success')
        end
        FW.addSocietyMoney(j and j.society or bill.job, total - commission)   -- el recargo va entero a la empresa
    end
    return true, total, fee
end

RegisterNetEvent('flowbilling:pay', function(id, method)
    local src = source
    local bill = DB.get(tonumber(id) or -1)
    local ok, total, fee = payBill(src, bill, method)
    if not ok then return notify(src, total, 'error') end
    notify(src, ('Pagaste la factura #%d · %s%s'):format(bill.id, money(total), fee > 0 and (' (incluye %s de recargo)'):format(money(fee)) or ''), 'success')
    TriggerClientEvent('flowbilling:paid', src, bill.id)
    sendData(src)
end)

---------------------------------------------------------------- anular (jefes)
RegisterNetEvent('flowbilling:cancel', function(id)
    local src = source
    local p = FW.getPlayer(src)
    local bill = DB.get(tonumber(id) or -1)
    if not bill or not isBoss(p) or bill.job ~= p.job then return notify(src, 'No puedes anular esa factura', 'error') end
    if bill.status ~= 'unpaid' then return notify(src, 'Solo se pueden anular facturas pendientes', 'error') end
    DB.setStatus(bill.id, 'cancelled')
    notify(src, ('Factura #%d anulada'):format(bill.id), 'success')
    local r = FW.sourceOf(bill.receiver)
    if r then notify(r, ('%s anuló tu factura #%d'):format(bill.jobLabel, bill.id), 'info') end
    sendData(src)
end)

---------------------------------------------------------------- vencidas: cobro automatico + recargos
local warned = {}   -- [billId] = ultima hora en que se aviso de falta de fondos
CreateThread(function()
    Wait(30000)
    while true do
        local online, list = {}, {}
        for _, id in ipairs(GetPlayers()) do
            local p = FW.getPlayer(id)
            if p then
                online[p.identifier] = tonumber(id)
                list[#list + 1] = p.identifier
                deliverPayouts(tonumber(id), p)
            end
        end
        if Config.AutoPay.enabled then
            for _, bill in ipairs(DB.overdue(list, os.time())) do
                local src = online[bill.receiver]
                if src then
                    local ok, total, fee = payBill(src, bill, 'bank', true)
                    if ok then
                        notify(src, ('Factura #%d de %s vencida: se cobró automáticamente %s'):format(bill.id, bill.jobLabel, money(total)), 'info')
                    else
                        local hour = math.floor(os.time() / 3600)
                        if warned[bill.id] ~= hour then
                            warned[bill.id] = hour
                            local fee2 = lateFee(bill)
                            notify(src, ('Factura #%d vencida y sin fondos: recargo actual %s (+%d%%/h)'):format(bill.id, money(fee2), Config.LateFee.percentPerHour), 'error')
                        end
                    end
                end
            end
        end
        Wait(Config.AutoPay.checkMinutes * 60 * 1000)
    end
end)

---------------------------------------------------------------- exports para otros scripts
-- exports['flow-billing']:CreateBill(source_emisor, source_cliente, 'Concepto', 500, 'nota', 'job' | 'personal')
exports('CreateBill', function(src, target, reason, amount, note, kind) return createBill(src, target, reason, amount, note, kind) end)
exports('GetUnpaid', function(src)
    local p = FW.getPlayer(src)
    if not p then return {} end
    local out = {}
    for _, b in ipairs(withFees(DB.byReceiver(p.identifier))) do if b.status == 'unpaid' then out[#out + 1] = b end end
    return out
end)
