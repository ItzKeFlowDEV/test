-- Almacenamiento: MySQL (oxmysql) si esta encendido; si no, data/bills.json
DB = {}
local RES = GetCurrentResourceName()
local useSql = false
local file = { nextId = 1, bills = {}, payouts = {} }

local function await(fn, query, params)
    local p = promise.new()
    exports.oxmysql[fn](exports.oxmysql, query, params or {}, function(r) p:resolve(r) end)
    return Citizen.Await(p)
end

local function saveFile()
    SaveResourceFile(RES, 'data/bills.json', json.encode(file), -1)
end

CreateThread(function()
    if GetResourceState('oxmysql') == 'started' then
        useSql = true
        await('query', [[
            CREATE TABLE IF NOT EXISTS `flow_bills` (
              `id` INT NOT NULL AUTO_INCREMENT,
              `job` VARCHAR(50) NOT NULL,
              `job_label` VARCHAR(60) NOT NULL,
              `issuer` VARCHAR(80) NOT NULL,
              `issuer_name` VARCHAR(80) NOT NULL,
              `receiver` VARCHAR(80) NOT NULL,
              `receiver_name` VARCHAR(80) NOT NULL,
              `reason` VARCHAR(120) NOT NULL,
              `amount` INT NOT NULL,
              `note` VARCHAR(255) DEFAULT '',
              `status` VARCHAR(12) NOT NULL DEFAULT 'unpaid',
              `created` INT NOT NULL,
              `paid_at` INT DEFAULT NULL,
              `paid_by` VARCHAR(20) DEFAULT NULL,
              `due` INT NOT NULL DEFAULT 0,
              `fee` INT NOT NULL DEFAULT 0,
              PRIMARY KEY (`id`),
              KEY `receiver` (`receiver`),
              KEY `job` (`job`)
            )]])
        await('query', [[
            CREATE TABLE IF NOT EXISTS `flow_bill_payouts` (
              `id` INT NOT NULL AUTO_INCREMENT,
              `identifier` VARCHAR(80) NOT NULL,
              `amount` INT NOT NULL,
              `text` VARCHAR(160) DEFAULT '',
              PRIMARY KEY (`id`), KEY `identifier` (`identifier`)
            )]])
        print('^2[flow-billing] usando MySQL (tablas flow_bills y flow_bill_payouts)^7')
    else
        file = json.decode(LoadResourceFile(RES, 'data/bills.json') or '') or file
        file.payouts = file.payouts or {}
        print('^3[flow-billing] oxmysql no encontrado: usando data/bills.json^7')
    end
end)

local function fromRow(r)
    return { id = r.id, job = r.job, jobLabel = r.job_label, issuer = r.issuer, issuerName = r.issuer_name,
        receiver = r.receiver, receiverName = r.receiver_name, reason = r.reason, amount = r.amount, note = r.note,
        status = r.status, created = r.created, paidAt = r.paid_at, paidBy = r.paid_by, due = r.due, fee = r.fee }
end

function DB.insert(b)
    if useSql then
        local id = await('insert', [[INSERT INTO flow_bills (job, job_label, issuer, issuer_name, receiver, receiver_name, reason, amount, note, status, created, due)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'unpaid', ?, ?)]],
            { b.job, b.jobLabel, b.issuer, b.issuerName, b.receiver, b.receiverName, b.reason, b.amount, b.note, b.created, b.due })
        b.id = id
    else
        b.id = file.nextId
        file.nextId = file.nextId + 1
        b.status = 'unpaid'
        table.insert(file.bills, b)
        saveFile()
    end
    return b
end

function DB.get(id)
    if useSql then
        local r = await('query', 'SELECT * FROM flow_bills WHERE id = ?', { id })
        return r and r[1] and fromRow(r[1]) or nil
    end
    for _, b in ipairs(file.bills) do if b.id == id then return b end end
end

function DB.setStatus(id, status, paidBy, fee)
    local t = os.time()
    if useSql then
        await('update', 'UPDATE flow_bills SET status = ?, paid_at = ?, paid_by = ?, fee = ? WHERE id = ?',
            { status, status == 'paid' and t or nil, paidBy, fee or 0, id })
    else
        for _, b in ipairs(file.bills) do
            if b.id == id then b.status = status b.paidAt = status == 'paid' and t or nil b.paidBy = paidBy b.fee = fee or 0 end
        end
        saveFile()
    end
end

-- dinero pendiente de entregar a jugadores desconectados (facturas personales)
function DB.addPayout(identifier, amount, text)
    if useSql then
        await('insert', 'INSERT INTO flow_bill_payouts (identifier, amount, text) VALUES (?, ?, ?)', { identifier, amount, text })
    else
        table.insert(file.payouts, { identifier = identifier, amount = amount, text = text })
        saveFile()
    end
end

function DB.takePayouts(identifier)
    if useSql then
        local rows = await('query', 'SELECT * FROM flow_bill_payouts WHERE identifier = ?', { identifier }) or {}
        if #rows > 0 then await('update', 'DELETE FROM flow_bill_payouts WHERE identifier = ?', { identifier }) end
        return rows
    end
    local out, keep = {}, {}
    for _, p in ipairs(file.payouts) do
        if p.identifier == identifier then out[#out + 1] = p else keep[#keep + 1] = p end
    end
    if #out > 0 then file.payouts = keep saveFile() end
    return out
end

local function filter(fn, limit)
    local out = {}
    for i = #file.bills, 1, -1 do
        local b = file.bills[i]
        if fn(b) then out[#out + 1] = b if #out >= limit then break end end
    end
    return out
end

function DB.byReceiver(identifier, limit)
    limit = limit or 100
    if useSql then
        local rows = await('query', 'SELECT * FROM flow_bills WHERE receiver = ? ORDER BY id DESC LIMIT ?', { identifier, limit }) or {}
        for i, r in ipairs(rows) do rows[i] = fromRow(r) end
        return rows
    end
    return filter(function(b) return b.receiver == identifier end, limit)
end

function DB.byJob(job, limit)
    limit = limit or 200
    if useSql then
        local rows = await('query', 'SELECT * FROM flow_bills WHERE job = ? ORDER BY id DESC LIMIT ?', { job, limit }) or {}
        for i, r in ipairs(rows) do rows[i] = fromRow(r) end
        return rows
    end
    return filter(function(b) return b.job == job end, limit)
end

-- facturas sin pagar ya vencidas (due < before) de estos receptores
function DB.overdue(receivers, before)
    if #receivers == 0 then return {} end
    if useSql then
        local marks = string.rep('?,', #receivers):sub(1, -2)
        local params = {}
        for _, r in ipairs(receivers) do params[#params + 1] = r end
        params[#params + 1] = before
        local rows = await('query', ('SELECT * FROM flow_bills WHERE status = \'unpaid\' AND receiver IN (%s) AND due > 0 AND due < ?'):format(marks), params) or {}
        for i, r in ipairs(rows) do rows[i] = fromRow(r) end
        return rows
    end
    local set = {}
    for _, r in ipairs(receivers) do set[r] = true end
    return filter(function(b) return b.status == 'unpaid' and set[b.receiver] and (b.due or 0) > 0 and b.due < before end, 1000)
end
