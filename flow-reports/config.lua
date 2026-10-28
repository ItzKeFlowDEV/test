Config = {}

Config.ReportCommand = 'reportar'   -- jugadores
Config.AdminCommand  = 'reportes'   -- administradores

-- Categorias del formulario (id, nombre, icono: bug | user | help | money | car | other)
Config.Categories = {
    { id = 'bug',      label = 'Bug / Error',       icon = 'bug'   },
    { id = 'player',   label = 'Reportar jugador',  icon = 'user'  },
    { id = 'help',     label = 'Ayuda / Duda',      icon = 'help'  },
    { id = 'loss',     label = 'Pérdida de items',  icon = 'money' },
    { id = 'vehicle',  label = 'Vehículo',          icon = 'car'   },
    { id = 'other',    label = 'Otro',              icon = 'other' },
}

Config.MinMessage = 10      -- caracteres minimos del reporte
Config.MaxMessage = 500
Config.Cooldown   = 60      -- segundos entre reportes del mismo jugador

-- ===================== quien es admin (basta con cumplir UNA) =====================
Config.AdminGroups = { 'admin', 'superadmin', 'god', 'owner', 'mod', 'moderator' }  -- ESX / QBCore / QBox / ace group.x
Config.AdminAce = 'flowreports.admin'
Config.AceCommandIsAdmin = true     -- 'command' (group.admin de txAdmin) cuenta como admin
Config.Admins = {
    -- 'license:0000000000000000000000000000000000000000',
}

-- ===================== acciones =====================
-- Escala: el boton "Escala" del admin le abre al jugador el menu de escala (rango de abajo).
Config.ScaleMin, Config.ScaleMax = 0.5, 1.5
-- Si usas otro script de escala, abrelo aqui y devuelve true (ej: ExecuteCommand('scalemenu') return true)
Config.OpenScaleMenu = function()
    return false   -- false = usar el menu de escala de flow-reports
end

-- Capturas de pantalla en el chat del reporte (necesita el recurso screenshot-basic)
Config.ScreenshotQuality = 0.7   -- calidad JPG (0.1 - 1.0)
Config.MaxScreenshotKB   = 1500  -- tamaño maximo por captura
Config.MaxScreenshots    = 5     -- capturas maximas por reporte

-- Menu de ropa que se abre al jugador con el boton "Skin". Ajustalo a tu script de ropa si hace falta.
Config.OpenSkinMenu = function()
    local function started(r) return GetResourceState(r) == 'started' end
    if started('illenium-appearance') then
        TriggerEvent('illenium-appearance:client:openClothingShopMenu', true)
    elseif started('fivem-appearance') then
        exports['fivem-appearance']:startPlayerCustomization(function(app)
            if app then TriggerServerEvent('fivem-appearance:save', app) end
        end, { ped = true, headBlend = true, faceFeatures = true, headOverlays = true, components = true, props = true })
    elseif started('qb-clothing') then
        TriggerEvent('qb-clothing:client:openMenu')
    elseif started('esx_skin') then
        TriggerEvent('esx_skin:openSaveableMenu')
    else
        return false
    end
    return true
end

-- Revivir / curar: siempre se hace por el script y ademas avisa a tu framework si esta encendido
Config.ReviveEvents = {
    { resource = 'qb-ambulancejob',   event = 'hospital:client:Revive' },
    { resource = 'esx_ambulancejob',  event = 'esx_ambulancejob:revive' },
}
Config.HealEvents = {
    { resource = 'qb-ambulancejob',   event = 'hospital:client:adminHeal' },
    { resource = 'esx_basicneeds',    event = 'esx_basicneeds:healPlayer' },
}

Config.LogClosed = 200      -- cuantos reportes cerrados guardar en data/log.json
