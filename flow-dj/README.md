# flow-dj

> Tema **MUSA**: rosa y blanco del logo sobre negro, fuentes Saira Condensed + Inter (incluidas en `html/fonts`), logo en `html/img/musa-logo.png` (cámbialo por el tuyo si quieres).

Cabinas de DJ con música de **YouTube** o **MP3/WAV**, audio 3D por distancia y paneles con el diseño FlowDev. Standalone (ESX / QBCore / QBox solo para cabinas por trabajo).

## Instalación
1. Copia `flow-dj` a `resources/` y pon `ensure flow-dj` en `server.cfg`.
2. Admins: `group.admin` de txAdmin/ACE, grupos admin de ESX/QBCore/QBox, permiso `flowdj.admin` o `Config.Admins`.

## Admins · `/djadmin`
- **Nueva cabina aquí**: crea una cabina donde estás parado.
- Ajustes por cabina: nombre, posición (“Mi posición” / “Ir”), **metros que se escucha**, **volumen máximo**, distancia para abrirla,
  quién puede usarla (**todos**, **un trabajo** o **solo admins**) y si sale en el mapa.
- Mientras editas, el radio se dibuja en el suelo del juego y en el radar del panel.
- Detener la música de una cabina o eliminarla. Las cabinas se guardan en `data/booths.json`.

## DJ · tecla **E** en la cabina
Panel estilo **CDJ + mezclador DJM**:
- **Pantalla**: portada, título, artista, tiempo transcurrido y restante, y la **onda de la canción** (real con MP3/WAV) con lo que ya sonó en color. Clic en la onda para adelantar.
- **Hot cues A–D**: clic para marcar un punto de la canción y clic otra vez para saltar ahí; clic derecho para borrarlo. Se ven también en la onda.
- **Jog wheel** con anillo LED de progreso, portada girando en el centro, botones **CUE (stop)**, **PLAY/PAUSE**, **NEXT** y **CLEAR**.
- **Mezclador**: EQ de 3 bandas (HI / MID / LOW), **FILTER** (izquierda graves, derecha agudos) y fader **MASTER** con vúmetros. El EQ y el filtro los oyen todos (solo MP3/WAV; YouTube no deja procesar su audio).
- **Cola** (YouTube o MP3): añadir, poner ya, subir, quitar, vaciar, e **Historial**.
- Arriba: **oyentes** dentro del radio, **alcance** en metros y luz **ON AIR**.

## Cómo se escucha
- Todos los jugadores dentro del radio la escuchan sincronizada.
- Volumen completo cerca de la cabina y se va apagando hasta el borde del radio. Se oye por el lado donde está la cabina y,
  lejos, suena más apagada (con MP3/WAV). Dentro de un vehículo se oye más bajo.
- La canción solo se carga para quien está en el radio (no gasta internet a los que están lejos).
- Tarjeta “Sonando ahora” arriba a la derecha con la canción, el DJ y a cuántos metros estás.
