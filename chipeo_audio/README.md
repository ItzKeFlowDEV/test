# chipeo_audio

Sistema de audio de vehículo para FiveM (standalone, sin dependencias, OneSync requerido).

## Instalación
1. Copia la carpeta `chipeo_audio` a `resources/`.
2. Añade `ensure chipeo_audio` a tu `server.cfg`.
3. Dentro de un vehículo usa `/chipeo` o la tecla **F6** (configurable en Ajustes > Teclas > FiveM).

## Funciones
- Biblioteca musical personal (por licencia), guardada en `data/library.json`.
- Reproducción rápida por enlace directo `.mp3`, `.wav`, `.ogg` o por **enlace de YouTube** (watch, youtu.be, shorts). Con YouTube suena y se sincroniza, pero el ecualizador, los amplificadores, el medidor de bajo y la vibración de pantalla no están disponibles (YouTube no permite procesar su audio); solo funciona el volumen general. Algunos videos no permiten reproducirse fuera de YouTube y mostrarán un aviso.
- **Clonar USB**: guarda en tu biblioteca la canción que suena en ese momento en el vehículo.
- Sonido realista alrededor del vehículo: el volumen baja con la distancia, se escucha por el lado (izq/der) donde está el carro y desde fuera suena apagado (retumba el bajo). Con puertas, ventanas o maletero abiertos se escucha más claro. Ajustes: `Config.MaxDistance`, `Config.OutsideMuffle`, `Config.ClosedMuffle`.
- Radio estilo Pioneer MVH con pantalla de 14 segmentos. Controles:
  - Perilla: volumen · SRC: apagar/detener · Teléfono: silenciar · BAND/DIMMER: cambiar color de luz
  - 8D: audio 8D opcional (el sonido gira de un lado a otro con eco de sala), apagado por defecto y lo oyen todos
  - BASS: bass boost (+9 dB en graves) · DISP: título / tiempo / pantalla apagada
  - TRACK ⏮ ⏭: canción anterior/siguiente · 1/2: volumen +/- · 3: play · 4: pausa · 5: aleatorio · 6: repetir
- Iluminación en 6 colores: rojo, naranja, blanco, azul, verde, morado (radio, ecualizadores y botones).
- 3 ecualizadores estilo PRV EQ7-15 apilados (FRONT, MIDS, SUBS): Sub level, Volume, FADER y 7 bandas (50Hz–16KHz) con perillas cromadas y anillo LED.
- Cajón con 2 subwoofers que se mueven con el bajo.
- `/chipeo_debug` imprime un diagnóstico en la consola F8 si algo no suena.
- 3 amplificadores con VOL, FADER, SUB VOL, FREQ y ecualizador de 7 bandas (50Hz–10K).
- Knobs: arrastra verticalmente, rueda del ratón, doble clic para resetear.
- Medidores de temperatura del motor y voltaje.
- Cámara al ritmo del bajo: con cada golpe de bajo (kick/808) la cámara de quien está dentro **y de los que están afuera cerca** se aleja y vuelve suave a su posición. Más fuerte cuanto más cerca (radio `Config.Shake.radius`, fuerza afuera `outsideStrength`). Se ajusta en `Config.Shake` (`mode = 'pulse'` o `'shake'` para el temblor clásico, `pulseFov`, `pulseDistance`, `pulseRelease`...). Requiere que el enlace permita CORS (no funciona con YouTube).

## Notas
- El enlace debe ser directo al archivo de audio. Si el servidor remoto no permite CORS, el audio suena pero sin ecualizador.
- Ajustes en `config.lua` (distancia, comando, tecla, solo conductor...).
