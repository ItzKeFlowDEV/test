# chipeo_audio

Sistema de audio de vehículo para FiveM (standalone, sin dependencias, OneSync requerido).

## Instalación
1. Copia la carpeta `chipeo_audio` a `resources/`.
2. Añade `ensure chipeo_audio` a tu `server.cfg`.
3. Dentro de un vehículo usa `/chipeo` o la tecla **F6** (configurable en Ajustes > Teclas > FiveM).

## Funciones
- Biblioteca musical personal (por licencia), guardada en `data/library.json`.
- Reproducción rápida por enlace directo `.mp3`, `.wav`, `.ogg`.
- **Clonar USB**: guarda en tu biblioteca la canción que suena en ese momento en el vehículo.
- Sincronizado para todos los jugadores; el volumen baja con la distancia al vehículo.
- 3 amplificadores con VOL, FADER, SUB VOL, FREQ y ecualizador de 7 bandas (50Hz–10K).
- Knobs: arrastra verticalmente, rueda del ratón, doble clic para resetear.
- Medidores de temperatura del motor y voltaje.
- Vibración de pantalla: quien esté cerca (o dentro) siente temblar la cámara cuando los graves están fuertes; se ajusta en `Config.Shake`. Requiere que el enlace permita CORS (igual que el ecualizador).

## Notas
- El enlace debe ser directo al archivo de audio. Si el servidor remoto no permite CORS, el audio suena pero sin ecualizador.
- Ajustes en `config.lua` (distancia, comando, tecla, solo conductor...).
