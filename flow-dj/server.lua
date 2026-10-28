local RES = GetCurrentResourceName()
local booths = json.decode(LoadResourceFile(RES, 'data/booths.json') or '[]') or {}
local states = {}     -- [boothId] = { queue, current, history, djVolume, dj }
local nextId = 1
for _, b in ipairs(booths) do if b.id >= nextId then nextId = b.id + 1 end end

---------------------------------------------------------------- permisos
local ESX, QB
CreateThread(function()
    if GetResourceState('es_extended') == 'started' then pcall(function() ESX = exports['es_extended']:getSharedObject() end) end
    if GetResourceState('qb-core') == 'started' then pcall(function() QB = exports['qb-core']:GetCoreObject() end) end
end)

local function isAdmin(src)
    src = tonumber(src)
    if not src or not GetPlayerName(src) then return false end
    if IsPlayerAceAllowed(src, Config.AdminAce) then return true end
    if Config.AceCommandIsAdmin and IsPlayerAceAllowed(src, 'command') then return true end
    for _, g in ipairs(Config.AdminGroups) do
        if IsPlayerAceAllowed(src, 'group.' .. g) then return true end
    end
    if ESX then
        local ok, g = pcall(function() local x = ESX.GetPlayerFromId(src) return x and x.getGroup() end)
        if ok and g then for _, a in ipairs(Config.AdminGroups) do if a == g then return true end end end
    end
    if QB then
        for _, g in ipairs(Config.AdminGroups) do
            local ok, r = pcall(QB.Functions.HasPermission, src, g)
            if ok and r then return true end
        end
    end
    for _, id in ipairs(GetPlayerIdentifiers(src)) do
        for _, a in ipairs(Config.Admins) do if a == id then return true end end
    end
    return false
end

---------------------------------------------------------------- utilidades
local function notify(src, msg, kind) TriggerClientEvent('flowdj:notify', src, msg, kind or 'info') end
local function save() SaveResourceFile(RES, 'data/booths.json', json.encode(booths), -1) end
local function boothById(id) for i, b in ipairs(booths) do if b.id == id then return b, i end end end

local function cleanName(s)
    s = type(s) == 'string' and s:gsub('[%c<>]', ''):sub(1, 40) or ''
    return s ~= '' and s or 'Cabina DJ'
end

local function nameOf(src)
    local n = (GetPlayerName(src) or ''):gsub('%^%d', ''):gsub('~%a~', '')
    return n ~= '' and n or ('Jugador ' .. src)
end

local function ytId(url)
    return url:match('youtu%.be/([%w_%-]+)') or url:match('[%?&]v=([%w_%-]+)') or url:match('/shorts/([%w_%-]+)')
        or url:match('/embed/([%w_%-]+)') or url:match('/live/([%w_%-]+)')
end

local function validUrl(url)
    if type(url) ~= 'string' or #url > 500 then return nil end
    url = url:gsub('^%s+', ''):gsub('%s+$', '')
    local host = url:match('^https?://([^/%?#:]+)')
    if not host then return nil end
    host = host:lower()
    if host:find('youtube%.com$') or host == 'youtu.be' then
        local id = ytId(url)
        if id and #id == 11 then return url, 'yt', id end
        return nil
    end
    return url, 'file'
end

local function state(id)
    if not states[id] then states[id] = { queue = {}, history = {}, current = nil, djVolume = 0.8, dj = nil, eq = { low = 0.0, mid = 0.0, high = 0.0, filter = 0.0 },
        mix = { mode = Config.Transition.mode, secs = Config.Transition.secs, auto = Config.Transition.auto } } end
    return states[id]
end

local function position(cur)
    if not cur then return 0 end
    if not cur.playing then return cur.position end
    return cur.position + (GetGameTimer() - cur.updatedAt) / 1000.0
end

local function broadcastBooths(target)
    TriggerClientEvent('flowdj:booths', target or -1, booths)
end

local function broadcastState(id)
    TriggerClientEvent('flowdj:state', -1, id, states[id], GetGameTimer())
end

local function startTrack(id, track)
    local st = state(id)
    if st.current then
        table.insert(st.history, 1, { url = st.current.url, title = st.current.title, thumb = st.current.thumb, kind = st.current.kind, by = st.current.by })
        while #st.history > 15 do table.remove(st.history) end
    end
    if track then
        track.playing, track.position, track.updatedAt = true, 0.0, GetGameTimer()
        track.key = ('%d-%d'):format(id, GetGameTimer())
    end
    st.current = track
    broadcastState(id)
end

local function nextTrack(id)
    local st = state(id)
    startTrack(id, table.remove(st.queue, 1))
end

---------------------------------------------------------------- titulo de YouTube (oEmbed)
local function fetchInfo(url, kind, vid, cb)
    if kind == 'yt' then
        PerformHttpRequest('https://www.youtube.com/oembed?format=json&url=' .. url:gsub('[^%w%-_%.~]', function(c) return ('%%%02X'):format(c:byte()) end),
            function(code, body)
                local title, author
                if code == 200 and body then
                    local ok, d = pcall(json.decode, body)
                    if ok and d then title, author = d.title, d.author_name end
                end
                cb(title or 'Video de YouTube', ('https://i.ytimg.com/vi/%s/hqdefault.jpg'):format(vid), author)
            end, 'GET')
    else
        local name = url:gsub('[?#].*$', ''):match('([^/]+)$') or 'Audio'
        name = name:gsub('%.%w+$', ''):gsub('%%20', ' '):gsub('[_%-]+', ' ')
        cb(name:sub(1, 80), nil, nil)
    end
end

---------------------------------------------------------------- acceso a la cabina
local function nearBooth(src, b, extra)
    local ped = GetPlayerPed(src)
    if ped == 0 then return false end
    local c = GetEntityCoords(ped)
    return #(c - vector3(b.coords.x, b.coords.y, b.coords.z)) <= (b.interact or 2.5) + (extra or 3.0)
end

local function canUse(src, b)
    if isAdmin(src) then return true end
    if b.access == 'admin' then return false, 'Solo los administradores pueden usar esta cabina' end
    if b.access == 'job' and b.job ~= '' then
        local ok, job = pcall(Config.GetJob, src)
        if not ok or job ~= b.job then return false, 'Esta cabina es solo para el trabajo: ' .. b.job end
    end
    return true
end

-- valida jugador + cabina para las acciones del panel
local function djCheck(src, id)
    local b = boothById(tonumber(id) or -1)
    if not b then return nil end
    local ok, why = canUse(src, b)
    if not ok then notify(src, why, 'error') return nil end
    if not nearBooth(src, b, 6.0) and not isAdmin(src) then notify(src, 'Estás muy lejos de la cabina', 'error') return nil end
    local st = state(b.id)
    st.dj = { src = src, name = nameOf(src) }
    return b, st
end

---------------------------------------------------------------- panel de DJ
RegisterNetEvent('flowdj:open', function(id)
    local src = source
    local b = boothById(tonumber(id) or -1)
    if not b then return end
    local ok, why = canUse(src, b)
    if not ok then return notify(src, why, 'error') end
    if not nearBooth(src, b) then return end
    TriggerClientEvent('flowdj:openDJ', src, b.id, states[b.id] or state(b.id), GetGameTimer(), nameOf(src))
end)

RegisterNetEvent('flowdj:add', function(id, url, playNow)
    local src = source
    local b, st = djCheck(src, id)
    if not b then return end
    local clean, kind, vid = validUrl(url)
    if not clean then return notify(src, 'Enlace no válido: usa un link de YouTube o un .mp3 / .wav directo', 'error') end
    if #st.queue >= Config.MaxQueue then return notify(src, 'La cola está llena', 'error') end
    local by = nameOf(src)
    fetchInfo(clean, kind, vid, function(title, thumb, author)
        local track = { url = clean, kind = kind, title = title, thumb = thumb, author = author, by = by }
        if playNow or not st.current then
            startTrack(b.id, track)
        else
            st.queue[#st.queue + 1] = track
            broadcastState(b.id)
        end
        notify(src, (playNow or st.current == track) and ('Sonando: ' .. title) or ('Añadida a la cola: ' .. title), 'success')
    end)
end)

RegisterNetEvent('flowdj:control', function(id, action, value)
    local src = source
    local b, st = djCheck(src, id)
    if not b then return end
    local cur = st.current
    if action == 'pause' and cur and cur.playing then
        cur.position, cur.playing, cur.updatedAt = position(cur), false, GetGameTimer()
    elseif action == 'resume' and cur and not cur.playing then
        cur.playing, cur.updatedAt = true, GetGameTimer()
    elseif action == 'stop' then
        st.current = nil
    elseif action == 'skip' then
        return nextTrack(b.id)
    elseif action == 'seek' and cur then
        cur.position, cur.updatedAt = math.max(0.0, tonumber(value) or 0.0), GetGameTimer()
    elseif action == 'volume' then
        st.djVolume = math.max(0.0, math.min(1.0, tonumber(value) or 0.8))
    elseif action == 'eq' and type(value) == 'table' then
        local function n(v) return math.max(-1.0, math.min(1.0, tonumber(v) or 0.0)) end
        st.eq = { low = n(value.low), mid = n(value.mid), high = n(value.high), filter = n(value.filter) }
    elseif action == 'transition' and type(value) == 'table' then
        local mode = (value.mode == 'cut' or value.mode == 'filter') and value.mode or 'fade'
        local secs = math.max(1, math.min(12, math.floor(tonumber(value.secs) or 6)))
        st.mix = { mode = mode, secs = secs, auto = value.auto == true }
    elseif action == 'fx' then
        local fx = Config.Effects[value]
        if not fx or not b.fx or #b.fx == 0 then return notify(src, 'Esta cabina no tiene puntos de efectos', 'error') end
        st.fxCd = st.fxCd or {}
        if st.fxCd[value] and GetGameTimer() - st.fxCd[value] < Config.FxCooldown * 1000 then return end
        st.fxCd[value] = GetGameTimer()
        TriggerClientEvent('flowdj:fx', -1, b.id, value)
        return
    elseif action == 'sfx' then
        local ok = false
        for _, n in ipairs(Config.Sounds) do if n == value then ok = true end end
        if not ok then return end
        st.sfxCd = st.sfxCd or 0
        if GetGameTimer() - st.sfxCd < 350 then return end
        st.sfxCd = GetGameTimer()
        TriggerClientEvent('flowdj:sfx', -1, b.id, value)
        return
    elseif action == 'remove' then
        table.remove(st.queue, tonumber(value) or 0)
    elseif action == 'playIndex' then
        local t = table.remove(st.queue, tonumber(value) or 0)
        if t then return startTrack(b.id, t) end
    elseif action == 'up' then
        local i = tonumber(value) or 0
        if i > 1 and st.queue[i] then st.queue[i], st.queue[i - 1] = st.queue[i - 1], st.queue[i] end
    elseif action == 'clear' then
        st.queue = {}
    elseif action == 'replay' then
        local h = st.history[tonumber(value) or 0]
        if h then return startTrack(b.id, { url = h.url, title = h.title, thumb = h.thumb, kind = h.kind, by = nameOf(src) }) end
    else
        return
    end
    broadcastState(b.id)
end)

-- cualquier cliente que escucha avisa cuando termina la cancion
RegisterNetEvent('flowdj:ended', function(id, key)
    local st = states[tonumber(id) or -1]
    if st and st.current and st.current.key == key and st.current.playing and position(st.current) > 5.0 then
        nextTrack(tonumber(id))
    end
end)

-- el DJ esta hablando por el micro: bajar la musica a todos
RegisterNetEvent('flowdj:duck', function(id, talking)
    local src = source
    local b = boothById(tonumber(id) or -1)
    if not b or not nearBooth(src, b, Config.MicMaxDistance) then return end
    local st = state(b.id)
    st.duck = talking == true
    TriggerClientEvent('flowdj:duck', -1, b.id, st.duck)
end)

---------------------------------------------------------------- admin
RegisterCommand(Config.AdminCommand, function(src)
    if src == 0 then return end
    if not isAdmin(src) then return notify(src, 'No tienes permiso', 'error') end
    TriggerClientEvent('flowdj:openAdmin', src, booths, states, GetGameTimer(), Config.Defaults, Config.MaxRadius)
end, false)

RegisterNetEvent('flowdj:saveBooth', function(d)
    local src = source
    if not isAdmin(src) or type(d) ~= 'table' or type(d.coords) ~= 'table' then return end
    local b = d.id and boothById(tonumber(d.id)) or nil
    if not b then
        b = { id = nextId }
        nextId = nextId + 1
        booths[#booths + 1] = b
    end
    b.name = cleanName(d.name)
    b.coords = { x = tonumber(d.coords.x) or 0.0, y = tonumber(d.coords.y) or 0.0, z = tonumber(d.coords.z) or 0.0 }
    b.radius = math.max(5.0, math.min(Config.MaxRadius, tonumber(d.radius) or Config.Defaults.radius))
    b.volume = math.max(0.05, math.min(1.0, tonumber(d.volume) or Config.Defaults.volume))
    b.interact = math.max(1.0, math.min(10.0, tonumber(d.interact) or Config.Defaults.interact))
    b.access = (d.access == 'job' or d.access == 'admin') and d.access or 'all'
    b.job = type(d.job) == 'string' and d.job:lower():gsub('[^%w_]', ''):sub(1, 30) or ''
    b.blip = d.blip == true
    b.fx = {}
    if type(d.fx) == 'table' then
        for _, p in ipairs(d.fx) do
            if #b.fx >= Config.MaxFxPoints then break end
            if type(p) == 'table' and tonumber(p.x) and tonumber(p.y) and tonumber(p.z) then
                b.fx[#b.fx + 1] = { x = tonumber(p.x), y = tonumber(p.y), z = tonumber(p.z) }
            end
        end
    end
    save()
    broadcastBooths()
    TriggerClientEvent('flowdj:adminSaved', src, b.id)
    notify(src, ('Cabina "%s" guardada · se escucha a %dm'):format(b.name, math.floor(b.radius)), 'success')
end)

RegisterNetEvent('flowdj:deleteBooth', function(id)
    local src = source
    if not isAdmin(src) then return end
    local b, i = boothById(tonumber(id) or -1)
    if not b then return end
    table.remove(booths, i)
    states[b.id] = nil
    save()
    broadcastBooths()
    TriggerClientEvent('flowdj:state', -1, b.id, nil, GetGameTimer())
    notify(src, ('Cabina "%s" eliminada'):format(b.name), 'success')
end)

RegisterNetEvent('flowdj:adminStop', function(id)
    local src = source
    if not isAdmin(src) or not states[tonumber(id) or -1] then return end
    states[tonumber(id)].current = nil
    states[tonumber(id)].queue = {}
    broadcastState(tonumber(id))
end)

---------------------------------------------------------------- al entrar
RegisterNetEvent('flowdj:hello', function()
    local src = source
    broadcastBooths(src)
    for id, st in pairs(states) do TriggerClientEvent('flowdj:state', src, id, st, GetGameTimer()) end
end)
