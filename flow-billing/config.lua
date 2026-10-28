Config = {}

Config.Command   = 'facturas'   -- abre el menu
Config.Key       = 'F7'         -- tecla por defecto (configurable en ajustes de FiveM); '' para ninguna
Config.Currency  = '$'

Config.NearbyDistance = 6.0     -- metros para ver jugadores cercanos al crear una factura
Config.AllowById      = true    -- permitir facturar escribiendo el ID (aunque no este cerca)
Config.MaxAmount      = 250000  -- importe maximo por factura
Config.RequireDuty    = false   -- QBCore: solo facturar estando de servicio

-- ===================== vencimiento, cobro automatico y recargos =====================
-- Cada factura vence a las 'dueHours' horas. Al vencer se cobra sola del banco (si el jugador esta conectado).
-- Si no tiene fondos, se le suma un recargo por cada hora de atraso hasta que la pague.
Config.AutoPay = {
    enabled = true,
    dueHours = 72,          -- horas hasta que vence
    checkMinutes = 10,      -- cada cuanto se revisan las vencidas
}
Config.LateFee = {
    enabled = true,
    percentPerHour = 2,     -- % del importe que se suma por cada hora vencida
    maxPercent = 50,        -- tope del recargo
}

-- ===================== facturas personales (cualquier jugador) =====================
-- Cualquiera puede mandar una factura a otro jugador sin importar su trabajo. El dinero va 100% a quien la emite.
Config.Universal = {
    enabled = true,
    label = 'Personal', color = '#A78BFA', icon = 'user',
    allowCustom = true,
    maxAmount = 50000,
    presets = {
        { label = 'Préstamo', amount = 1000 },
        { label = 'Venta de objeto', amount = 500 },
        { label = 'Servicio', amount = 250 },
    }
}

-- ===================== trabajos que pueden facturar =====================
-- label: nombre que aparece · color: color de la etiqueta · commission: % para quien factura (el resto va a la empresa)
-- society: cuenta de la empresa que recibe el dinero · bossGrade: desde que rango ve la pestaña "Empresa"
-- minGrade: rango minimo para poder emitir facturas oficiales del trabajo
-- presets: conceptos rapidos (el empleado tambien puede escribir uno propio si allowCustom = true)
Config.Jobs = {
    police = {
        label = 'LSPD', color = '#3B82F6', icon = 'shield', commission = 10, society = 'police', minGrade = 1, bossGrade = 4, allowCustom = true,
        presets = {
            { label = 'Exceso de velocidad', amount = 750 },
            { label = 'Conducción temeraria', amount = 1500 },
            { label = 'Pasarse un semáforo', amount = 500 },
            { label = 'Estacionamiento indebido', amount = 300 },
            { label = 'Portación ilegal de arma', amount = 5000 },
            { label = 'Desacato a la autoridad', amount = 2500 },
            { label = 'Alteración del orden', amount = 1200 },
            { label = 'Vehículo sin documentos', amount = 900 },
        }
    },
    ambulance = {
        label = 'EMS', color = '#FF3B5C', icon = 'medic', commission = 15, society = 'ambulance', minGrade = 0, bossGrade = 4, allowCustom = true,
        presets = {
            { label = 'Atención médica', amount = 500 },
            { label = 'Reanimación', amount = 1200 },
            { label = 'Traslado en ambulancia', amount = 800 },
            { label = 'Cirugía', amount = 3500 },
            { label = 'Medicamentos', amount = 250 },
        }
    },
    mechanic = {
        label = 'Mecánico', color = '#FF8A1F', icon = 'wrench', commission = 20, society = 'mechanic', minGrade = 0, bossGrade = 4, allowCustom = true,
        presets = {
            { label = 'Reparación de motor', amount = 1500 },
            { label = 'Reparación de carrocería', amount = 1000 },
            { label = 'Remolque', amount = 600 },
            { label = 'Cambio de neumáticos', amount = 400 },
            { label = 'Limpieza', amount = 150 },
        }
    },
    taxi = {
        label = 'Taxi', color = '#FFD23F', icon = 'car', commission = 30, society = 'taxi', minGrade = 0, bossGrade = 4, allowCustom = true,
        presets = {
            { label = 'Viaje corto', amount = 150 },
            { label = 'Viaje largo', amount = 450 },
        }
    },
}

-- Dinero a la cuenta de la empresa. Por defecto detecta esx_addonaccount, qb-banking, qb-management y Renewed-Banking.
-- Si usas otro banco, cambia esta funcion (corre en el servidor).
Config.AddSocietyMoney = nil   -- function(society, amount) ... end
