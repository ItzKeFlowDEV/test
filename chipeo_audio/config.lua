Config = {}

Config.Command      = 'chipeo'     -- comando para abrir el equipo
Config.DefaultKey   = 'F6'         -- tecla por defecto (configurable en ajustes de FiveM)
Config.MaxDistance  = 40.0         -- distancia maxima a la que se escucha desde fuera del vehiculo
Config.OutsideMuffle = 0.7         -- multiplicador de volumen para quien esta fuera del vehiculo
Config.ClosedMuffle  = 0.65        -- 0-1: cuanto se apagan los agudos fuera con puertas/ventanas cerradas
Config.MaxSongs     = 50           -- canciones maximas por jugador
Config.AllowedExt   = { '.mp3', '.wav', '.ogg' }
Config.RequireExtension = false     -- true: el enlace debe acabar en .mp3/.wav/.ogg
Config.Debug = false               -- imprime en consola del servidor cada reproduccion
Config.DriverOnly   = false        -- true: solo el conductor puede abrir/controlar el equipo

-- Camara al ritmo del bajo (para quien esta cerca del vehiculo, o dentro)
Config.Shake = {
    enabled       = true,
    mode          = 'pulse',                 -- 'pulse' = la camara se aleja y vuelve con cada golpe | 'shake' = temblor
    threshold     = 0.45,                    -- nivel de graves (0-1) a partir del cual reacciona
    radius        = 30.0,                    -- metros alrededor del vehiculo donde los de afuera sienten el efecto
    outsideStrength = 0.8,                   -- fuerza del efecto para los de afuera (1.0 = igual que dentro)
    -- modo pulse
    pulseFov      = 7.0,                     -- grados de FOV que se abre en un golpe fuerte
    pulseDistance = 0.6,                     -- metros que la camara retrocede en un golpe fuerte
    pulseAttack   = 28.0,                    -- velocidad de alejarse (mas alto = golpe mas seco)
    pulseRelease  = 0.88,                    -- velocidad de volver (0.80 rapido - 0.95 lento)
    -- modo shake
    maxAmplitude  = 0.45,
    camShake      = 'SMALL_EXPLOSION_SHAKE'
}
