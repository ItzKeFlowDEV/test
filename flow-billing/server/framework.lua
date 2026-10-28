-- Capa de framework: ESX, QBCore y QBox
FW = { name = nil }

local ESX, QB

local function started(r) return GetResourceState(r) == 'started' end

CreateThread(function()
    if started('qbx_core') then
        FW.name = 'qbox'
    elseif started('qb-core') then
        FW.name = 'qb'
        QB = exports['qb-core']:GetCoreObject()
    elseif started('es_extended') then
        FW.name = 'esx'
        ESX = exports['es_extended']:getSharedObject()
    else
        print('^1[flow-billing] No se encontro ESX, QBCore ni QBox. Este recurso necesita uno de ellos.^7')
    end
    if FW.name then print(('^2[flow-billing] framework: %s^7'):format(FW.name)) end
end)

local function qbPlayer(src)
    if FW.name == 'qbox' then return exports.qbx_core:GetPlayer(src) end
    return QB and QB.Functions.GetPlayer(src)
end

-- Datos del jugador conectado: identifier, name, job, jobLabel, grade, isBoss, onDuty, bank, cash
function FW.getPlayer(src)
    src = tonumber(src)
    if not src then return nil end
    if FW.name == 'esx' then
        local x = ESX.GetPlayerFromId(src)
        if not x then return nil end
        local bank = x.getAccount('bank')
        return {
            identifier = x.identifier, name = x.getName(),
            job = x.job.name, jobLabel = x.job.label, grade = x.job.grade, gradeName = x.job.grade_name,
            isBoss = x.job.grade_name == 'boss', onDuty = true,
            bank = bank and bank.money or 0, cash = x.getMoney()
        }
    elseif FW.name == 'qb' or FW.name == 'qbox' then
        local p = qbPlayer(src)
        if not p then return nil end
        local d = p.PlayerData
        local ci = d.charinfo or {}
        return {
            identifier = d.citizenid, name = ((ci.firstname or '') .. ' ' .. (ci.lastname or '')):gsub('^%s+', ''),
            job = d.job.name, jobLabel = d.job.label, grade = d.job.grade and d.job.grade.level or 0,
            isBoss = d.job.isboss == true, onDuty = d.job.onduty ~= false,
            bank = d.money and d.money.bank or 0, cash = d.money and d.money.cash or 0
        }
    end
end

-- 'bank' o 'cash'
function FW.removeMoney(src, account, amount)
    if FW.name == 'esx' then
        local x = ESX.GetPlayerFromId(src)
        if not x then return false end
        if account == 'cash' then
            if x.getMoney() < amount then return false end
            x.removeMoney(amount)
        else
            local acc = x.getAccount('bank')
            if not acc or acc.money < amount then return false end
            x.removeAccountMoney('bank', amount)
        end
        return true
    else
        local p = qbPlayer(src)
        if not p then return false end
        local have = p.PlayerData.money[account] or 0
        if have < amount then return false end
        return p.Functions.RemoveMoney(account, amount, 'factura') ~= false
    end
end

function FW.addMoney(src, account, amount)
    if amount <= 0 then return end
    if FW.name == 'esx' then
        local x = ESX.GetPlayerFromId(src)
        if not x then return end
        if account == 'cash' then x.addMoney(amount) else x.addAccountMoney('bank', amount) end
    else
        local p = qbPlayer(src)
        if p then p.Functions.AddMoney(account, amount, 'comision factura') end
    end
end

-- source de un jugador conectado por su identifier (nil si no esta)
function FW.sourceOf(identifier)
    for _, id in ipairs(GetPlayers()) do
        local p = FW.getPlayer(id)
        if p and p.identifier == identifier then return tonumber(id) end
    end
end

function FW.addSocietyMoney(society, amount)
    if amount <= 0 then return end
    if Config.AddSocietyMoney then return Config.AddSocietyMoney(society, amount) end
    if FW.name == 'esx' and started('esx_addonaccount') then
        TriggerEvent('esx_addonaccount:getSharedAccount', 'society_' .. society, function(acc)
            if acc then acc.addMoney(amount) end
        end)
    elseif started('Renewed-Banking') then
        pcall(function() exports['Renewed-Banking']:addAccountMoney(society, amount) end)
    elseif started('qb-banking') then
        local ok = pcall(function() exports['qb-banking']:AddMoney(society, amount, 'Factura') end)
        if not ok and started('qb-management') then pcall(function() exports['qb-management']:AddMoney(society, amount) end) end
    elseif started('qb-management') then
        pcall(function() exports['qb-management']:AddMoney(society, amount) end)
    else
        print(('^3[flow-billing] No se encontro banco de empresas: %s %s no se deposito. Configura Config.AddSocietyMoney^7'):format(Config.Currency, amount))
    end
end
