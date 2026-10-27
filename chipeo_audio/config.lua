Config = {}

Config.Command      = 'chipeo'     -- comando para abrir el equipo
Config.DefaultKey   = 'F6'         -- tecla por defecto (configurable en ajustes de FiveM)
Config.MaxDistance  = 40.0         -- distancia maxima a la que se escucha desde fuera del vehiculo
Config.OutsideMuffle = 0.55        -- multiplicador de volumen para quien esta fuera del vehiculo
Config.MaxSongs     = 50           -- canciones maximas por jugador
Config.AllowedExt   = { '.mp3', '.wav', '.ogg' }
Config.DriverOnly   = false        -- true: solo el conductor puede abrir/controlar el equipo

-- Vibracion de camara por graves (para quien esta cerca del vehiculo, o dentro)
Config.Shake = {
    enabled      = true,
    threshold    = 0.55,                    -- nivel de graves (0-1) a partir del cual empieza a vibrar
    maxAmplitude = 0.45,                    -- vibracion maxima de camara
    camShake     = 'SMALL_EXPLOSION_SHAKE'  -- tipo de shake de GTA
}
